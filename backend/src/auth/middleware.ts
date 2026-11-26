import type { RequestHandler } from 'express';
import { HttpError } from '../http/errors.js';
import { constantTimeStringEqual, hashSecret, readCookie, SESSION_COOKIE } from './crypto.js';
import type { AuthenticatedRequest } from './types.js';
import { prisma } from '../db/prisma.js';
import { env } from '../config/env.js';

export const requireSameOrigin: RequestHandler = (request, _response, next) => {
  const origin = request.get('origin');
  if (!origin || !env.corsOrigins.includes(origin)) {
    next(new HttpError(403, 'Origem da solicitação não autorizada.'));
    return;
  }
  next();
};

export const requireAuthenticatedSession: RequestHandler = async (request, response, next) => {
  try {
    const rawToken = readCookie(request.headers.cookie, SESSION_COOKIE);
    if (!rawToken) throw new HttpError(401, 'Sessão necessária.');

    const session = await prisma.authSession.findUnique({
      where: { tokenHash: hashSecret(rawToken) },
      include: {
        user: {
          include: {
            unit: true,
            department: true,
            authAccounts: { select: { provider: true } },
          },
        },
      },
    });

    if (!session || session.expiresAt <= new Date()) {
      if (session) await prisma.authSession.delete({ where: { id: session.id } });
      response.clearCookie(SESSION_COOKIE, {
        httpOnly: true,
        secure: env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/api/v1/auth',
      });
      throw new HttpError(401, 'Sessão expirada.');
    }

    if (!session.user.isActive || !session.user.emailVerifiedAt) {
      await prisma.authSession.delete({ where: { id: session.id } });
      throw new HttpError(403, 'Conta inativa ou e-mail não verificado.');
    }

    (request as AuthenticatedRequest).authContext = {
      sessionId: session.id,
      csrfTokenHash: session.csrfTokenHash,
      csrfTokenEncrypted: session.csrfTokenEncrypted,
      user: {
        id: session.user.id,
        fullName: session.user.fullName,
        email: session.user.email,
        role: session.user.role,
        unit: { id: session.user.unit.id, name: session.user.unit.name },
        department: { id: session.user.department.id, name: session.user.department.name },
        authProviders: session.user.authAccounts.map((account) => account.provider),
      },
    };
    next();
  } catch (error) {
    next(error);
  }
};

export const requireCsrf: RequestHandler = (request, _response, next) => {
  const auth = (request as AuthenticatedRequest).authContext;
  const suppliedToken = request.get('x-csrf-token');
  if (
    !auth ||
    !suppliedToken ||
    !constantTimeStringEqual(hashSecret(suppliedToken), auth.csrfTokenHash)
  ) {
    next(new HttpError(403, 'Token CSRF inválido. Atualize a sessão e tente novamente.'));
    return;
  }
  next();
};

export function getAuthContext(request: AuthenticatedRequest) {
  if (!request.authContext) throw new HttpError(401, 'Sessão necessária.');
  return request.authContext;
}
