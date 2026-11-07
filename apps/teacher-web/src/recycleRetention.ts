/** Keep in sync with apps/server/src/utils/recycleRetention.ts */
export const RECYCLE_RETENTION_DAYS = 7;

const MS_PER_DAY = 86_400_000;

export function recycleDaysLeft(
  deletedAt: unknown,
  retentionDays = RECYCLE_RETENTION_DAYS,
  nowMs = Date.now(),
): number | null {
  const deletedMs = Date.parse(String(deletedAt ?? ''));
  if (!Number.isFinite(deletedMs)) return null;
  const expiresAtMs = deletedMs + retentionDays * MS_PER_DAY;
  return Math.max(0, Math.ceil((expiresAtMs - nowMs) / MS_PER_DAY));
}

/** Unified copy for student & question recycle rows. */
export function formatRecycleDaysLeft(daysLeft: number | null | undefined): string | null {
  if (daysLeft == null || !Number.isFinite(Number(daysLeft))) return null;
  const n = Math.max(0, Math.floor(Number(daysLeft)));
  return n === 0 ? '剩余不足 1 天' : `剩余 ${n} 天`;
}

export const RECYCLE_DAYS_LEFT_TESTID = 'recycle-days-left';
