import { createHash } from 'node:crypto';
import os from 'node:os';
import type { Request } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { encodeRoomCode } from '@classroom-desk/shared';
import { getSetting } from '../db/migrate.js';
import { verifyPassword, hashPassword } from './auth.js';
import { writeAudit } from './audit.js';
import { recordExitLockEvent } from './exitLock.js';
import { newId, nowIso } from '../utils/id.js';
import { resolveAdvertiseLanIp } from './lanNetwork.js';

const KEY_PIN_HASH = 'student_join_pin_hash';
const KEY_REQUIRE_APPROVAL = 'student_join_require_approval';
const KEY_PULL_ENABLED = 'class_list_pull_enabled';
const KEY_PULL_CLASS_ID = 'class_list_pull_class_id';

const JOIN_FAIL_MAX = 10;
const JOIN_FAIL_WINDOW_MS = 5 * 60_000;
const JOIN_FAIL_LOCKOUT_MS = 5 * 60_000;

type FailBucket = { fails: number[]; lockedUntil: number };
const joinFailBuckets = new Map<string, FailBucket>();

export function clientIpFromReq(req: Pick<Request, 'headers' | 'socket'> & { ip?: string }): string {
  return String(req.headers['x-forwarded-for'] ?? req.ip ?? req.socket?.remoteAddress ?? '')
    .split(',')[0]
    .trim();
}

function failBucket(key: string): FailBucket {
  let b = joinFailBuckets.get(key);
  if (!b) {
    b = { fails: [], lockedUntil: 0 };
    joinFailBuckets.set(key, b);
  }
  return b;
}

export function getJoinFailRateLimit(clientIp: string): {
  limited: boolean;
  retryAfterSec: number;
  remainingAttempts: number;
} {
  const now = Date.now();
  const b = failBucket(clientIp || 'unknown');
  if (b.lockedUntil > now) {
    return {
      limited: true,
      retryAfterSec: Math.ceil((b.lockedUntil - now) / 1000),
      remainingAttempts: 0,
    };
  }
  b.fails = b.fails.filter((t) => now - t < JOIN_FAIL_WINDOW_MS);
  return {
    limited: false,
    retryAfterSec: 0,
    remainingAttempts: Math.max(0, JOIN_FAIL_MAX - b.fails.length),
  };
}

export function noteJoinFailure(
  db: DatabaseSync,
  clientIp: string,
  detail: Record<string, unknown>,
): { limited: boolean; retryAfterSec: number } {
  const now = Date.now();
  const b = failBucket(clientIp || 'unknown');
  b.fails = b.fails.filter((t) => now - t < JOIN_FAIL_WINDOW_MS);
  b.fails.push(now);
  writeAudit({
    actorUserId: null,
    actorRole: null,
    action: 'classroom.join_failure',
    detail: { ...detail, clientIp },
    clientIp,
  });
  recordExitLockEvent(db, {
    kind: 'classroom_join_fail',
    detail: JSON.stringify(detail),
    clientIp,
  });
  if (b.fails.length >= JOIN_FAIL_MAX) {
    b.lockedUntil = now + JOIN_FAIL_LOCKOUT_MS;
    b.fails = [];
    recordExitLockEvent(db, {
      kind: 'classroom_join_rate_limited',
      detail: `retryAfterSec=${Math.ceil(JOIN_FAIL_LOCKOUT_MS / 1000)}`,
      clientIp,
    });
    return { limited: true, retryAfterSec: Math.ceil(JOIN_FAIL_LOCKOUT_MS / 1000) };
  }
  return { limited: false, retryAfterSec: 0 };
}

function clearJoinFailures(clientIp: string) {
  joinFailBuckets.delete(clientIp || 'unknown');
}

export function joinPinRequired(db: DatabaseSync): boolean {
  return Boolean((getSetting(db, KEY_PIN_HASH) ?? '').trim());
}

