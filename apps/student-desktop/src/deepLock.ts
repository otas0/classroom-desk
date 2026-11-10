import {
  normalizeDeepLockState,
  normalizeDeepLockStore,
  resolveDeepLockState,
  type DeepLockState,
  type DeepLockStore,
} from '@classroom-desk/shared';

export type { DeepLockState, DeepLockStore };

export function parseDeepLockPayload(
  raw: unknown,
  classId: string,
): DeepLockState {
  if (!raw || typeof raw !== 'object') {
    return resolveDeepLockState(normalizeDeepLockStore(null), classId);
  }
  const o = raw as {
    store?: unknown;
    global?: unknown;
    state?: unknown;
  };
  if (o.store != null) {
    return resolveDeepLockState(normalizeDeepLockStore(o.store), classId);
  }
  if (o.state != null) return normalizeDeepLockState(o.state);
  if (o.global != null) return normalizeDeepLockState(o.global);
  return resolveDeepLockState(normalizeDeepLockStore(null), classId);
}

export function deepLockBannerText(
  state: DeepLockState,
  t: (msgid: string, vars?: Record<string, string | number>) => string = (s) => s,
): string {
  if (state.frozen) return t('教师已冻结本机：请等待指令。切走窗口将记为违规。');
  if (state.netMode === 'allowlist') {
    const hosts = state.allowlistHosts.length
      ? state.allowlistHosts.join(', ')
      : t('（教师指定域名）');
    return t('考试上网白名单中：仅允许 {v0}。切走窗口将记为违规。', { v0: hosts });
  }
  if (state.netMode === 'deny') return t('教师已断开公网访问（校网策略）。');
  return '';
}
