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
    const body = data as { error?: string; message?: string };
    throw new Error(body.message || zhError(body.error) || `请求失败（${res.status}）`);
  }
  return data as T;
}

function zhError(code?: string): string | undefined {
  if (!code) return undefined;
  const map: Record<string, string> = {
    offline: '无法连接教师机',
    unauthorized: '请先点选自己的姓名',
    forbidden: '无权限',
    no_class: '本机未指派班级',
    session_closed: '今日签到场次已关闭',
    already_checked_in: '今日已签到',
    invalid_request: '请求无效',
    messages_disabled: '留言已关闭',
    not_found: '未找到',
    invalid_credentials: '账号或密码错误',
    invalid_admin_password: '管理密码错误',
    invalid_exit_unlock_code: '解除码错误',
    exit_unlock_rate_limited: '尝试过多，请稍后再试',
    exit_locked: '课堂锁定中，无法退出',
    password_required: '请输入解除码',
    invalid_message: '留言内容不能为空',
    already_answered: '本题已作答',
    cannot_message_self: '不能给自己留言',
    peer_not_in_class: '只能发给本班同学',
  };
  return map[code] ?? code;
}

export { getApiBase as API_BASE_FN };
/** @deprecated use getApiBase() — kept for existing imports */
export const API_BASE = runtimeApiBase;
