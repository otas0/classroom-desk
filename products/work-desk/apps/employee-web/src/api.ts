import type { DayTimeSummary, PublicUser } from '@work-desk/shared';

const TOKEN_KEY = 'workdesk.employee.token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set('Content-Type', 'application/json');
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(path, { ...init, headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `http_${res.status}`);
  return body as T;
}

export const client = {
  login: (body: { username: string; password: string }) =>
    api<{ token: string; user: PublicUser }>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  me: () => api<{ user: PublicUser }>('/api/v1/auth/me'),
  today: () => api<{ summary: DayTimeSummary }>('/api/v1/time/today'),
  clockIn: () =>
    api<{ summary: DayTimeSummary }>('/api/v1/time/clock-in', { method: 'POST', body: '{}' }),
  clockOut: () =>
    api<{ summary: DayTimeSummary }>('/api/v1/time/clock-out', { method: 'POST', body: '{}' }),
  presence: () =>
    api<{ summary: DayTimeSummary }>('/api/v1/time/presence', { method: 'POST', body: '{}' }),
};
