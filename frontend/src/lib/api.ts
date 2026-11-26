const apiBaseUrl = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') ?? '';

export function apiUrl(path: string): string {
  return `${apiBaseUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

export function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData) && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  return fetch(apiUrl(path), {
    ...init,
    headers,
    credentials: 'include',
  });
}

export async function apiErrorMessage(response: Response): Promise<string> {
  const body = await response.json().catch(() => null);
  return body?.error?.message || body?.message || 'Não foi possível carregar os dados.';
}
