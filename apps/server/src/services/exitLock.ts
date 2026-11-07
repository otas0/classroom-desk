import { randomInt } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { getSetting } from '../db/migrate.js';
import { newId, nowIso } from '../utils/id.js';
import { hashPassword, verifyAdminPassword, verifyPassword } from './auth.js';
import { broadcastExitLockPayload } from './exitLockHub.js';
import {
  getInputLockStore,
  inputLockActive,
  resolveInputLock,
} from './inputLock.js';

const KEY_LOCKED = 'client_exit_locked';
const KEY_UNTIL = 'client_exit_unlock_until';
const KEY_CODE_HASH = 'exit_unlock_code_hash';
const KEY_CODE_SET_AT = 'exit_unlock_code_set_at';
const KEY_MAX_FAILS = 'exit_unlock_max_fails';
const KEY_WINDOW_MIN = 'exit_unlock_window_minutes';
const KEY_LOCKOUT_MIN = 'exit_unlock_lockout_minutes';
const KEY_ROTATE_DAYS = 'exit_unlock_code_rotate_days';

const DEFAULT_MAX_FAILS = 5;
const DEFAULT_WINDOW_MIN = 15;
const DEFAULT_LOCKOUT_MIN = 15;
const DEFAULT_ROTATE_DAYS = 90;
/** Minimum seconds between exit-unlock code rotations (manual or system-generated). */
export const EXIT_UNLOCK_ROTATE_MIN_SEC = 30;
/** Alphabet without ambiguous 0/O/1/I/L. */
const EXIT_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const EXIT_CODE_LEN = 8;

type AttemptBucket = { fails: number[]; lockedUntil: number };
const attemptBuckets = new Map<string, AttemptBucket>();

export function upsertSetting(db: DatabaseSync, key: string, value: string) {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, value);
}

