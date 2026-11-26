import argon2, { type HashOptions } from 'argon2';
import { Router, type Request, type RequestHandler, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { AuthProvider, AuthTokenType, OAuthIntent, UserRole } from '../generated/prisma/client.ts';
import { env } from '../config/env.js';
import { prisma } from '../db/prisma.js';
import { HttpError } from '../http/errors.js';
import {
  clearSessionCookie,
  clearOAuthStateCookie,
  constantTimeStringEqual,
  createOpaqueToken,
  decryptEphemeralSecret,
  encryptEphemeralSecret,
  hashSecret,
  OAUTH_STATE_COOKIE,
  readCookie,
  setOAuthStateCookie,
} from './crypto.js';
import {
  requireAuthenticatedSession,
  requireCsrf,
  requireSameOrigin,
  getAuthContext,
} from './middleware.js';
import {
  buildProviderAuthorizationUrl,
  exchangeProviderAuthorizationCode,
  type ExternalAuthProvider,
} from './oidc.js';
import { emailDeliveryAvailable, sendPasswordResetEmail, sendVerificationEmail } from './email.js';
import { createSessionResponse, getSessionResponse } from './session.js';
import type { AuthenticatedRequest } from './types.js';
import {
  emailOnlySchema,
  linkPasswordSchema,
  loginSchema,
  oauthStartSchema,
  pendingOAuthSchema,
  registerSchema,
  resetPasswordSchema,
  tokenSchema,
  validateBody,
} from './validation.js';

const router = Router();
const passwordHashOptions: HashOptions = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: { message: 'Muitas tentativas. Aguarde 15 minutos e tente novamente.' } },
});
const registrationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: { message: 'Limite de cadastros atingido. Tente novamente mais tarde.' } },
});
const recoveryLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: { message: 'Limite de solicitações atingido. Tente novamente mais tarde.' } },
});

function providerFromParameter(value: string): ExternalAuthProvider {
  if (value === 'google') return AuthProvider.GOOGLE;
  if (value === 'apple') return AuthProvider.APPLE;
  throw new HttpError(404, 'Provedor de autenticação não encontrado.');
}

function providerEnabled(provider: ExternalAuthProvider): boolean {
  return provider === AuthProvider.GOOGLE ? env.googleOAuthEnabled : env.appleOAuthEnabled;
}

function callbackUri(provider: ExternalAuthProvider): string {
  return provider === AuthProvider.GOOGLE ? env.GOOGLE_REDIRECT_URI : env.APPLE_REDIRECT_URI;
}

function passwordProviderSubject(email: string): string {
  return email.trim().toLowerCase();
}

function isUniqueConstraint(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
}

function setNoCacheHeaders(response: Response): void {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Referrer-Policy', 'no-referrer');
}

async function issueEmailToken(userId: string, type: AuthTokenType, lifetimeMs: number) {
  const token = createOpaqueToken();
  const expiresAt = new Date(Date.now() + lifetimeMs);
  await prisma.$transaction(async (transaction) => {
    await transaction.authToken.updateMany({
      where: { userId, type, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    await transaction.authToken.create({
      data: { userId, type, tokenHash: hashSecret(token), expiresAt },
    });
  });
  return token;
}

async function registrationOptions() {
  return prisma.unit.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      departments: {
        where: { isActive: true },
        orderBy: { name: 'asc' },
        select: { id: true, name: true },
      },
    },
  });
}

async function completeEmailLogin(userId: string, response: Response) {
  return createSessionResponse(userId, response);
}

async function oauthErrorRedirect(response: Response, error: string) {
  const url = new URL('/auth/login', env.FRONTEND_URL);
  url.searchParams.set('oauthError', error);
  setNoCacheHeaders(response);
  response.redirect(303, url.toString());
}

function appleNameFromResponse(value: unknown): string | undefined {
  let data = value;
  if (typeof value === 'string') {
    try {
      data = JSON.parse(value) as unknown;
    } catch {
      return undefined;
    }
  }
  if (!data || typeof data !== 'object' || !('name' in data)) return undefined;
  const name = data.name;
  if (!name || typeof name !== 'object') return undefined;
  const first = 'firstName' in name && typeof name.firstName === 'string' ? name.firstName : '';
  const last = 'lastName' in name && typeof name.lastName === 'string' ? name.lastName : '';
  const fullName = `${first} ${last}`.trim();
  return fullName || undefined;
}

