/** Default DELETE batch size for recycle purge-all (SQLite variable limit ~999). */
export const PURGE_ALL_CHUNK = 200;

/** Prefer smaller chunks under memory pressure; larger for big soft-delete sets. */
export function purgeChunkSize(totalIds: number): number {
  if (totalIds > 5000) return 250;
  if (totalIds > 2000) return 200;
  if (totalIds > 500) return 150;
  return 100;
}
