import { describe, expect, it } from 'vitest';
import { env } from '../config/env.js';
import {
  LEGACY_SESSION_COOKIE,
  readAuthSessionCookie,
  SESSION_COOKIE,
  sessionCookieOptions,
} from './crypto.js';

describe('cookie da sessão para API', () => {
  it('prioriza o cookie atual e aceita sessões legadas durante a transição', () => {
    expect(readAuthSessionCookie(`${SESSION_COOKIE}=nova`)).toBe('nova');
    expect(readAuthSessionCookie(`${LEGACY_SESSION_COOKIE}=legada`)).toBe('legada');
    expect(readAuthSessionCookie(`${LEGACY_SESSION_COOKIE}=legada; ${SESSION_COOKIE}=nova`)).toBe(
      'nova',
    );
  });

  it('mantém as proteções do cookie e amplia seu caminho apenas à API', () => {
    expect(sessionCookieOptions()).toMatchObject({
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/v1',
    });
  });
});
