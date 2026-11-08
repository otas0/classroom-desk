import { t } from '@classroom-desk/i18n';
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

export class ApiError extends Error {
  error?: string;
  status: number;
  retryAfterSec?: number;
  remainingAttempts?: number;
  maxFails?: number;

  constructor(
    message: string,
    opts: {
      error?: string;
      status: number;
      retryAfterSec?: number;
      remainingAttempts?: number;
      maxFails?: number;
    },
  ) {
    super(message);
    this.name = 'ApiError';
    this.error = opts.error;
    this.status = opts.status;
    this.retryAfterSec = opts.retryAfterSec;
    this.remainingAttempts = opts.remainingAttempts;
    this.maxFails = opts.maxFails;
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
    const body = data as {
      error?: string;
      message?: string;
      retryAfterSec?: number;
      remainingAttempts?: number;
      maxFails?: number;
    };
    throw new ApiError(body.message || zhError(body.error) || `请求失败（${res.status}）`, {
      error: body.error,
      status: res.status,
      retryAfterSec: body.retryAfterSec,
      remainingAttempts: body.remainingAttempts,
      maxFails: body.maxFails,
    });
  }
  return data as T;
}

function zhError(code?: string): string | undefined {
  if (!code) return undefined;
  const map: Record<string, string> = {
    offline: t('无法连接教师机'),
    unauthorized: t('请先点选自己的姓名'),
    forbidden: t('无权限'),
    no_class: t('本机未指派班级'),
    session_closed: t('今日签到场次已关闭'),
    already_checked_in: t('今日已签到'),
    invalid_request: t('请求无效'),
    messages_disabled: t('留言已关闭'),
    not_found: t('未找到'),
    invalid_credentials: t('账号或密码错误'),
    invalid_admin_password: t('管理密码错误'),
    invalid_exit_unlock_code: t('解除码错误'),
    exit_unlock_rate_limited: t('尝试过多，请稍后再试'),
    exit_locked: t('课堂锁定中，无法退出'),
    password_required: t('请输入解除码'),
    invalid_message: t('留言内容不能为空'),
    already_answered: t('本题已作答'),
    cannot_message_self: t('不能给自己留言'),
    peer_not_in_class: t('只能发给本班同学'),
    account_deleted: t('账号已删除，请重新选择身份'),
    session_kicked: t('账号已下线，请重新选择身份'),
    account_disabled: t('账号已停用'),
  };
  return map[code] ?? code;
}

export function isSessionEndedError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return /账号已删除|账号已下线|account_deleted|session_kicked/i.test(err.message);
}

export { getApiBase as API_BASE_FN };
/** @deprecated use getApiBase() — kept for existing imports */
export const API_BASE = runtimeApiBase;
