import type { DatabaseSync } from 'node:sqlite';
import { getSetting } from '../db/migrate.js';
import { recordExitLockEvent, upsertSetting } from './exitLock.js';
import { writeAudit } from './audit.js';

const KEY_V1 = 'client_input_lock_json';
const KEY_V2 = 'client_input_lock_v2_json';
const KEY_EXAM_SNAP = 'client_input_lock_exam_snapshot_json';

export type InputLockFlags = {
  keyboard: boolean;
  mouse: boolean;
  voice: boolean;
  camera: boolean;
};

export type InputLockStore = {
  global: InputLockFlags;
  /** classId → flags (full replace for that class). */
  byClass: Record<string, InputLockFlags>;
  /** `${classId}:${seatOrClientId}` → flags. */
  bySeat: Record<string, InputLockFlags>;
  /**
   * ISO expiry — when set and past, resolve treats locks as empty (课次/出勤 session TTL).
   * Cleared on clearAll or explicit unbind.
   */
  expiresAt?: string | null;
  /** Attendance session that owns expiresAt (optional audit/link). */
  attendanceSessionId?: string | null;
};

export const DEFAULT_INPUT_LOCK: InputLockFlags = {
  keyboard: false,
  mouse: false,
  voice: false,
  camera: false,
};

export function emptyInputLockStore(): InputLockStore {
  return { global: { ...DEFAULT_INPUT_LOCK }, byClass: {}, bySeat: {} };
}

function parseFlags(raw: unknown): InputLockFlags {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_INPUT_LOCK };
  const o = raw as Partial<InputLockFlags>;
  return {
    keyboard: Boolean(o.keyboard),
    mouse: Boolean(o.mouse),
    voice: Boolean(o.voice),
    camera: Boolean(o.camera),
  };
}

export function inputLockActive(flags: InputLockFlags): boolean {
  return flags.keyboard || flags.mouse || flags.voice || flags.camera;
}

export function inputLockFlagsLabel(flags: InputLockFlags): string {
  const parts: string[] = [];
  if (flags.keyboard) parts.push('键盘');
  if (flags.mouse) parts.push('鼠标');
  if (flags.voice) parts.push('语音');
  if (flags.camera) parts.push('相机');
  return parts.length ? parts.join('、') : '无';
}

function seatKey(classId: string, seatId: string): string {
  return `${classId}:${seatId}`;
}

export function inputLockExpired(store: InputLockStore, now = Date.now()): boolean {
  const exp = String(store.expiresAt ?? '').trim();
  if (!exp) return false;
  const t = Date.parse(exp);
  return Number.isFinite(t) && t <= now;
}

/** Persist store without audit (TTL purge / meta-only). */
function writeInputLockStore(db: DatabaseSync, store: InputLockStore): void {
  upsertSetting(db, KEY_V2, JSON.stringify(store));
  upsertSetting(db, KEY_V1, JSON.stringify(store.global));
}

/** Students show toast while Date.now() < this (set on TTL purge). */
let ttlClearedNoticeUntil = 0;

export function inputLockClearedReasonNow(): 'ttl_expire' | null {
  return Date.now() < ttlClearedNoticeUntil ? 'ttl_expire' : null;
}

/**
 * If expiresAt is past, wipe locks and clear TTL fields. Returns (possibly purged) store.
 * Broadcast is the caller's responsibility.
 */