async function handleOAuthCallback(
  request: Request,
  provider: ExternalAuthProvider,
  parameters: Record<string, string>,
  appleName: string | undefined,
  response: Response,
) {
  const browserState = readCookie(request.headers.cookie, OAUTH_STATE_COOKIE);
  clearOAuthStateCookie(response);
  try {
    if (!providerEnabled(provider)) return oauthErrorRedirect(response, 'provider_unavailable');
    const rawState = parameters.state;
    if (!rawState || !browserState || !constantTimeStringEqual(rawState, browserState)) {
      return oauthErrorRedirect(response, 'oauth_failed');
    }

    const transaction = await prisma.oAuthTransaction.findUnique({
      where: { stateHash: hashSecret(rawState) },
    });
    const now = new Date();
    if (
      !transaction ||
      transaction.provider !== provider ||
      transaction.expiresAt <= now ||
      transaction.consumedAt
    ) {
      return oauthErrorRedirect(response, 'oauth_failed');
    }

    const claimed = await prisma.oAuthTransaction.updateMany({
      where: { id: transaction.id, consumedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now },
    });
    if (claimed.count !== 1) return oauthErrorRedirect(response, 'oauth_failed');

    if (transaction.intent === OAuthIntent.VINCULO) {
      const activeSession = await prisma.authSession.findFirst({
        where: {
          id: transaction.sessionId ?? undefined,
          userId: transaction.userId ?? undefined,
          expiresAt: { gt: now },
        },
      });
      if (!activeSession || !transaction.userId) {
        return oauthErrorRedirect(response, 'link_session_expired');
      }
    }

    const { claims } = await exchangeProviderAuthorizationCode(
      provider,
      parameters,
      callbackUri(provider),
      rawState,
      transaction.nonce,
      decryptEphemeralSecret(transaction.codeVerifierEncrypted),
    );
    const subject = typeof claims.sub === 'string' ? claims.sub : undefined;
    const providerEmail = typeof claims.email === 'string' ? claims.email.trim().toLowerCase() : '';
    const emailIsVerified = claims.email_verified === true || claims.email_verified === 'true';
    const claimedName = typeof claims.name === 'string' ? claims.name.trim() : '';
    const fullName = claimedName || appleName || '';
    if (!subject || !providerEmail || !emailIsVerified) {
      return oauthErrorRedirect(response, 'provider_email_unverified');
    }

    const existingAccount = await prisma.authAccount.findFirst({
      where: { provider, providerSubject: subject },
    });
    if (existingAccount) {
      if (transaction.intent === OAuthIntent.VINCULO) {
        if (existingAccount.userId !== transaction.userId) {
          return oauthErrorRedirect(response, 'provider_already_linked');
        }
        const url = new URL('/auth/connections', env.FRONTEND_URL);
        url.searchParams.set('linked', provider.toLowerCase());
        setNoCacheHeaders(response);
        response.redirect(303, url.toString());
        return;
      }

      const user = await prisma.user.findUnique({ where: { id: existingAccount.userId } });
      if (!user?.isActive || !user.emailVerifiedAt) {
        return oauthErrorRedirect(response, 'account_inactive');
      }
      setNoCacheHeaders(response);
      await completeEmailLogin(user.id, response);
      response.redirect(303, new URL('/', env.FRONTEND_URL).toString());
      return;
    }

    if (transaction.intent === OAuthIntent.VINCULO) {
      const targetUser = await prisma.user.findUnique({ where: { id: transaction.userId! } });
      if (!targetUser?.isActive || !targetUser.emailVerifiedAt) {
        return oauthErrorRedirect(response, 'account_inactive');
      }
      const emailOwner = await prisma.user.findUnique({ where: { email: providerEmail } });
      if (emailOwner && emailOwner.id !== targetUser.id) {
        return oauthErrorRedirect(response, 'account_link_required');
      }
      await prisma.$transaction(async (transactionClient) => {
        await transactionClient.authAccount.create({
          data: {
            userId: targetUser.id,
            provider,
            providerSubject: subject,
            providerEmail,
          },
        });
        await transactionClient.auditLog.create({
          data: {
            actorUserId: targetUser.id,
            actorNameSnapshot: targetUser.fullName,
            action: 'METODO_AUTENTICACAO_VINCULADO',
            entityType: 'AUTH_ACCOUNT',
            entityId: targetUser.id,
            changes: { provider },
          },
        });
      });
      const url = new URL('/auth/connections', env.FRONTEND_URL);
      url.searchParams.set('linked', provider.toLowerCase());
      setNoCacheHeaders(response);
      response.redirect(303, url.toString());
      return;
    }

    const existingEmail = await prisma.user.findUnique({ where: { email: providerEmail } });
    if (existingEmail) return oauthErrorRedirect(response, 'account_link_required');
    if (transaction.intent !== OAuthIntent.CADASTRO) {
      return oauthErrorRedirect(response, 'account_not_found');
    }

    const pendingToken = createOpaqueToken();
    const pending = await prisma.pendingOAuthIdentity.findFirst({
      where: { provider, providerSubject: subject },
    });
    const pendingData = {
      provider,
      providerSubject: subject,
      email: providerEmail,
      fullName: fullName || null,
      tokenHash: hashSecret(pendingToken),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      consumedAt: null,
    };
    if (pending) {
      await prisma.pendingOAuthIdentity.update({ where: { id: pending.id }, data: pendingData });
    } else {
      await prisma.pendingOAuthIdentity.create({ data: pendingData });
    }

    const url = new URL('/auth/complete', env.FRONTEND_URL);
    url.searchParams.set('token', pendingToken);
    setNoCacheHeaders(response);
    response.redirect(303, url.toString());
  } catch {
    await oauthErrorRedirect(response, 'oauth_failed');
  }
}

