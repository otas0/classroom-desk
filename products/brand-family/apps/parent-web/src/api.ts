import type {
  AppRule,
  ChildProfile,
  DevicePlatform,
  DeviceRecord,
  PublicUser,
  RuleAction,
  WebRule,
} from '@brand-family/shared';

const TOKEN_KEY = 'brandfamily.parent.token';

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
  children: () => api<{ children: ChildProfile[] }>('/api/v1/children'),
  createChild: (body: { displayName: string; note?: string }) =>
    api<{ child: ChildProfile }>('/api/v1/children', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  deleteChild: (id: string) => api<{ ok: boolean }>(`/api/v1/children/${id}`, { method: 'DELETE' }),
  devices: () => api<{ devices: DeviceRecord[] }>('/api/v1/devices'),
  createDevice: (body: { childId: string; name: string; platform: DevicePlatform }) =>
    api<{ device: DeviceRecord }>('/api/v1/devices', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  deleteDevice: (id: string) => api<{ ok: boolean }>(`/api/v1/devices/${id}`, { method: 'DELETE' }),
  webRules: () => api<{ rules: WebRule[] }>('/api/v1/web-rules'),
  createWebRule: (body: { childId: string; domain: string; action: RuleAction }) =>
    api<{ rule: WebRule }>('/api/v1/web-rules', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  deleteWebRule: (id: string) =>
    api<{ ok: boolean }>(`/api/v1/web-rules/${id}`, { method: 'DELETE' }),
  appRules: () => api<{ rules: AppRule[] }>('/api/v1/app-rules'),
  createAppRule: (body: {
    childId: string;
    appId: string;
    appLabel?: string;
    action: RuleAction;
  }) =>
    api<{ rule: AppRule }>('/api/v1/app-rules', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  deleteAppRule: (id: string) =>
    api<{ ok: boolean }>(`/api/v1/app-rules/${id}`, { method: 'DELETE' }),
};