function numSetting(db: DatabaseSync, key: string, fallback: number, min: number, max: number) {
  const n = Number(getSetting(db, key) ?? fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

export function getExitUnlockRateConfig(db: DatabaseSync) {
  return {
    exitUnlockMaxFails: numSetting(db, KEY_MAX_FAILS, DEFAULT_MAX_FAILS, 3, 30),
    exitUnlockWindowMinutes: numSetting(db, KEY_WINDOW_MIN, DEFAULT_WINDOW_MIN, 1, 1440),
    exitUnlockLockoutMinutes: numSetting(db, KEY_LOCKOUT_MIN, DEFAULT_LOCKOUT_MIN, 1, 1440),
    exitUnlockCodeRotateDays: numSetting(db, KEY_ROTATE_DAYS, DEFAULT_ROTATE_DAYS, 7, 365),
  };
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

export function listExitLockEvents(
  db: DatabaseSync,
  opts: { limit?: number; offset?: number; kind?: string } = {},
) {
  const n = Math.min(500, Math.max(1, Math.trunc(opts.limit ?? 50)));
  const offset = Math.max(0, Math.trunc(opts.offset ?? 0));
  const kind = opts.kind?.trim();
  if (kind) {
    return db
      .prepare(
        `SELECT id, kind, actor_user_id AS actorUserId, actor_role AS actorRole,
                detail, client_ip AS clientIp, created_at AS createdAt
         FROM exit_lock_events WHERE kind = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      )
      .all(kind, n, offset);
  }
  return db
    .prepare(
      `SELECT id, kind, actor_user_id AS actorUserId, actor_role AS actorRole,
              detail, client_ip AS clientIp, created_at AS createdAt
       FROM exit_lock_events ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    )
    .all(n, offset);
}

export function countExitLockEvents(db: DatabaseSync, kind?: string) {
  const k = kind?.trim();
  if (k) {
    const row = db.prepare(`SELECT COUNT(*) AS c FROM exit_lock_events WHERE kind = ?`).get(k) as {
      c: number;
    };
    return Number(row?.c ?? 0);
  }
  const row = db.prepare(`SELECT COUNT(*) AS c FROM exit_lock_events`).get() as { c: number };
  return Number(row?.c ?? 0);
}

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
  const rate = getExitUnlockRateConfig(db);
  const setAt = getSetting(db, KEY_CODE_SET_AT);
  const setAtMs = setAt ? Date.parse(setAt) : NaN;
  const ageDays =
    setAt && Number.isFinite(setAtMs)
      ? Math.floor((Date.now() - setAtMs) / (24 * 60 * 60_000))
      : null;
  const rotationDue =
    Boolean(getSetting(db, KEY_CODE_HASH)) &&
    ageDays != null &&
    ageDays >= rate.exitUnlockCodeRotateDays;
  // Flat global flags only on exit-lock channel — full store lives on /input-lock/stream.
  const inputLock = resolveInputLock(getInputLockStore(db));
  return {
    clientExitLocked: locked,
    clientExitAllowed: isClientExitAllowed(db),
    clientExitUnlockUntil: unlockUntil,
    hasExitUnlockCode: Boolean(getSetting(db, KEY_CODE_HASH)),
    exitUnlockCodeSetAt: setAt && Number.isFinite(setAtMs) ? new Date(setAtMs).toISOString() : null,
    exitUnlockCodeAgeDays: ageDays,
    exitUnlockCodeRotationDue: rotationDue,
    inputLock,
    inputLockActive: inputLockActive(inputLock),
    ...rate,
  };
}

function notifyClients(db: DatabaseSync) {
  try {
    broadcastExitLockPayload(getClientExitLockState(db));
  } catch {
    /* hub may not be attached yet in tests */
  }
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
  notifyClients(db);
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
  notifyClients(db);
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
  notifyClients(db);
}

/** Readable system exit-unlock code (never persisted in plaintext). */
export function generateExitUnlockCode(length = EXIT_CODE_LEN): string {
  const n = Math.min(32, Math.max(6, Math.trunc(length)));
  let out = '';
  for (let i = 0; i < n; i++) {
    out += EXIT_CODE_ALPHABET[randomInt(EXIT_CODE_ALPHABET.length)]!;
  }
  return out;
}

function rotateCooldownRemainingSec(db: DatabaseSync): number {
  const setAt = getSetting(db, KEY_CODE_SET_AT);
  const setAtMs = setAt ? Date.parse(setAt) : NaN;
  if (!setAt || !Number.isFinite(setAtMs)) return 0;
  const elapsed = Date.now() - setAtMs;
  const left = EXIT_UNLOCK_ROTATE_MIN_SEC * 1000 - elapsed;
  return left > 0 ? Math.ceil(left / 1000) : 0;
}

export async function setExitUnlockCode(
  db: DatabaseSync,
  code: string,
  meta?: {
    actorUserId?: string;
    actorRole?: string;
    clientIp?: string;
    detail?: string;
  },
) {
  const trimmed = code.trim();
  if (trimmed.length < 6) {
    return { ok: false as const, error: 'invalid_exit_unlock_code', message: '解除码至少 6 位' };
  }
  const hadCode = Boolean(getSetting(db, KEY_CODE_HASH));
  if (hadCode) {
    const wait = rotateCooldownRemainingSec(db);
    if (wait > 0) {
      return {
        ok: false as const,
        error: 'exit_unlock_rotate_too_soon',
        message: `解除码轮换最快 ${EXIT_UNLOCK_ROTATE_MIN_SEC} 秒一次，请 ${wait} 秒后再试`,
        retryAfterSec: wait,
      };
    }
  }
  const hash = await hashPassword(trimmed);
  upsertSetting(db, KEY_CODE_HASH, hash);
  upsertSetting(db, KEY_CODE_SET_AT, nowIso());
  recordExitLockEvent(db, {
    kind: hadCode ? 'code_rotated' : 'code_set',
    actorUserId: meta?.actorUserId,
    actorRole: meta?.actorRole,
    detail:
      meta?.detail ??
      (hadCode ? 'exit_unlock_code_rotated' : 'exit_unlock_code_set'),
    clientIp: meta?.clientIp,
  });
  notifyClients(db);
  return { ok: true as const, rotated: hadCode };
}

/**
 * System-generated rotation: new plaintext returned once; hashed in settings.
 * Enforces EXIT_UNLOCK_ROTATE_MIN_SEC between rotations.
 */
export async function rotateExitUnlockCodeGenerated(
  db: DatabaseSync,
  meta?: { actorUserId?: string; actorRole?: string; clientIp?: string },
) {
  let code = generateExitUnlockCode();
  const prevHash = getSetting(db, KEY_CODE_HASH);
  if (prevHash && (await verifyPassword(code, prevHash))) {
    code = generateExitUnlockCode();
  }
  const set = await setExitUnlockCode(db, code, {
    ...meta,
    detail: 'exit_unlock_code_system_generated',
  });
  if (!set.ok) return set;
  return { ok: true as const, rotated: set.rotated, generatedExitUnlockCode: code };
}

export function setExitUnlockRateConfig(
  db: DatabaseSync,
  patch: {
    exitUnlockMaxFails?: number;
    exitUnlockWindowMinutes?: number;
    exitUnlockLockoutMinutes?: number;
    exitUnlockCodeRotateDays?: number;
  },
  meta?: { actorUserId?: string; actorRole?: string; clientIp?: string },
) {
  if (patch.exitUnlockMaxFails != null) {
    const v = Math.min(30, Math.max(3, Math.trunc(Number(patch.exitUnlockMaxFails))));
    upsertSetting(db, KEY_MAX_FAILS, String(v));
  }
  if (patch.exitUnlockWindowMinutes != null) {
    const v = Math.min(1440, Math.max(1, Math.trunc(Number(patch.exitUnlockWindowMinutes))));
    upsertSetting(db, KEY_WINDOW_MIN, String(v));
  }
  if (patch.exitUnlockLockoutMinutes != null) {
    const v = Math.min(1440, Math.max(1, Math.trunc(Number(patch.exitUnlockLockoutMinutes))));
    upsertSetting(db, KEY_LOCKOUT_MIN, String(v));
  }
  if (patch.exitUnlockCodeRotateDays != null) {
    const v = Math.min(365, Math.max(7, Math.trunc(Number(patch.exitUnlockCodeRotateDays))));
    upsertSetting(db, KEY_ROTATE_DAYS, String(v));
  }
  recordExitLockEvent(db, {
    kind: 'rate_config',
    actorUserId: meta?.actorUserId,
    actorRole: meta?.actorRole,
    detail: JSON.stringify(getExitUnlockRateConfig(db)),
    clientIp: meta?.clientIp,
  });
}

function getBucket(key: string): AttemptBucket {
  let b = attemptBuckets.get(key);
  if (!b) {
    b = { fails: [], lockedUntil: 0 };
    attemptBuckets.set(key, b);
  }
  return b;
}

export function getExitUnlockRateLimit(
  db: DatabaseSync,
  clientKey: string,
): {
  limited: boolean;
  retryAfterSec: number;
  failsInWindow: number;
  remainingAttempts: number;
  maxFails: number;
} {
  const cfg = getExitUnlockRateConfig(db);
  const windowMs = cfg.exitUnlockWindowMinutes * 60_000;
  const now = Date.now();
  const b = getBucket(clientKey || 'unknown');
  if (b.lockedUntil > now) {
    return {
      limited: true,
      retryAfterSec: Math.ceil((b.lockedUntil - now) / 1000),
      failsInWindow: b.fails.length,
      remainingAttempts: 0,
      maxFails: cfg.exitUnlockMaxFails,
    };
  }
  b.fails = b.fails.filter((t) => now - t < windowMs);
  return {
    limited: false,
    retryAfterSec: 0,
    failsInWindow: b.fails.length,
    remainingAttempts: Math.max(0, cfg.exitUnlockMaxFails - b.fails.length),
    maxFails: cfg.exitUnlockMaxFails,
  };
}

function noteExitUnlockFailure(
  db: DatabaseSync,
  clientKey: string,
): { limited: boolean; retryAfterSec: number } {
  const cfg = getExitUnlockRateConfig(db);
  const windowMs = cfg.exitUnlockWindowMinutes * 60_000;
  const lockoutMs = cfg.exitUnlockLockoutMinutes * 60_000;
  const now = Date.now();
  const b = getBucket(clientKey || 'unknown');
  b.fails = b.fails.filter((t) => now - t < windowMs);
  b.fails.push(now);
  if (b.fails.length >= cfg.exitUnlockMaxFails) {
    b.lockedUntil = now + lockoutMs;
    b.fails = [];
    return { limited: true, retryAfterSec: Math.ceil(lockoutMs / 1000) };
  }
  return { limited: false, retryAfterSec: 0 };
}

function clearExitUnlockFailures(clientKey: string) {
  attemptBuckets.delete(clientKey || 'unknown');
}

export async function attemptExitUnlock(
  db: DatabaseSync,
  code: string,
  meta?: { clientIp?: string | null },
): Promise<
  | { ok: true }
  | {
      ok: false;
      error: string;
      message: string;
      status: number;
      retryAfterSec?: number;
      remainingAttempts?: number;
      maxFails?: number;
    }
> {
  const clientKey = String(meta?.clientIp ?? 'unknown');
  const cfg = getExitUnlockRateConfig(db);
  const rl = getExitUnlockRateLimit(db, clientKey);
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
      remainingAttempts: 0,
      maxFails: cfg.exitUnlockMaxFails,
    };
  }

  const trimmed = String(code ?? '').trim();
  if (!trimmed) {
    return {
      ok: false,
      error: 'password_required',
      message: '请输入解除码',
      status: 400,
      remainingAttempts: rl.remainingAttempts,
      maxFails: cfg.exitUnlockMaxFails,
    };
  }

  const codeHash = getSetting(db, KEY_CODE_HASH);
  let matched = false;
  if (codeHash && (await verifyPassword(trimmed, codeHash))) matched = true;
  else if (await verifyAdminPassword(db, trimmed)) matched = true;

  if (!matched) {
    const after = noteExitUnlockFailure(db, clientKey);
    const afterRl = getExitUnlockRateLimit(db, clientKey);
    recordExitLockEvent(db, {
      kind: after.limited ? 'code_rate_limited' : 'code_fail',
      detail: after.limited
        ? `lockoutSec=${after.retryAfterSec}`
        : `invalid_code;remaining=${afterRl.remainingAttempts}`,
      clientIp: meta?.clientIp,
    });
    if (after.limited) {
      return {
        ok: false,
        error: 'exit_unlock_rate_limited',
        message: `尝试过多，请 ${after.retryAfterSec} 秒后再试`,
        status: 429,
        retryAfterSec: after.retryAfterSec,
        remainingAttempts: 0,
        maxFails: cfg.exitUnlockMaxFails,
      };
    }
    return {
      ok: false,
      error: 'invalid_exit_unlock_code',
      message: `解除码错误（还可试 ${afterRl.remainingAttempts} 次）`,
      status: 401,
      remainingAttempts: afterRl.remainingAttempts,
      maxFails: cfg.exitUnlockMaxFails,
    };
  }

  clearExitUnlockFailures(clientKey);
  recordExitLockEvent(db, {
    kind: 'code_ok',
    detail: 'local_exit_unlocked',
    clientIp: meta?.clientIp,
  });
  return { ok: true };
}

/** Student reports local cache vs server after reconnect; always trusts server and audits conflicts. */
export function reconcileClientExitLockCache(
  db: DatabaseSync,
  local: { allowed: boolean; until?: string | null },
  meta?: { clientIp?: string | null; clientId?: string | null },
) {
  const server = getClientExitLockState(db);
  const conflict =
    Boolean(local.allowed) !== server.clientExitAllowed ||
    String(local.until ?? '') !== String(server.clientExitUnlockUntil ?? '');
  if (conflict) {
    recordExitLockEvent(db, {
      kind: 'client_reconcile',
      detail: JSON.stringify({
        localAllowed: Boolean(local.allowed),
        localUntil: local.until ?? null,
        serverAllowed: server.clientExitAllowed,
        serverUntil: server.clientExitUnlockUntil,
        clientId: meta?.clientId ?? null,
      }),
      clientIp: meta?.clientIp,
    });
  }
  return { conflict, ...server };
}

export async function verifyExitUnlockCode(db: DatabaseSync, code: string): Promise<boolean> {
  const r = await attemptExitUnlock(db, code, { clientIp: 'legacy' });
  return r.ok;
}