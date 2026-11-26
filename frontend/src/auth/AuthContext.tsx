import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { apiUrl } from '../lib/api';
import { AuthContext } from './context';

export type AuthUser = {
  id: string;
  fullName: string;
  email: string;
  role: 'FUNCIONARIO' | 'TI';
  unit: { id: string; name: string };
  department: { id: string; name: string };
  authProviders: string[];
};
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    try {
      const response = await fetch(apiUrl('/api/v1/auth/session'), { credentials: 'include' });
      if (!response.ok) {
        setUser(null);
        setCsrfToken(null);
        return;
      }
      const data = await response.json();
      setUser(data.user);
      setCsrfToken(data.csrfToken);
    } catch {
      setUser(null);
      setCsrfToken(null);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    let mounted = true;
    fetch(apiUrl('/api/v1/auth/session'), { credentials: 'include' })
      .then(async (response) => {
        if (!response.ok) return null;
        return response.json();
      })
      .then((data) => {
        if (mounted && data) {
          setUser(data.user);
          setCsrfToken(data.csrfToken);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);
  const request = useCallback(
    (path: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      if (csrfToken && init.method && init.method.toUpperCase() !== 'GET')
        headers.set('x-csrf-token', csrfToken);
      if (init.body && !headers.has('content-type'))
        headers.set('content-type', 'application/json');
      return fetch(apiUrl(`/api/v1/auth${path}`), { ...init, headers, credentials: 'include' });
    },
    [csrfToken],
  );
  const value = useMemo(
    () => ({ user, csrfToken, loading, refresh, request }),
    [user, csrfToken, loading, refresh, request],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