router.get('/providers', (_request, response) => {
  response.json({
    emailPassword: true,
    emailDelivery: emailDeliveryAvailable(),
    google: env.googleOAuthEnabled,
    apple: env.appleOAuthEnabled,
  });
});

router.get('/registration-options', async (_request, response) => {
  response.json({ units: await registrationOptions() });
});

router.get('/oauth/google/callback', async (request, response) => {
  const parameters: Record<string, string> = {};
  for (const [key, value] of Object.entries(request.query)) {
    if (typeof value === 'string') parameters[key] = value;
  }
  await handleOAuthCallback(request, AuthProvider.GOOGLE, parameters, undefined, response);
});

router.post('/oauth/apple/callback', async (request, response) => {
  const parameters: Record<string, string> = {};
  for (const [key, value] of Object.entries(request.body ?? {})) {
    if (typeof value === 'string') parameters[key] = value;
  }
  await handleOAuthCallback(
    request,
    AuthProvider.APPLE,
    parameters,
    appleNameFromResponse(request.body?.user),
    response,
  );
});

router.use(requireSameOrigin);

router.post('/register', registrationLimiter, async (request, response) => {
  const input = validateBody(registerSchema, request.body);
  if (!emailDeliveryAvailable()) {
    throw new HttpError(503, 'Cadastro por e-mail está indisponível até configurar o SMTP.');
  }

  const passwordHash = await argon2.hash(input.password, passwordHashOptions);
  let userId: string;
  try {
    const created = await prisma.$transaction(async (transaction) => {
      const unit = await transaction.unit.findFirst({
        where: { id: input.unitId, isActive: true },
        select: { id: true },
      });
      const department = await transaction.department.findFirst({
        where: { id: input.departmentId, unitId: input.unitId, isActive: true },
        select: { id: true },
      });
      if (!unit || !department) {
        throw new HttpError(400, 'Selecione uma unidade e um setor ativos correspondentes.');
      }

      const user = await transaction.user.create({
        data: {
          fullName: input.fullName,
          email: input.email,
          role: UserRole.FUNCIONARIO,
          unitId: unit.id,
          departmentId: department.id,
        },
      });
      await transaction.authAccount.create({
        data: {
          userId: user.id,
          provider: AuthProvider.PASSWORD,
          providerSubject: passwordProviderSubject(input.email),
          passwordHash,
        },
      });
      return user;
    });
    userId = created.id;
  } catch (error) {
    if (isUniqueConstraint(error)) {
      response.status(202).json({
        message:
          'Se o cadastro puder ser concluído, enviaremos as instruções para o e-mail informado.',
      });
      return;
    }
    throw error;
  }

  const token = await issueEmailToken(userId, AuthTokenType.VERIFICACAO_EMAIL, 24 * 60 * 60 * 1000);
  await sendVerificationEmail(input.email, token);
  response.status(202).json({
    message: 'Cadastro recebido. Confira seu e-mail para ativar a conta.',
  });
});