export function purgeExpiredInputLocks(
  db: DatabaseSync,
  meta?: { actorUserId?: string; actorRole?: string; clientIp?: string },
  /** Injected clock for tests (TTL expire without waiting). */
  nowMs: number = Date.now(),
): { store: InputLockStore; purged: boolean } {
  const store = getInputLockStoreRaw(db);
  if (!inputLockExpired(store, nowMs)) return { store, purged: false };
  const empty = emptyInputLockStore();
  writeInputLockStore(db, empty);
  ttlClearedNoticeUntil = Date.now() + 120_000;
  recordExitLockEvent(db, {
    kind: 'input_lock',
    actorUserId: meta?.actorUserId,
    actorRole: meta?.actorRole ?? 'system',
    detail: `物理输入锁：课次到期自动解除（session=${store.attendanceSessionId ?? '—'} · 原到期 ${store.expiresAt}）`,
    clientIp: meta?.clientIp,
  });
  writeAudit(
    {
      action: 'settings.input_lock',
      actorUserId: meta?.actorUserId,
      actorRole: meta?.actorRole ?? 'system',
      classId: null,
      detail: JSON.stringify({
        scope: 'ttl_expire',
        attendanceSessionId: store.attendanceSessionId ?? null,
        expiresAt: store.expiresAt ?? null,
        summary: '课次到期自动解除物理输入锁',
      }),
      clientIp: meta?.clientIp,
    },
    db,
  );
  return { store: empty, purged: true };
}

function getInputLockStoreRaw(db: DatabaseSync): InputLockStore {
  const v2 = getSetting(db, KEY_V2);
  if (v2) {
    try {
      const o = JSON.parse(v2) as Partial<InputLockStore>;
      const byClass: Record<string, InputLockFlags> = {};
      for (const [k, v] of Object.entries(o.byClass ?? {})) byClass[k] = parseFlags(v);
      const bySeat: Record<string, InputLockFlags> = {};
      for (const [k, v] of Object.entries(o.bySeat ?? {})) bySeat[k] = parseFlags(v);
      return {
        global: parseFlags(o.global),
        byClass,
        bySeat,
        expiresAt: o.expiresAt != null && String(o.expiresAt).trim() ? String(o.expiresAt) : null,
        attendanceSessionId:
          o.attendanceSessionId != null && String(o.attendanceSessionId).trim()
            ? String(o.attendanceSessionId)
            : null,
      };
    } catch {
      /* fall through */
    }
  }
  // migrate v1 flat → global
  const v1 = getSetting(db, KEY_V1);
  const store = emptyInputLockStore();
  if (v1) store.global = parseFlags(JSON.parse(v1));
  return store;
}

export function getInputLockStore(db: DatabaseSync): InputLockStore {
  return purgeExpiredInputLocks(db).store;
}

/** Seat override > class override > global. Expired store resolves as unlocked. */
export function resolveInputLock(
  store: InputLockStore,
  opts?: { classId?: string | null; seatId?: string | null },
): InputLockFlags {
  if (inputLockExpired(store)) return { ...DEFAULT_INPUT_LOCK };
  const classId = String(opts?.classId ?? '').trim();
  const seatId = String(opts?.seatId ?? '').trim();
  if (classId && seatId) {
    const sk = seatKey(classId, seatId);
    if (store.bySeat[sk]) return { ...store.bySeat[sk]! };
  }
  if (classId && store.byClass[classId]) return { ...store.byClass[classId]! };
  return { ...store.global };
}

/** Bind / clear TTL (attendance session end_at). Does not change flag maps. */
export function setInputLockTtl(
  db: DatabaseSync,
  patch: {
    expiresAt?: string | null;
    attendanceSessionId?: string | null;
    clearTtl?: boolean;
  },
  meta?: { actorUserId?: string; actorRole?: string; clientIp?: string },
): InputLockStore {
  const store = getInputLockStoreRaw(db);
  if (patch.clearTtl) {
    store.expiresAt = null;
    store.attendanceSessionId = null;
  } else {
    if (patch.expiresAt !== undefined) {
      store.expiresAt = patch.expiresAt ? String(patch.expiresAt) : null;
    }
    if (patch.attendanceSessionId !== undefined) {
      store.attendanceSessionId = patch.attendanceSessionId
        ? String(patch.attendanceSessionId)
        : null;
    }
  }
  writeInputLockStore(db, store);
  recordExitLockEvent(db, {
    kind: 'input_lock',
    actorUserId: meta?.actorUserId,
    actorRole: meta?.actorRole,
    detail: store.expiresAt
      ? `物理输入锁：绑定课次到期 ${store.expiresAt}${store.attendanceSessionId ? `（session ${store.attendanceSessionId}）` : ''}`
      : '物理输入锁：已清除课次到期',
    clientIp: meta?.clientIp,
  });
  return store;
}

