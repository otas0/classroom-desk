/**
 * Same-origin by default so /admin opened via 教师机局域网 IP works for student/teacher browsers.
 * Override only for local Vite: VITE_API_BASE=http://127.0.0.1:8787
 */
function resolveApiBase(): string {
  const fromEnv = import.meta.env.VITE_API_BASE;
  if (fromEnv != null && String(fromEnv).trim() !== '') {
    return String(fromEnv).replace(/\/$/, '');
  }
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin.replace(/\/$/, '');
  }
  return 'http://127.0.0.1:8787';
}

const API_BASE = resolveApiBase();
const TOKEN_KEY = 'classroom-desk.teacher-token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('text/csv')) {
    const text = await res.text();
    if (!res.ok) throw new Error('export_failed');
    return text as T;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = data as { error?: string; message?: string };
    throw new Error(err.message ?? err.error ?? `http_${res.status}`);
  }
  return data as T;
}

export { API_BASE };
