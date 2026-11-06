import type { DatabaseSync } from 'node:sqlite';
import { getSetting } from '../db/migrate.js';
import { newId, nowIso } from '../utils/id.js';
import { hashPassword, verifyAdminPassword, verifyPassword } from './auth.js';

const KEY_LOCKED = 'client_exit_locked';
const KEY_UNTIL = 'client_exit_unlock_until';
const KEY_CODE_HASH = 'exit_unlock_code_hash';

const MAX_FAILS = 5;
const WINDOW_MS = 15 * 60_000;
const LOCKOUT_MS = 15 * 60_000;

type AttemptBucket = { fails: number[]; lockedUntil: number };
/** In-memory rate limit by client key (IP). Single classroom server process. */
const attemptBuckets = new Map<string, AttemptBucket>();

export function upsertSetting(db: DatabaseSync, key: string, value: string) {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, value);
}

export function recordExitLockEvent(
  db: DatabaseSync,
  input: {
    kind: string;
    actorUserId?: string | null;
    actorRole?: string | null;
    detail?: string;
    clientIp?: string | null;
  },
) {
  db.prepare(
    `INSERT INTO exit_lock_events (id, kind, actor_user_id, actor_role, detail, client_ip, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    newId(),
    input.kind,
    input.actorUserId ?? null,
    input.actorRole ?? null,
    input.detail ?? '',
    input.clientIp ?? null,
    nowIso(),
  );
}

export function listExitLockEvents(db: DatabaseSync, limit = 50) {
  const n = Math.min(200, Math.max(1, Math.trunc(limit)));
  return db
    .prepare(
      `SELECT id, kind, actor_user_id AS actorUserId, actor_role AS actorRole,
              detail, client_ip AS clientIp, created_at AS createdAt
       FROM exit_lock_events ORDER BY created_at DESC LIMIT ?`,
    )
    .all(n);
}

/** Default: locked. Teacher may open a timed unlock window or set locked=0. */
export function isClientExitAllowed(db: DatabaseSync): boolean {
  const locked = (getSetting(db, KEY_LOCKED) ?? '1') !== '0';
  if (!locked) return true;
  const until = getSetting(db, KEY_UNTIL);
  if (!until) return false;
  const t = Date.parse(until);
  return Number.isFinite(t) && t > Date.now();
}

export function getClientExitLockState(db: DatabaseSync) {
  const locked = (getSetting(db, KEY_LOCKED) ?? '1') !== '0';
  const untilRaw = getSetting(db, KEY_UNTIL);
  const untilMs = untilRaw ? Date.parse(untilRaw) : NaN;
  const unlockUntil =
    untilRaw && Number.isFinite(untilMs) && untilMs > Date.now() ? new Date(untilMs).toISOString() : null;
  return {
    clientExitLocked: locked,
    clientExitAllowed: isClientExitAllowed(db),
    clientExitUnlockUntil: unlockUntil,
    hasExitUnlockCode: Boolean(getSetting(db, KEY_CODE_HASH)),
  };
}

export function grantBatchExitUnlock(
  db: DatabaseSync,
  minutes: number,
  meta?: { actorUserId?: string; actorRole?: string; clientIp?: string },
) {
  const mins = Math.min(240, Math.max(1, Math.trunc(minutes)));
  const until = new Date(Date.now() + mins * 60_000).toISOString();
  upsertSetting(db, KEY_LOCKED, '1');
  upsertSetting(db, KEY_UNTIL, until);
  recordExitLockEvent(db, {
    kind: 'batch_unlock',
    actorUserId: meta?.actorUserId,
    actorRole: meta?.actorRole,
    detail: `minutes=${mins};until=${until}`,
    clientIp: meta?.clientIp,
  });
  return { minutes: mins, until };
}

export function relockClientExit(
  db: DatabaseSync,
  meta?: { actorUserId?: string; actorRole?: string; clientIp?: string },
) {
  upsertSetting(db, KEY_LOCKED, '1');
  upsertSetting(db, KEY_UNTIL, '');
  recordExitLockEvent(db, {
    kind: 'relock',
    actorUserId: meta?.actorUserId,
    actorRole: meta?.actorRole,
    detail: 'relock',
    clientIp: meta?.clientIp,
  });
}

export function setClientExitLockedFlag(
  db: DatabaseSync,
  locked: boolean,
  meta?: { actorUserId?: string; actorRole?: string; clientIp?: string },
) {
  upsertSetting(db, KEY_LOCKED, locked ? '1' : '0');
  if (locked) upsertSetting(db, KEY_UNTIL, '');
  recordExitLockEvent(db, {
    kind: locked ? 'relock' : 'unlock_flag_off',
    actorUserId: meta?.actorUserId,
    actorRole: meta?.actorRole,
    detail: `clientExitLocked=${locked ? '1' : '0'}`,
    clientIp: meta?.clientIp,
  });
}

export async function setExitUnlockCode(
  db: DatabaseSync,
  code: string,
  meta?: { actorUserId?: string; actorRole?: string; clientIp?: string },
) {
  const trimmed = code.trim();
  if (trimmed.length < 6) {
    return { ok: false as const, error: 'invalid_exit_unlock_code', message: '解除码至少 6 位' };
  }
  const hash = await hashPassword(trimmed);
  upsertSetting(db, KEY_CODE_HASH, hash);
  recordExitLockEvent(db, {
    kind: 'code_set',
    actorUserId: meta?.actorUserId,
    actorRole: meta?.actorRole,
    detail: 'exit_unlock_code_updated',
    clientIp: meta?.clientIp,
  });
  return { ok: true as const };
}

function getBucket(key: string): AttemptBucket {
  let b = attemptBuckets.get(key);
  if (!b) {
    b = { fails: [], lockedUntil: 0 };
    attemptBuckets.set(key, b);
  }
  return b;
}

export function getExitUnlockRateLimit(clientKey: string): {
  limited: boolean;
  retryAfterSec: number;
  failsInWindow: number;
} {
  const now = Date.now();
  const b = getBucket(clientKey || 'unknown');
  if (b.lockedUntil > now) {
    return {
      limited: true,
      retryAfterSec: Math.ceil((b.lockedUntil - now) / 1000),
      failsInWindow: b.fails.length,
    };
  }
  b.fails = b.fails.filter((t) => now - t < WINDOW_MS);
  return { limited: false, retryAfterSec: 0, failsInWindow: b.fails.length };
}

function noteExitUnlockFailure(clientKey: string): { limited: boolean; retryAfterSec: number } {
  const now = Date.now();
  const b = getBucket(clientKey || 'unknown');
  b.fails = b.fails.filter((t) => now - t < WINDOW_MS);
  b.fails.push(now);
  if (b.fails.length >= MAX_FAILS) {
    b.lockedUntil = now + LOCKOUT_MS;
    b.fails = [];
    return { limited: true, retryAfterSec: Math.ceil(LOCKOUT_MS / 1000) };
  }
  return { limited: false, retryAfterSec: 0 };
}

function clearExitUnlockFailures(clientKey: string) {
  attemptBuckets.delete(clientKey || 'unknown');
}

/** Accept dedicated exit unlock code, else classroom admin password. Rate-limited by clientKey. */
export async function attemptExitUnlock(
  db: DatabaseSync,
  code: string,
  meta?: { clientIp?: string | null },
): Promise<
  | { ok: true }
  | { ok: false; error: string; message: string; status: number; retryAfterSec?: number }
> {
  const clientKey = String(meta?.clientIp ?? 'unknown');
  const rl = getExitUnlockRateLimit(clientKey);
  if (rl.limited) {
    recordExitLockEvent(db, {
      kind: 'code_rate_limited',
      detail: `retryAfterSec=${rl.retryAfterSec}`,
      clientIp: meta?.clientIp,
    });
    return {
      ok: false,
      error: 'exit_unlock_rate_limited',
      message: `尝试过多，请 ${rl.retryAfterSec} 秒后再试`,
      status: 429,
      retryAfterSec: rl.retryAfterSec,
    };
  }

  const trimmed = String(code ?? '').trim();
  if (!trimmed) {
    return { ok: false, error: 'password_required', message: '请输入解除码', status: 400 };
  }

  const codeHash = getSetting(db, KEY_CODE_HASH);
  let matched = false;
  if (codeHash && (await verifyPassword(trimmed, codeHash))) matched = true;
  else if (await verifyAdminPassword(db, trimmed)) matched = true;

  if (!matched) {
    const after = noteExitUnlockFailure(clientKey);
    recordExitLockEvent(db, {
      kind: after.limited ? 'code_rate_limited' : 'code_fail',
      detail: after.limited ? `lockoutSec=${after.retryAfterSec}` : 'invalid_code',
      clientIp: meta?.clientIp,
    });
    if (after.limited) {
      return {
        ok: false,
        error: 'exit_unlock_rate_limited',
        message: `尝试过多，请 ${after.retryAfterSec} 秒后再试`,
        status: 429,
        retryAfterSec: after.retryAfterSec,
      };
    }
    return { ok: false, error: 'invalid_exit_unlock_code', message: '解除码错误', status: 401 };
  }

  clearExitUnlockFailures(clientKey);
  recordExitLockEvent(db, {
    kind: 'code_ok',
    detail: 'local_exit_unlocked',
    clientIp: meta?.clientIp,
  });
  return { ok: true };
}

/** @deprecated use attemptExitUnlock */
export async function verifyExitUnlockCode(db: DatabaseSync, code: string): Promise<boolean> {
  const r = await attemptExitUnlock(db, code, { clientIp: 'legacy' });
  return r.ok;
}
