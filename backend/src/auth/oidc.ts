import {
  authorizationCodeGrant,
  buildAuthorizationUrl,
  calculatePKCECodeChallenge,
  ClientSecretPost,
  discovery,
  type Configuration,
} from 'openid-client';
import { importPKCS8, SignJWT } from 'jose';
import { AuthProvider } from '../generated/prisma/client.ts';
import { env } from '../config/env.js';
import { HttpError } from '../http/errors.js';

export type ExternalAuthProvider = typeof AuthProvider.GOOGLE | typeof AuthProvider.APPLE;

const configurationCache = new Map<
  ExternalAuthProvider,
  { value: Configuration; expiresAt: number }
>();

async function appleClientSecret(): Promise<string> {
  const privateKey = await importPKCS8(env.APPLE_PRIVATE_KEY.replace(/\\n/g, '\n'), 'ES256');
  return new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: env.APPLE_KEY_ID })
    .setIssuer(env.APPLE_TEAM_ID)
    .setSubject(env.APPLE_CLIENT_ID)
    .setAudience('https://appleid.apple.com')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey);
}

async function getConfiguration(provider: ExternalAuthProvider): Promise<Configuration> {
  const cached = configurationCache.get(provider);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  let value: Configuration;
  if (provider === AuthProvider.GOOGLE && env.googleOAuthEnabled) {
    value = await discovery(
      new URL('https://accounts.google.com'),
      env.GOOGLE_CLIENT_ID,
      env.GOOGLE_CLIENT_SECRET,
      ClientSecretPost(env.GOOGLE_CLIENT_SECRET),
    );
    configurationCache.set(provider, { value, expiresAt: Date.now() + 6 * 60 * 60 * 1000 });
    return value;
  }

  if (provider === AuthProvider.APPLE && env.appleOAuthEnabled) {
    const clientSecret = await appleClientSecret();
    value = await discovery(
      new URL('https://appleid.apple.com'),
      env.APPLE_CLIENT_ID,
      clientSecret,
      ClientSecretPost(clientSecret),
    );
    configurationCache.set(provider, { value, expiresAt: Date.now() + 4 * 60 * 1000 });
    return value;
  }

  throw new HttpError(503, 'Este provedor de autenticação ainda não está configurado.');
}

export async function buildProviderAuthorizationUrl(
  provider: ExternalAuthProvider,
  state: string,
  nonce: string,
  codeVerifier: string,
): Promise<string> {
  const config = await getConfiguration(provider);
  const codeChallenge = await calculatePKCECodeChallenge(codeVerifier);
  const apple = provider === AuthProvider.APPLE;
  const redirectUri = apple ? env.APPLE_REDIRECT_URI : env.GOOGLE_REDIRECT_URI;
  const parameters: Record<string, string> = {
    redirect_uri: redirectUri,
    response_type: 'code',
    response_mode: apple ? 'form_post' : 'query',
    scope: apple ? 'openid email name' : 'openid email profile',
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  };
  return buildAuthorizationUrl(config, parameters).toString();
}

export async function exchangeProviderAuthorizationCode(
  provider: ExternalAuthProvider,
  parameters: Record<string, string>,
  redirectUri: string,
  expectedState: string,
  expectedNonce: string,
  codeVerifier: string,
): Promise<{ claims: Record<string, unknown> }> {
  const config = await getConfiguration(provider);
  const apple = provider === AuthProvider.APPLE;
  const callback = apple
    ? new Request(redirectUri, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(parameters),
      })
    : new URL(`${redirectUri}?${new URLSearchParams(parameters).toString()}`);

  const tokens = await authorizationCodeGrant(config, callback, {
    expectedState,
    expectedNonce,
    pkceCodeVerifier: codeVerifier,
    idTokenExpected: true,
  });
  const claims = tokens.claims();
  if (!claims || typeof claims !== 'object') {
    throw new HttpError(401, 'O provedor não retornou uma identidade verificável.');
  }
  return { claims: claims as Record<string, unknown> };
}
