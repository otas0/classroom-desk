import { randomInt } from 'node:crypto';

type Entry = { code: string; sha256: string; fileName: string; expiresAt: number };

const pending = new Map<string, Entry>();

function key(actorId: string, sha256: string): string {
  return `${actorId}:${sha256}`;
}

/** Issue a short confirm code after restore preview; TTL 10 minutes. */
export function issueRestoreConfirmCode(opts: {
  actorId: string;
  sha256: string;
  fileName: string;
}): string {
  const code = String(randomInt(100000, 999999));
  pending.set(key(opts.actorId, opts.sha256), {
    code,
    sha256: opts.sha256,
    fileName: opts.fileName,
    expiresAt: Date.now() + 10 * 60_000,
  });
  return code;
}

export function consumeRestoreConfirmCode(opts: {
  actorId: string;
  sha256: string;
  code: string;
}): { ok: true } | { ok: false; error: string } {
  const k = key(opts.actorId, opts.sha256);
  const row = pending.get(k);
  if (!row) return { ok: false, error: 'confirm_code_missing' };
  if (row.expiresAt < Date.now()) {
    pending.delete(k);
    return { ok: false, error: 'confirm_code_expired' };
  }
  if (String(opts.code).trim() !== row.code) {
    return { ok: false, error: 'confirm_code_mismatch' };
  }
  pending.delete(k);
  return { ok: true };
}