export function joinRequireDeviceApproval(db: DatabaseSync): boolean {
  return (getSetting(db, KEY_REQUIRE_APPROVAL) ?? '0') === '1';
}

export function joinAttachGateActive(db: DatabaseSync): boolean {
  return joinPinRequired(db) || joinRequireDeviceApproval(db);
}

export async function setJoinPin(db: DatabaseSync, pin: string | null | undefined): Promise<void> {
  const trimmed = String(pin ?? '').trim();
  if (!trimmed) {
    db.prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(KEY_PIN_HASH, '');
    return;
  }
  if (trimmed.length < 4 || trimmed.length > 32) {
    throw new Error('join_pin_length');
  }
  const hash = await hashPassword(trimmed);
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(KEY_PIN_HASH, hash);
}

export function setJoinRequireApproval(db: DatabaseSync, on: boolean): void {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(KEY_REQUIRE_APPROVAL, on ? '1' : '0');
}

export function getPullJoinSettings(db: DatabaseSync) {
  return {
    classListPullEnabled: (getSetting(db, KEY_PULL_ENABLED) ?? '0') === '1',
    classListPullClassId: String(getSetting(db, KEY_PULL_CLASS_ID) ?? '').trim(),
  };
}

export function setPullJoin(db: DatabaseSync, enabled: boolean, classId: string): void {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(KEY_PULL_ENABLED, enabled ? '1' : '0');
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(KEY_PULL_CLASS_ID, enabled ? classId : '');
}

export type ClassroomJoinPayload = {
  ok: boolean;
  enabled: boolean;
  reason?: string;
  apiBase: string | null;
  classId: string | null;
  className: string | null;
  hostName: string;
  displayName: string | null;
  lanIp: string | null;
  roomCode: string | null;
  roomId: string | null;
  openedAt: string | null;
  ttlMinutes: number;
  label: string;
  joinPinRequired: boolean;
  requireDeviceApproval: boolean;
  attachRequired: boolean;
  attachOk?: boolean;
  /** Teacher has easy-join on (class may require attach before classId is revealed). */
  easyJoinOpen?: boolean;
};