/** Apply same flags to many seat_map ids in one class (one audit). */
export function setInputLockSeatsBulk(
  db: DatabaseSync,
  opts: {
    classId: string;
    seatIds: string[];
    flags: Partial<InputLockFlags>;
  },
  meta?: { actorUserId?: string; actorRole?: string; clientIp?: string },
): { store: InputLockStore; count: number } {
  const classId = String(opts.classId ?? '').trim();
  const seatIds = [...new Set(opts.seatIds.map((s) => String(s).trim()).filter(Boolean))];
  if (!classId || !seatIds.length) {
    return { store: getInputLockStore(db), count: 0 };
  }
  const store = getInputLockStore(db);
  for (const seatId of seatIds) {
    const sk = seatKey(classId, seatId);
    const prev = store.bySeat[sk] ?? { ...DEFAULT_INPUT_LOCK };
    store.bySeat[sk] = {
      keyboard: opts.flags.keyboard != null ? Boolean(opts.flags.keyboard) : prev.keyboard,
      mouse: opts.flags.mouse != null ? Boolean(opts.flags.mouse) : prev.mouse,
      voice: opts.flags.voice != null ? Boolean(opts.flags.voice) : prev.voice,
      camera: opts.flags.camera != null ? Boolean(opts.flags.camera) : prev.camera,
    };
  }
  writeInputLockStore(db, store);
  const cls = db.prepare(`SELECT name FROM classes WHERE id = ?`).get(classId) as
    | { name?: string }
    | undefined;
  const className = String(cls?.name ?? '').trim() || null;
  const sample = seatIds.slice(0, 8).join(',');
  const detailZh = `物理输入锁（批量机位 ${seatIds.length} · 班级 ${className || classId}）：${inputLockFlagsLabel(parseFlags(opts.flags))} · 例 ${sample}`;
  recordExitLockEvent(db, {
    kind: 'input_lock',
    actorUserId: meta?.actorUserId,
    actorRole: meta?.actorRole,
    detail: detailZh,
    clientIp: meta?.clientIp,
  });
  writeAudit(
    {
      action: 'settings.input_lock',
      actorUserId: meta?.actorUserId,
      actorRole: meta?.actorRole,
      classId,
      detail: JSON.stringify({
        scope: 'seat_bulk',
        classId,
        className,
        seatIds,
        count: seatIds.length,
        flags: parseFlags(opts.flags),
        summary: detailZh,
      }),
      clientIp: meta?.clientIp,
    },
    db,
  );
  return { store, count: seatIds.length };
}

/** Remove bySeat entries for many seat ids in one class (one audit). */
export function clearInputLockSeatsBulk(
  db: DatabaseSync,
  opts: { classId: string; seatIds: string[] },
  meta?: { actorUserId?: string; actorRole?: string; clientIp?: string },
): { store: InputLockStore; count: number } {
  const classId = String(opts.classId ?? '').trim();
  const seatIds = [...new Set(opts.seatIds.map((s) => String(s).trim()).filter(Boolean))];
  if (!classId || !seatIds.length) {
    return { store: getInputLockStore(db), count: 0 };
  }
  const store = getInputLockStore(db);
  let count = 0;
  for (const seatId of seatIds) {
    const sk = seatKey(classId, seatId);
    if (store.bySeat[sk]) {
      delete store.bySeat[sk];
      count += 1;
    }
  }
  writeInputLockStore(db, store);
  const cls = db.prepare(`SELECT name FROM classes WHERE id = ?`).get(classId) as
    | { name?: string }
    | undefined;
  const className = String(cls?.name ?? '').trim() || null;
  const detailZh = `物理输入锁：批量解除机位锁 ${count}/${seatIds.length} · 班级 ${className || classId}`;
  recordExitLockEvent(db, {
    kind: 'input_lock',
    actorUserId: meta?.actorUserId,
    actorRole: meta?.actorRole,
    detail: detailZh,
    clientIp: meta?.clientIp,
  });
  writeAudit(
    {
      action: 'settings.input_lock',
      actorUserId: meta?.actorUserId,
      actorRole: meta?.actorRole,
      classId,
      detail: JSON.stringify({
        scope: 'seat_bulk_clear',
        classId,
        className,
        seatIds,
        cleared: count,
        summary: detailZh,
      }),
      clientIp: meta?.clientIp,
    },
    db,
  );
  return { store, count };
}