router.post('/login', loginLimiter, async (request, response) => {
  const input = validateBody(loginSchema, request.body);
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  const account = user
    ? await prisma.authAccount.findUnique({
        where: {
          provider_providerSubject: {
            provider: AuthProvider.PASSWORD,
            providerSubject: passwordProviderSubject(input.email),
          },
        },
      })
    : null;

  if (!user || !account?.passwordHash) {
    await argon2.hash(input.password, passwordHashOptions);
    throw new HttpError(401, 'E-mail ou senha inválidos.');
  }

  const passwordMatches = await argon2
    .verify(account.passwordHash, input.password)
    .catch(() => false);
  if (!passwordMatches || !user.isActive) throw new HttpError(401, 'E-mail ou senha inválidos.');
  if (!user.emailVerifiedAt) {
    throw new HttpError(403, 'Confirme seu endereço de e-mail antes de entrar.');
  }

  response.json(await completeEmailLogin(user.id, response));
});

router.post('/email/verification/resend', recoveryLimiter, async (request, response) => {
  const { email } = validateBody(emailOnlySchema, request.body);
  const genericMessage = {
    message:
      'Se houver uma conta pendente para este e-mail, enviaremos um novo link de verificação.',
  };
  if (!emailDeliveryAvailable()) {
    response.status(202).json(genericMessage);
    return;
  }
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.emailVerifiedAt || !user.isActive) {
    response.status(202).json(genericMessage);
    return;
  }
  const token = await issueEmailToken(
    user.id,
    AuthTokenType.VERIFICACAO_EMAIL,
    24 * 60 * 60 * 1000,
  );
  await sendVerificationEmail(email, token).catch(() => undefined);
  response.status(202).json(genericMessage);
});

router.post('/email/verify', recoveryLimiter, async (request, response) => {
  const { token } = validateBody(tokenSchema, request.body);
  const now = new Date();
  const authToken = await prisma.authToken.findUnique({ where: { tokenHash: hashSecret(token) } });
  if (
    !authToken ||
    authToken.type !== AuthTokenType.VERIFICACAO_EMAIL ||
    authToken.expiresAt <= now ||
    authToken.consumedAt
  ) {
    throw new HttpError(400, 'O link de verificação é inválido ou expirou.');
  }

  await prisma.$transaction(async (transaction) => {
    const claimed = await transaction.authToken.updateMany({
      where: { id: authToken.id, consumedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now },
    });
    if (claimed.count !== 1)
      throw new HttpError(400, 'O link de verificação já foi usado ou expirou.');
    await transaction.user.update({
      where: { id: authToken.userId },
      data: { emailVerifiedAt: now },
    });
  });

  response.json(await completeEmailLogin(authToken.userId, response));
});

router.post('/password/forgot', recoveryLimiter, async (request, response) => {
  const { email } = validateBody(emailOnlySchema, request.body);
  const genericMessage = {
    message: 'Se houver uma conta elegível, enviaremos instruções para redefinir a senha.',
  };
  if (!emailDeliveryAvailable()) {
    response.status(202).json(genericMessage);
    return;
  }
  const user = await prisma.user.findUnique({ where: { email } });
  const passwordAccount = user
    ? await prisma.authAccount.findUnique({
        where: {
          provider_providerSubject: {
            provider: AuthProvider.PASSWORD,
            providerSubject: passwordProviderSubject(email),
          },
        },
      })
    : null;
  if (!user || !user.isActive || !user.emailVerifiedAt || !passwordAccount?.passwordHash) {
    response.status(202).json(genericMessage);
    return;
  }
  const token = await issueEmailToken(user.id, AuthTokenType.REDEFINICAO_SENHA, 60 * 60 * 1000);
  await sendPasswordResetEmail(email, token).catch(() => undefined);
  response.status(202).json(genericMessage);
});

