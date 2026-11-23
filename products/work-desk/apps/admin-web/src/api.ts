import type { DayTimeSummary, PublicUser, Role } from '@work-desk/shared';

const TOKEN_KEY = 'workdesk.admin.token';

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
  bootstrapStatus: () => api<{ needsBootstrap: boolean }>('/api/v1/auth/bootstrap-status'),
  bootstrap: (body: { displayName: string; username: string; password: string }) =>
    api<{ token: string; user: PublicUser }>('/api/v1/auth/bootstrap', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  login: (body: { username: string; password: string }) =>
    api<{ token: string; user: PublicUser }>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  me: () => api<{ user: PublicUser }>('/api/v1/auth/me'),
  departments: () =>
    api<{
      departments: {
        id: string;
        name: string;
        standardMinutes: number;
        memberCount: number;
      }[];
    }>('/api/v1/departments'),
  createDepartment: (body: { name: string; standardMinutes?: number }) =>
    api('/api/v1/departments', { method: 'POST', body: JSON.stringify(body) }),
  employees: () =>
    api<{
      employees: {
        id: string;
        role: Role;
        displayName: string;
        username: string;
        employeeNo: string | null;
        departmentId: string | null;
        departmentName: string | null;
        disabledAt: string | null;
      }[];
    }>('/api/v1/employees'),
  createEmployee: (body: {
    displayName: string;
    username: string;
    password: string;
    role: Role;
    employeeNo?: string;
    departmentId?: string;
  }) => api('/api/v1/employees', { method: 'POST', body: JSON.stringify(body) }),
  daySummaries: (date: string) =>
    api<{ date: string; summaries: DayTimeSummary[] }>(`/api/v1/time/day/${date}`),
  reviewOvertime: (userId: string, date: string, status: 'confirmed' | 'rejected') =>
    api(`/api/v1/time/overtime/${userId}/${date}/review`, {
      method: 'POST',
      body: JSON.stringify({ status }),
    }),
};