/** @deprecated prefer getInputLockStore + resolve */
export function getInputLockFlags(db: DatabaseSync): InputLockFlags {
  return resolveInputLock(getInputLockStore(db));
}

export function setInputLockStore(
  db: DatabaseSync,
  patch: {
    global?: Partial<InputLockFlags>;
    classId?: string | null;
    seatId?: string | null;
    flags?: Partial<InputLockFlags>;
    /** Replace entire class map entry / clear with null */
    clearClass?: boolean;
    clearSeat?: boolean;
  },
  meta?: { actorUserId?: string; actorRole?: string; clientIp?: string },
): { store: InputLockStore; resolved: InputLockFlags } {
  const store = getInputLockStore(db);
  const classId = String(patch.classId ?? '').trim();
  const seatId = String(patch.seatId ?? '').trim();

  if (patch.global) {
    store.global = {
      keyboard: patch.global.keyboard != null ? Boolean(patch.global.keyboard) : store.global.keyboard,
      mouse: patch.global.mouse != null ? Boolean(patch.global.mouse) : store.global.mouse,
      voice: patch.global.voice != null ? Boolean(patch.global.voice) : store.global.voice,
      camera: patch.global.camera != null ? Boolean(patch.global.camera) : store.global.camera,
    };
  }

  if (classId && seatId && patch.flags) {
    const sk = seatKey(classId, seatId);
    if (patch.clearSeat) {
      delete store.bySeat[sk];
    } else {
      const prev = store.bySeat[sk] ?? { ...DEFAULT_INPUT_LOCK };
      store.bySeat[sk] = {
        keyboard: patch.flags.keyboard != null ? Boolean(patch.flags.keyboard) : prev.keyboard,
        mouse: patch.flags.mouse != null ? Boolean(patch.flags.mouse) : prev.mouse,
        voice: patch.flags.voice != null ? Boolean(patch.flags.voice) : prev.voice,
        camera: patch.flags.camera != null ? Boolean(patch.flags.camera) : prev.camera,
      };
    }
  } else if (classId && patch.flags) {
    if (patch.clearClass) {
      delete store.byClass[classId];
    } else {
      const prev = store.byClass[classId] ?? { ...DEFAULT_INPUT_LOCK };
      store.byClass[classId] = {
        keyboard: patch.flags.keyboard != null ? Boolean(patch.flags.keyboard) : prev.keyboard,
        mouse: patch.flags.mouse != null ? Boolean(patch.flags.mouse) : prev.mouse,
        voice: patch.flags.voice != null ? Boolean(patch.flags.voice) : prev.voice,
        camera: patch.flags.camera != null ? Boolean(patch.flags.camera) : prev.camera,
      };
    }
  } else if (patch.flags && !classId) {
    store.global = {
      keyboard: patch.flags.keyboard != null ? Boolean(patch.flags.keyboard) : store.global.keyboard,
      mouse: patch.flags.mouse != null ? Boolean(patch.flags.mouse) : store.global.mouse,
      voice: patch.flags.voice != null ? Boolean(patch.flags.voice) : store.global.voice,
      camera: patch.flags.camera != null ? Boolean(patch.flags.camera) : store.global.camera,
    };
  }

  upsertSetting(db, KEY_V2, JSON.stringify(store));
  // keep v1 mirror of global for older clients
  upsertSetting(db, KEY_V1, JSON.stringify(store.global));

  const resolved = resolveInputLock(store, { classId, seatId });
  let seatLabel: string | null = null;
  let className: string | null = null;
  if (classId) {
    const cls = db.prepare(`SELECT name FROM classes WHERE id = ?`).get(classId) as
      | { name?: string }
      | undefined;
    className = String(cls?.name ?? '').trim() || null;
  }
  if (classId && seatId) {
    const row = db
      .prepare(`SELECT label FROM seat_map WHERE class_id = ? AND id = ?`)
      .get(classId, seatId) as { label?: string } | undefined;
    seatLabel = row?.label?.trim() || null;
  }
  const scope = seatId
    ? seatLabel
      ? `机位 ${seatLabel}（id=${seatId}）`
      : `机位 id=${seatId}`
    : classId
      ? `班级 ${className || classId}`
      : '全校全局';
  const detailZh = `物理输入锁（${scope}）：${inputLockFlagsLabel(resolved)}`;
  const detailObj = {
    scope: seatId ? 'seat' : classId ? 'class' : 'global',
    classId: classId || null,
    className,
    seatId: seatId || null,
    seatLabel,
    flags: resolved,
    summary: detailZh,
  };

  recordExitLockEvent(db, {
    kind: 'input_lock',
    actorUserId: meta?.actorUserId,
    actorRole: meta?.actorRole,
    detail: detailZh,
    clientIp: meta?.clientIp,
  });
  writeAudit(
    {
      action: 'settings.input_lock',
      actorUserId: meta?.actorUserId,
      actorRole: meta?.actorRole,
      classId: classId || null,
      detail: JSON.stringify(detailObj),
      clientIp: meta?.clientIp,
    },
    db,
  );

  return { store, resolved };
}

