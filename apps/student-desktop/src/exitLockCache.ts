/** Local cache of last-known exit-lock state for offline / reconnect reconcile. */

const KEY = 'cd_exit_lock_cache';

export type ExitLockCache = {
  allowed: boolean;
  until: string | null;
  cachedAt: string;
};

export function readExitLockCache(): ExitLockCache | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ExitLockCache;
    if (typeof parsed?.allowed !== 'boolean') return null;
    return {
      allowed: parsed.allowed,
      until: parsed.until ?? null,
      cachedAt: parsed.cachedAt || new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function writeExitLockCache(allowed: boolean, until: string | null): ExitLockCache {
  const next: ExitLockCache = {
    allowed,
    until,
    cachedAt: new Date().toISOString(),
  };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* quota / private mode */
  }
  return next;
}

/** True when local cache disagrees with server authority. */
export function exitLockCacheConflicts(
  cache: ExitLockCache | null,
  serverAllowed: boolean,
  serverUntil: string | null,
): boolean {
  if (!cache) return false;
  if (cache.allowed !== serverAllowed) return true;
  const a = cache.until ?? '';
  const b = serverUntil ?? '';
  return a !== b;
}
