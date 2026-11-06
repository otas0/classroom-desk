const TOKEN_KEY = 'classroom-desk.token';
const API_BASE_KEY = 'classroom-desk.api-base';

let runtimeApiBase = localStorage.getItem(API_BASE_KEY) ?? import.meta.env.VITE_API_BASE ?? 'http://127.0.0.1:8787';

export function getApiBase(): string {
  return runtimeApiBase.replace(/\/$/, '');
}

export async function initApiBase(): Promise<string> {
  try {
    if (window.classroomDesk?.getConfig) {
      const cfg = await window.classroomDesk.getConfig();
      if (cfg?.apiBase) {
        runtimeApiBase = cfg.apiBase.replace(/\/$/, '');
        localStorage.setItem(API_BASE_KEY, runtimeApiBase);
      }
    }
  } catch {
    // browser/dev without preload
  }
  return getApiBase();
}

export async function setApiBase(apiBase: string): Promise<string> {
  runtimeApiBase = apiBase.replace(/\/$/, '');
  localStorage.setItem(API_BASE_KEY, runtimeApiBase);
  if (window.classroomDesk?.setApiBase) {
    await window.classroomDesk.setApiBase(runtimeApiBase);
  }
  return runtimeApiBase;
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiOfflineError extends Error {
  constructor(message = 'offline') {
    super(message);
    this.name = 'ApiOfflineError';
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json');
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  let res: Response;
  try {
    res = await fetch(`${getApiBase()}${path}`, { ...init, headers });
  } catch {
    throw new ApiOfflineError();
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error ?? `http_${res.status}`);
  }
  return data as T;
}

export { getApiBase as API_BASE_FN };
/** @deprecated use getApiBase() — kept for existing imports */
export const API_BASE = runtimeApiBase;
