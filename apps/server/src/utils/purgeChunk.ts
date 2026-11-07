/** Default DELETE batch size for recycle purge-all (SQLite variable limit ~999). */
export const PURGE_ALL_CHUNK = 200;

/** Prefer smaller chunks for very large sets so each txn stays short. */
export function purgeChunkSize(totalIds: number): number {
  if (totalIds > 10_000) return 200;
  if (totalIds > 5000) return 250;
  if (totalIds > 2000) return 200;
  if (totalIds > 500) return 150;
  return 100;
}

/** Warn / surface when a single DELETE chunk exceeds this (ms). */
export const PURGE_CHUNK_SLOW_MS = 2_000;

/** Prefer NDJSON progress stream when purge set is this large. */
export const PURGE_STREAM_HINT_MIN = 10_000;