export function buildClassroomJoinPayload(
  db: DatabaseSync,
  req: Pick<Request, 'headers' | 'protocol' | 'get'>,
  opts?: { includeClassSecrets?: boolean },
): ClassroomJoinPayload {
  const enabled = (getSetting(db, 'student_easy_join') ?? '0') === '1';
  const classId = String(getSetting(db, 'student_easy_join_class_id') ?? '').trim();
  let className = '';
  if (classId) {
    const row = db
      .prepare(`SELECT name FROM classes WHERE id = ?`)
      .get(classId) as { name?: string } | undefined;
    className = String(row?.name ?? '').trim();
  }
  const storedBase = String(getSetting(db, 'classroom_api_base') ?? '')
    .trim()
    .replace(/\/$/, '');
  const proto = String(req.headers['x-forwarded-proto'] ?? req.protocol ?? 'http').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] ?? req.get?.('host') ?? '')
    .split(',')[0]
    .trim();
  const requestBase =
    host && !/127\.0\.0\.1|localhost/i.test(host) ? `${proto}://${host}`.replace(/\/$/, '') : '';
  const apiBase = storedBase && !/127\.0\.0\.1|localhost/i.test(storedBase) ? storedBase : requestBase;
  const hostName = os.hostname();
  const displayName = String(getSetting(db, 'classroom_display_name') ?? '').trim();
  let lanIp = '';
  try {
    if (apiBase) lanIp = new URL(apiBase).hostname;
  } catch {
    lanIp = '';
  }
  if (!lanIp || /127\.0\.0\.1|localhost/i.test(lanIp)) {
    lanIp = resolveAdvertiseLanIp(db);
  }
  const label = [displayName || null, className || null, hostName, lanIp || null]
    .filter(Boolean)
    .join(' · ');
  const roomCode = lanIp ? encodeRoomCode(lanIp) : null;
  const roomId = String(getSetting(db, 'classroom_room_id') ?? '').trim();
  const openedAt = String(getSetting(db, 'student_easy_join_opened_at') ?? '').trim();
  const ttlMinutes = Number(getSetting(db, 'student_easy_join_ttl_minutes') ?? 0);
  const pinRequired = joinPinRequired(db);
  const requireApproval = joinRequireDeviceApproval(db);
  const attachRequired = pinRequired || requireApproval;
  const includeSecrets = opts?.includeClassSecrets ?? !attachRequired;

  if (!enabled || !classId || !apiBase) {
    return {
      ok: false,
      enabled: false,
      easyJoinOpen: false,
      reason: !enabled ? 'disabled' : !classId ? 'no_class' : 'no_api_base',
      apiBase: null,
      classId: null,
      className: null,
      hostName,
      displayName: displayName || null,
      lanIp: lanIp || null,
      roomCode,
      roomId: roomId || null,
      openedAt: openedAt || null,
      ttlMinutes: Number.isFinite(ttlMinutes) ? ttlMinutes : 0,
      label: label || hostName,
      joinPinRequired: pinRequired,
      requireDeviceApproval: requireApproval,
      attachRequired,
    };
  }

  return {
    ok: true,
    enabled: true,
    easyJoinOpen: true,
    apiBase,
    classId: includeSecrets ? classId : null,
    className: className || null,
    hostName,
    displayName: displayName || null,
    lanIp: lanIp || null,
    roomCode,
    roomId: roomId || null,
    openedAt: openedAt || null,
    ttlMinutes: Number.isFinite(ttlMinutes) ? ttlMinutes : 0,
    label: label || apiBase,
    joinPinRequired: pinRequired,
    requireDeviceApproval: requireApproval,
    attachRequired,
    attachOk: includeSecrets,
  };
}

function deviceApprovalStatus(
  db: DatabaseSync,
  deviceId: string,
): 'approved' | 'pending' | 'denied' | 'new' {
  const id = deviceId.trim().slice(0, 80);
  if (!id) return 'new';
  const row = db
    .prepare(`SELECT status FROM join_device_approvals WHERE device_id = ?`)
    .get(id) as { status?: string } | undefined;
  if (!row?.status) return 'new';
  const s = String(row.status);
  if (s === 'approved' || s === 'pending' || s === 'denied') return s;
  return 'new';
}

function ensurePendingDevice(
  db: DatabaseSync,
  input: { deviceId: string; hostname: string; clientIp: string | null },
): void {
  const deviceId = input.deviceId.trim().slice(0, 80);
  if (!deviceId) return;
  const existing = db
    .prepare(`SELECT id, status FROM join_device_approvals WHERE device_id = ?`)
    .get(deviceId) as { id: string; status: string } | undefined;
  if (existing) return;
  db.prepare(
    `INSERT INTO join_device_approvals (id, device_id, hostname, status, client_ip, created_at)
     VALUES (?, ?, ?, 'pending', ?, ?)`,
  ).run(
    newId(),
    deviceId,
    input.hostname.trim().slice(0, 128),
    input.clientIp,
    nowIso(),
  );
  writeAudit({
    actorUserId: null,
    actorRole: null,
    action: 'classroom.join_device_pending',
    detail: { deviceId, hostname: input.hostname },
    clientIp: input.clientIp,
  });
}

export async function attemptClassroomJoinAttach(
  db: DatabaseSync,
  req: Pick<Request, 'headers' | 'protocol' | 'get' | 'socket'> & { ip?: string },
  body: { pin?: string; deviceId?: string; hostname?: string },
): Promise<
  | { ok: true; payload: ClassroomJoinPayload }
  | {
      ok: false;
      status: number;
      error: string;
      message: string;
      retryAfterSec?: number;
      remainingAttempts?: number;
    }
