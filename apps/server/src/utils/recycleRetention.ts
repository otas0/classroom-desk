import { RECYCLE_RETENTION_DAYS } from '@classroom-desk/shared';

export { RECYCLE_RETENTION_DAYS };

const MS_PER_DAY = 86_400_000;

export type RecycleTiming = {
  expiresAt: string | null;
  daysLeft: number | null;
  /** True when purge job would hard-delete (deleted_at < now - retention). */
  expired: boolean;
};

/**
 * Align list “剩余 N 天” with purgeExpiredSoftDeletes cutoff.
 * Purge uses: deleted_at < now - retentionDays (strict).
 */
export function recycleTiming(
  deletedAt: string | null | undefined,
  nowMs: number = Date.now(),
  retentionDays: number = RECYCLE_RETENTION_DAYS,
): RecycleTiming {
  const deletedMs = Date.parse(String(deletedAt ?? ''));
  if (!Number.isFinite(deletedMs)) {
    return { expiresAt: null, daysLeft: null, expired: false };
  }
  const expiresAtMs = deletedMs + retentionDays * MS_PER_DAY;
  const cutoffMs = nowMs - retentionDays * MS_PER_DAY;
  const expired = deletedMs < cutoffMs;
  const daysLeft = Math.max(0, Math.ceil((expiresAtMs - nowMs) / MS_PER_DAY));
  return {
    expiresAt: new Date(expiresAtMs).toISOString(),
    daysLeft,
    expired,
  };
}

/** ISO cutoff used by purge job: rows with deleted_at < cutoff are removed. */
export function recyclePurgeCutoffIso(
  nowMs: number = Date.now(),
  retentionDays: number = RECYCLE_RETENTION_DAYS,
): string {
  return new Date(nowMs - retentionDays * MS_PER_DAY).toISOString();
}