/** Backward-compatible flat patch (global). */
export function setInputLockFlags(
  db: DatabaseSync,
  patch: Partial<InputLockFlags>,
  meta?: { actorUserId?: string; actorRole?: string; clientIp?: string },
): InputLockFlags {
  return setInputLockStore(db, { flags: patch }, meta).resolved;
}

export function applyExamModeInputLock(
  db: DatabaseSync,
  opts: { classId?: string | null },
  meta?: { actorUserId?: string; actorRole?: string; clientIp?: string },
): InputLockFlags {
  // Snapshot current store so「解除考试模式」can restore pre-exam locks.
  const before = getInputLockStore(db);
  upsertSetting(db, KEY_EXAM_SNAP, JSON.stringify(before));

  const flags: InputLockFlags = {
    keyboard: true,
    mouse: true,
    voice: true,
    camera: true,
  };
  const classId = String(opts.classId ?? '').trim();
  const r = setInputLockStore(
    db,
    classId ? { classId, flags } : { flags },
    meta,
  );
  recordExitLockEvent(db, {
    kind: 'exam_mode',
    actorUserId: meta?.actorUserId,
    actorRole: meta?.actorRole,
    detail: `考试模式：键鼠语音相机全锁${classId ? ` · 班级 ${classId}` : ' · 全局'} + 退出锁定`,
    clientIp: meta?.clientIp,
  });
  writeAudit(
    {
      action: 'settings.exam_mode',
      actorUserId: meta?.actorUserId,
      actorRole: meta?.actorRole,
      classId: classId || null,
      detail: '一键考试模式：物理输入全锁并重新锁定退出',
      clientIp: meta?.clientIp,
    },
    db,
  );
  return r.resolved;
}