> {
  const clientIp = clientIpFromReq(req);
  const rl = getJoinFailRateLimit(clientIp);
  if (rl.limited) {
    return {
      ok: false,
      status: 429,
      error: 'join_rate_limited',
      message: `尝试过多，请 ${rl.retryAfterSec} 秒后再试`,
      retryAfterSec: rl.retryAfterSec,
      remainingAttempts: 0,
    };
  }

  const base = buildClassroomJoinPayload(db, req, { includeClassSecrets: true });
  if (!base.ok || !base.enabled || !base.apiBase || !base.classId) {
    const fail = noteJoinFailure(db, clientIp, { reason: base.reason ?? 'not_available' });
    if (fail.limited) {
      return {
        ok: false,
        status: 429,
        error: 'join_rate_limited',
        message: `尝试过多，请 ${fail.retryAfterSec} 秒后再试`,
        retryAfterSec: fail.retryAfterSec,
        remainingAttempts: 0,
      };
    }
    return {
      ok: false,
      status: 403,
      error: 'join_not_available',
      message: '教师未开放一键连班',
      remainingAttempts: getJoinFailRateLimit(clientIp).remainingAttempts,
    };
  }

  if (joinPinRequired(db)) {
    const pin = String(body.pin ?? '').trim();
    const hash = getSetting(db, KEY_PIN_HASH) ?? '';
    const pinOk = pin && hash ? await verifyPassword(pin, hash) : false;
    if (!pinOk) {
      const fail = noteJoinFailure(db, clientIp, { reason: 'bad_pin', deviceId: body.deviceId ?? null });
      if (fail.limited) {
        return {
          ok: false,
          status: 429,
          error: 'join_rate_limited',
          message: `尝试过多，请 ${fail.retryAfterSec} 秒后再试`,
          retryAfterSec: fail.retryAfterSec,
          remainingAttempts: 0,
        };
      }
      return {
        ok: false,
        status: 401,
        error: 'join_pin_invalid',
        message: '连班 PIN 不正确',
        remainingAttempts: getJoinFailRateLimit(clientIp).remainingAttempts,
      };
    }
  }

  const deviceId = String(body.deviceId ?? '').trim().slice(0, 80);
  const hostname = String(body.hostname ?? os.hostname()).trim().slice(0, 128);

  if (joinRequireDeviceApproval(db)) {
    if (!deviceId) {
      noteJoinFailure(db, clientIp, { reason: 'device_id_required' });
      return {
        ok: false,
        status: 400,
        error: 'device_id_required',
        message: '缺少本机 deviceId，无法申请连班',
        remainingAttempts: getJoinFailRateLimit(clientIp).remainingAttempts,
      };
    }
    const status = deviceApprovalStatus(db, deviceId);
    if (status === 'denied') {
      noteJoinFailure(db, clientIp, { reason: 'device_denied', deviceId });
      return {
        ok: false,
        status: 403,
        error: 'device_denied',
        message: '教师已拒绝此设备连班',
        remainingAttempts: getJoinFailRateLimit(clientIp).remainingAttempts,
      };
    }
    if (status === 'new' || status === 'pending') {
      ensurePendingDevice(db, { deviceId, hostname, clientIp });
      return {
        ok: false,
        status: 403,
        error: 'device_pending_approval',
        message: '已提交连班申请，请等待教师在「连班鉴权」中批准',
      };
    }
  }

  clearJoinFailures(clientIp);
  writeAudit({
    actorUserId: null,
    actorRole: null,
    action: 'classroom.join_attach_ok',
    classId: base.classId,
    detail: { deviceId: deviceId || null, hostname },
    clientIp,
  });
  return {
    ok: true,
    payload: { ...base, attachOk: true, attachRequired: joinAttachGateActive(db) },
  };
}