router.post('/password/reset', recoveryLimiter, async (request, response) => {
  const { token, password } = validateBody(resetPasswordSchema, request.body);
  const now = new Date();
  const authToken = await prisma.authToken.findUnique({ where: { tokenHash: hashSecret(token) } });
  if (
    !authToken ||
    authToken.type !== AuthTokenType.REDEFINICAO_SENHA ||
    authToken.expiresAt <= now ||
    authToken.consumedAt
  ) {
    throw new HttpError(400, 'O link de redefinição é inválido ou expirou.');
  }
  const user = await prisma.user.findUnique({ where: { id: authToken.userId } });
  if (!user?.isActive || !user.emailVerifiedAt) throw new HttpError(400, 'Conta indisponível.');
  const passwordHash = await argon2.hash(password, passwordHashOptions);

  await prisma.$transaction(async (transaction) => {
    const claimed = await transaction.authToken.updateMany({
      where: { id: authToken.id, consumedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now },
    });
    if (claimed.count !== 1)
      throw new HttpError(400, 'O link de redefinição já foi usado ou expirou.');
    await transaction.authAccount.update({
      where: {
        provider_providerSubject: {
          provider: AuthProvider.PASSWORD,
          providerSubject: passwordProviderSubject(user.email),
        },
      },
      data: { passwordHash },
    });
    await transaction.authToken.updateMany({
      where: {
        userId: user.id,
        type: AuthTokenType.REDEFINICAO_SENHA,
        consumedAt: null,
      },
      data: { consumedAt: now },
    });
    await transaction.authSession.deleteMany({ where: { userId: user.id } });
  });

  response.json({ message: 'Senha redefinida. Entre com a nova senha.' });
});

router.get('/session', requireAuthenticatedSession, async (request, response) => {
  const auth = getAuthContext(request as AuthenticatedRequest);
  response.json(await getSessionResponse(auth.user.id, auth.csrfTokenEncrypted));
});

router.post('/logout', requireAuthenticatedSession, requireCsrf, async (request, response) => {
  const auth = getAuthContext(request as AuthenticatedRequest);
  await prisma.authSession.deleteMany({ where: { id: auth.sessionId, userId: auth.user.id } });
  clearSessionCookie(response);
  response.status(204).end();
});

router.post(
  '/password/link',
  requireAuthenticatedSession,
  requireCsrf,
  async (request, response) => {
    const input = validateBody(linkPasswordSchema, request.body);
    const auth = getAuthContext(request as AuthenticatedRequest);
    const existing = await prisma.authAccount.findFirst({
      where: { userId: auth.user.id, provider: AuthProvider.PASSWORD },
    });
    if (existing) throw new HttpError(409, 'A conta já possui acesso por e-mail e senha.');
    const passwordHash = await argon2.hash(input.password, passwordHashOptions);
    await prisma.$transaction(async (transactionClient) => {
      await transactionClient.authAccount.create({
        data: {
          userId: auth.user.id,
          provider: AuthProvider.PASSWORD,
          providerSubject: passwordProviderSubject(auth.user.email),
          passwordHash,
        },
      });
      await transactionClient.auditLog.create({
        data: {
          actorUserId: auth.user.id,
          actorNameSnapshot: auth.user.fullName,
          action: 'METODO_AUTENTICACAO_VINCULADO',
          entityType: 'AUTH_ACCOUNT',
          entityId: auth.user.id,
          changes: { provider: AuthProvider.PASSWORD },
        },
      });
    });
    response.status(201).json({ message: 'Acesso por e-mail e senha vinculado.' });
  },
);

