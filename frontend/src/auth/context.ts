import { createContext } from 'react';
import type { AuthUser } from './AuthContext';

export type AuthState = {
  user: AuthUser | null;
  csrfToken: string | null;
  loading: boolean;
  refresh: () => Promise<void>;
  request: (path: string, init?: RequestInit) => Promise<Response>;
};

export const AuthContext = createContext<AuthState | null>(null);
