import { API_BASE, getToken } from './api';

export type PurgeProgress = {
  purged: number;
  total: number;
  pct: number;
  done: boolean;
  message?: string;
};

function parseProgressLine(trimmed: string): PurgeProgress | null {
  try {
    const row = JSON.parse(trimmed) as PurgeProgress & { type?: string; ok?: boolean };
    return {
      purged: Number(row.purged ?? 0),
      total: Number(row.total ?? 0),
      pct: Number(row.pct ?? 0),
      done: Boolean(row.done || row.type === 'done'),
      message: row.message,
    };
  } catch {
    return null;
  }
}

/** POST with Accept: NDJSON; stream lines via ReadableStream (no full-body buffer). */
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

  let last: PurgeProgress = { purged: 0, total: 0, pct: 0, done: false };
  const reader = res.body?.getReader();
  if (!reader) {
    // Fallback if body missing (rare)
    const text = await res.text();
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const p = parseProgressLine(trimmed);
      if (p) {
        last = p;
        onProgress(last);
      }
    }
    return last;
  }

  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      const trimmed = line.trim();
      if (!trimmed) continue;
      const p = parseProgressLine(trimmed);
      if (p) {
        last = p;
        onProgress(last);
      }
    }
  }
  const tail = buf.trim();
  if (tail) {
    const p = parseProgressLine(tail);
    if (p) {
      last = p;
      onProgress(last);
    }
  }
  return last;
}