const maybeRequireLinkSession: RequestHandler = (request, response, next) => {
  if (request.body?.intent !== 'link') {
    next();
    return;
  }
  requireAuthenticatedSession(request, response, (sessionError) => {
    if (sessionError) {
      next(sessionError);
      return;
    }
    requireCsrf(request, response, next);
  });
};

router.post(
  '/oauth/:provider/start',
  registrationLimiter,
  maybeRequireLinkSession,
  async (request, response) => {
    const routeProvider = request.params.provider;
    const provider = providerFromParameter(typeof routeProvider === 'string' ? routeProvider : '');
    const { intent } = validateBody(oauthStartSchema, request.body);
    if (!providerEnabled(provider)) {
      throw new HttpError(503, 'Este provedor não está configurado no servidor.');
    }

    const auth = intent === 'link' ? getAuthContext(request as AuthenticatedRequest) : undefined;
    const state = createOpaqueToken();
    const nonce = createOpaqueToken();
    const codeVerifier = createOpaqueToken(48);
    const intentValue =
      intent === 'link'
        ? OAuthIntent.VINCULO
        : intent === 'signup'
          ? OAuthIntent.CADASTRO
          : OAuthIntent.LOGIN;

    await prisma.oAuthTransaction.create({
      data: {
        provider,
        intent: intentValue,
        stateHash: hashSecret(state),
        nonce,
        codeVerifierEncrypted: encryptEphemeralSecret(codeVerifier),
        userId: auth?.user.id,
        sessionId: auth?.sessionId,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      },
    });

    const authorizationUrl = await buildProviderAuthorizationUrl(
      provider,
      state,
      nonce,
      codeVerifier,
    );
    setOAuthStateCookie(response, state);
    response.json({ authorizationUrl });
  },
);

router.get('/oauth/pending', async (request, response) => {
  const { token } = validateBody(tokenSchema, { token: request.query.token });
  const pending = await prisma.pendingOAuthIdentity.findUnique({
    where: { tokenHash: hashSecret(token) },
  });
  if (!pending || pending.consumedAt || pending.expiresAt <= new Date()) {
    throw new HttpError(
      400,
      'A etapa de cadastro expirou. Inicie o acesso pelo provedor novamente.',
    );
  }
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.json({
    email: pending.email,
    fullName: pending.fullName,
    units: await registrationOptions(),
  });
});

router.post('/oauth/complete', async (request, response) => {
  const input = validateBody(pendingOAuthSchema, request.body);
  const now = new Date();
  const pending = await prisma.pendingOAuthIdentity.findUnique({
    where: { tokenHash: hashSecret(input.token) },
  });
  if (!pending || pending.consumedAt || pending.expiresAt <= now) {
    throw new HttpError(
      400,
      'A etapa de cadastro expirou. Inicie o acesso pelo provedor novamente.',
    );
  }

  const userId = await prisma.$transaction(async (transaction) => {
    const claimed = await transaction.pendingOAuthIdentity.updateMany({
      where: { id: pending.id, consumedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now },
    });
    if (claimed.count !== 1)
      throw new HttpError(400, 'A etapa de cadastro já foi concluída ou expirou.');
    const [unit, department] = await Promise.all([
      transaction.unit.findFirst({ where: { id: input.unitId, isActive: true } }),
      transaction.department.findFirst({
        where: { id: input.departmentId, unitId: input.unitId, isActive: true },
      }),
    ]);
    if (!unit || !department) {
      throw new HttpError(400, 'Selecione uma unidade e um setor ativos correspondentes.');
    }
    const emailOwner = await transaction.user.findUnique({ where: { email: pending.email } });
    if (emailOwner) throw new HttpError(409, 'Esta conta já existe. Entre pelo método vinculado.');

    const user = await transaction.user.create({
      data: {
        fullName: input.fullName,
        email: pending.email,
        emailVerifiedAt: now,
        role: UserRole.FUNCIONARIO,
        unitId: unit.id,
        departmentId: department.id,
      },
    });
    await transaction.authAccount.create({
      data: {
        userId: user.id,
        provider: pending.provider,
        providerSubject: pending.providerSubject,
        providerEmail: pending.email,
      },
    });
    return user.id;
  });

  response.json(await createSessionResponse(userId, response));
});

export const authRouter = router;
