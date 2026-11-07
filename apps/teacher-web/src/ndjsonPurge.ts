import { API_BASE, getToken } from './api';

export type PurgeProgress = {
  purged: number;
  total: number;
  pct: number;
  done: boolean;
  message?: string;
};

/** POST with Accept: NDJSON; invoke onProgress for each chunk line. */
export async function streamPurgeAll(
  path: string,
  body: Record<string, unknown>,
  onProgress: (p: PurgeProgress) => void,
): Promise<PurgeProgress> {
  const token = getToken() || '';
  const res = await fetch(`${API_BASE}${path}?stream=1`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/x-ndjson',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ ...body, stream: 1 }),
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = (await res.json()) as { message?: string; error?: string };
      msg = j.message || j.error || msg;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  const text = await res.text();
  let last: PurgeProgress = { purged: 0, total: 0, pct: 0, done: false };
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const row = JSON.parse(trimmed) as PurgeProgress & { type?: string; ok?: boolean };
      last = {
        purged: Number(row.purged ?? 0),
        total: Number(row.total ?? 0),
        pct: Number(row.pct ?? 0),
        done: Boolean(row.done || row.type === 'done'),
        message: row.message,
      };
      onProgress(last);
    } catch {
      /* skip bad line */
    }
  }
  return last;
}
