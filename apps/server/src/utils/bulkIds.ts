/** Parse unique non-empty string ids from a request body array. */
export function parseIdList(raw: unknown, max = 500): string[] {
  if (!Array.isArray(raw)) return [];
  const ids = [
    ...new Set(
      (raw as unknown[])
        .map((x) => String(x ?? '').trim())
        .filter((x): x is string => x.length > 0),
    ),
  ];
  return ids.slice(0, max);
}

/** Build `?,?,?` placeholders for an IN (...) clause. */
export function sqlInPlaceholders(count: number): string {
  if (count <= 0) return '';
  return Array.from({ length: count }, () => '?').join(',');
}

/** Split ids into chunks (SQLite variable limit ~999). */
export function chunkIds(ids: string[], size = 200): string[][] {
  if (ids.length === 0) return [];
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += size) {
    out.push(ids.slice(i, i + size));
  }
  return out;
}
