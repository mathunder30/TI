import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import type { Response } from 'express';
import { env } from '../config/env.js';
import { prisma } from '../db/prisma.js';

export const SESSION_COOKIE = 'sc_api_session';
export const LEGACY_SESSION_COOKIE = 'sc_auth_session';
export const OAUTH_STATE_COOKIE = 'sc_oauth_state';
export const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export function createOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function hashSecret(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function constantTimeStringEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function encryptionKey(): Buffer {
  return createHash('sha256').update(env.SESSION_SECRET).digest();
}

export function encryptEphemeralSecret(value: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString('base64url')).join('.');
}

export function decryptEphemeralSecret(value: string): string {
  const [encodedIv, encodedTag, encodedCiphertext] = value.split('.');
  if (!encodedIv || !encodedTag || !encodedCiphertext) throw new Error('Segredo OAuth inválido.');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    encryptionKey(),
    Buffer.from(encodedIv, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(encodedTag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(encodedCiphertext, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/api/v1',
    maxAge: SESSION_TTL_MS,
  };
}

export function clearSessionCookie(response: Response): void {
  response.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/v1',
  });
  response.clearCookie(LEGACY_SESSION_COOKIE, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/v1/auth',
  });
}

export function readAuthSessionCookie(cookieHeader: string | undefined): string | undefined {
  return (
    readCookie(cookieHeader, SESSION_COOKIE) ?? readCookie(cookieHeader, LEGACY_SESSION_COOKIE)
  );
}

export function setOAuthStateCookie(response: Response, state: string): void {
  response.cookie(OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    path: '/api/v1/auth/oauth',
    maxAge: 10 * 60 * 1000,
  });
}

export function clearOAuthStateCookie(response: Response): void {
  response.clearCookie(OAUTH_STATE_COOKIE, {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    path: '/api/v1/auth/oauth',
  });
}

export async function createAuthSession(userId: string, response: Response) {
  const rawSessionToken = createOpaqueToken();
  const csrfToken = createOpaqueToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await prisma.authSession.create({
    data: {
      userId,
      tokenHash: hashSecret(rawSessionToken),
      csrfTokenHash: hashSecret(csrfToken),
      csrfTokenEncrypted: encryptEphemeralSecret(csrfToken),
      expiresAt,
    },
  });

  response.cookie(SESSION_COOKIE, rawSessionToken, sessionCookieOptions());
  return { csrfToken, expiresAt };
}

export function readCookie(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) {
      try {
        return decodeURIComponent(value.join('='));
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}