export function listPendingJoinDevices(db: DatabaseSync) {
  return db
    .prepare(
      `SELECT id, device_id AS deviceId, hostname, status, client_ip AS clientIp, created_at AS createdAt
       FROM join_device_approvals
       WHERE status = 'pending'
       ORDER BY created_at ASC LIMIT 200`,
    )
    .all();
}

/** In-memory join fail buckets currently in lockout (lockedUntil > now). */
export function listLiveJoinRateLimitedIps(now = Date.now()): string[] {
  const ips: string[] = [];
  for (const [ip, bucket] of joinFailBuckets) {
    if (bucket.lockedUntil > now) ips.push(ip);
  }
  return ips.sort();
}

export function countLiveJoinRateLimitedIps(now = Date.now()): number {
  return listLiveJoinRateLimitedIps(now).length;
}

/** Recent classroom_join_rate_limited rows for teacher ops / checklist. */
export function countRecentJoinRateLimits(db: DatabaseSync, windowMs = 60 * 60_000): number {
  const since = new Date(Date.now() - windowMs).toISOString();
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c FROM exit_lock_events
       WHERE kind = 'classroom_join_rate_limited' AND created_at >= ?`,
    )
    .get(since) as { c?: number } | undefined;
  return Number(row?.c ?? 0);
}

export function decideJoinDevice(
  db: DatabaseSync,
  id: string,
  decision: 'approved' | 'denied',
  meta: { actorUserId?: string; actorRole?: string; clientIp?: string },
): boolean {
  const row = db
    .prepare(`SELECT id, device_id AS deviceId, status FROM join_device_approvals WHERE id = ?`)
    .get(id) as { id: string; deviceId: string; status: string } | undefined;
  if (!row || row.status !== 'pending') return false;
  db.prepare(
    `UPDATE join_device_approvals SET status = ?, decided_at = ?, decided_by = ? WHERE id = ?`,
  ).run(decision, nowIso(), meta.actorUserId ?? null, id);
  writeAudit({
    actorUserId: meta.actorUserId,
    actorRole: meta.actorRole,
    action: decision === 'approved' ? 'classroom.join_device_approved' : 'classroom.join_device_denied',
    detail: { deviceId: row.deviceId, approvalId: id },
    clientIp: meta.clientIp,
  });
  return true;
}

export function resolvePullJoinForStudent(
  db: DatabaseSync,
  studentUserId: string,
): { ok: boolean; apiBase?: string; classId?: string; className?: string; reason?: string } {
  const pull = getPullJoinSettings(db);
  if (!pull.classListPullEnabled || !pull.classListPullClassId) {
    return { ok: false, reason: 'disabled' };
  }
  const user = db
    .prepare(
      `SELECT id, class_id AS classId FROM users
       WHERE id = ? AND role = 'student' AND (deleted_at IS NULL OR deleted_at = '')`,
    )
    .get(studentUserId) as { id: string; classId: string | null } | undefined;
  if (!user?.classId || user.classId !== pull.classListPullClassId) {
    return { ok: false, reason: 'not_on_roster' };
  }
  const klass = db
    .prepare(`SELECT id, name FROM classes WHERE id = ?`)
    .get(pull.classListPullClassId) as { id: string; name: string } | undefined;
  if (!klass) return { ok: false, reason: 'class_not_found' };
  const storedBase = String(getSetting(db, 'classroom_api_base') ?? '')
    .trim()
    .replace(/\/$/, '');
  if (!storedBase || /127\.0\.0\.1|localhost/i.test(storedBase)) {
    return { ok: false, reason: 'no_api_base' };
  }
  return {
    ok: true,
    apiBase: storedBase,
    classId: klass.id,
    className: klass.name,
  };
}

/** Constant-time-ish pin fingerprint for audit (not reversible). */
export function joinPinAuditFingerprint(pin: string): string {
  return createHash('sha256').update(String(pin)).digest('hex').slice(0, 12);
}