/** Restore input-lock store captured before the last exam-mode apply. */
export function restoreExamModeInputLock(
  db: DatabaseSync,
  meta?: { actorUserId?: string; actorRole?: string; clientIp?: string },
): { store: InputLockStore; restored: boolean } {
  const raw = getSetting(db, KEY_EXAM_SNAP);
  if (!raw) {
    const cleared = setInputLockStore(
      db,
      {
        flags: {
          keyboard: false,
          mouse: false,
          voice: false,
          camera: false,
        },
      },
      meta,
    );
    recordExitLockEvent(db, {
      kind: 'exam_mode_end',
      actorUserId: meta?.actorUserId,
      actorRole: meta?.actorRole,
      detail: '解除考试模式：无快照，已全部解除物理输入锁',
      clientIp: meta?.clientIp,
    });
    writeAudit(
      {
        action: 'settings.exam_mode_end',
        actorUserId: meta?.actorUserId,
        actorRole: meta?.actorRole,
        classId: null,
        detail: '解除考试模式（无快照→全开）',
        clientIp: meta?.clientIp,
      },
      db,
    );
    return { store: cleared.store, restored: false };
  }

  let snap: InputLockStore;
  try {
    const o = JSON.parse(raw) as Partial<InputLockStore>;
    snap = {
      global: parseFlags(o.global),
      byClass: {},
      bySeat: {},
      expiresAt: o.expiresAt != null && String(o.expiresAt).trim() ? String(o.expiresAt) : null,
      attendanceSessionId:
        o.attendanceSessionId != null && String(o.attendanceSessionId).trim()
          ? String(o.attendanceSessionId)
          : null,
    };
    for (const [k, v] of Object.entries(o.byClass ?? {})) snap.byClass[k] = parseFlags(v);
    for (const [k, v] of Object.entries(o.bySeat ?? {})) snap.bySeat[k] = parseFlags(v);
  } catch {
    snap = emptyInputLockStore();
  }

  upsertSetting(db, KEY_V2, JSON.stringify(snap));
  upsertSetting(db, KEY_V1, JSON.stringify(snap.global));
  upsertSetting(db, KEY_EXAM_SNAP, '');

  recordExitLockEvent(db, {
    kind: 'exam_mode_end',
    actorUserId: meta?.actorUserId,
    actorRole: meta?.actorRole,
    detail: `解除考试模式：已恢复进考前输入锁快照（全局 ${inputLockFlagsLabel(snap.global)}）`,
    clientIp: meta?.clientIp,
  });
  writeAudit(
    {
      action: 'settings.exam_mode_end',
      actorUserId: meta?.actorUserId,
      actorRole: meta?.actorRole,
      classId: null,
      detail: '解除考试模式：恢复进考前输入锁快照',
      clientIp: meta?.clientIp,
    },
    db,
  );

  return { store: snap, restored: true };
}

export function hasExamModeSnapshot(db: DatabaseSync): boolean {
  const raw = getSetting(db, KEY_EXAM_SNAP);
  return Boolean(raw && raw.trim());
}

/**
 * Wipe global + byClass + bySeat (e2e / emergency unlock).
 * Also clears exam-mode input-lock snapshot — after clearAll there is nothing
 * meaningful to「解除考试模式」restore; leaving a stale snap would re-apply old locks.
 */
export function clearAllInputLocks(
  db: DatabaseSync,
  meta?: { actorUserId?: string; actorRole?: string; clientIp?: string },
): InputLockStore {
  const hadExamSnap = hasExamModeSnapshot(db);
  const store = emptyInputLockStore();
  store.expiresAt = null;
  store.attendanceSessionId = null;
  upsertSetting(db, KEY_V2, JSON.stringify(store));
  upsertSetting(db, KEY_V1, JSON.stringify(store.global));
  if (hadExamSnap) {
    upsertSetting(db, KEY_EXAM_SNAP, '');
  }
  recordExitLockEvent(db, {
    kind: 'input_lock',
    actorUserId: meta?.actorUserId,
    actorRole: meta?.actorRole,
    detail: hadExamSnap
      ? '物理输入锁：已清空全部范围（全局/班级/机位），并清除考试模式快照'
      : '物理输入锁：已清空全部范围（全局/班级/机位）',
    clientIp: meta?.clientIp,
  });
  writeAudit(
    {
      action: 'settings.input_lock',
      actorUserId: meta?.actorUserId,
      actorRole: meta?.actorRole,
      classId: null,
      detail: JSON.stringify({
        scope: 'clear_all',
        summary: hadExamSnap
          ? '清空全部物理输入锁（含考试模式快照）'
          : '清空全部物理输入锁',
        clearedExamSnapshot: hadExamSnap,
      }),
      clientIp: meta?.clientIp,
    },
    db,
  );
  return store;
}
