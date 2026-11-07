import type { Response } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import {
  getInputLockStore,
  inputLockActive,
  inputLockClearedReasonNow,
  inputLockFlagsLabel,
  resolveInputLock,
  type InputLockFlags,
  type InputLockStore,
} from './inputLock.js';

export type InputLockPayload = {
  type: 'input_lock';
  at: string;
  inputLock: InputLockFlags;
  inputLockStore: InputLockStore;
  inputLockActive: boolean;
  inputLockExpiresAt: string | null;
  inputLockAttendanceSessionId: string | null;
  /** Present briefly after TTL auto-clear so students can toast. */
  inputLockClearedReason: 'ttl_expire' | null;
  summary: {
    global: string;
    byClass: Array<{ classId: string; className: string; label: string }>;
    bySeat: Array<{
      key: string;
      classId: string;
      className: string;
      seatId: string;
      seatLabel: string;
      label: string;
    }>;
  };
};

type Sub = { res: Response };

const sseClients = new Set<Sub>();
let lastPayload: InputLockPayload | null = null;

function classDisplayName(db: DatabaseSync, classId: string): string {
  if (!classId) return '';
  const row = db.prepare(`SELECT name FROM classes WHERE id = ?`).get(classId) as
    | { name?: string }
    | undefined;
  return String(row?.name ?? '').trim();
}

export function buildInputLockPayload(db: DatabaseSync): InputLockPayload {
  const store = getInputLockStore(db);
  const inputLock = resolveInputLock(store);
  const byClass = Object.entries(store.byClass).map(([classId, flags]) => {
    const className = classDisplayName(db, classId);
    return {
      classId,
      className,
      label: inputLockFlagsLabel(flags),
    };
  });
  const bySeat = Object.entries(store.bySeat).map(([key, flags]) => {
    const colon = key.indexOf(':');
    const classId = colon >= 0 ? key.slice(0, colon) : '';
    const seatId = colon >= 0 ? key.slice(colon + 1) : key;
    let seatLabel = '';
    if (classId && seatId) {
      const row = db
        .prepare(`SELECT label FROM seat_map WHERE class_id = ? AND id = ?`)
        .get(classId, seatId) as { label?: string } | undefined;
      seatLabel = String(row?.label ?? '').trim();
    }
    const className = classDisplayName(db, classId);
    return {
      key,
      classId,
      className,
      seatId,
      seatLabel,
      /** Locked input kinds (键盘/…); seat display name is seatLabel. */
      label: inputLockFlagsLabel(flags),
    };
  });
  return {
    type: 'input_lock',
    at: new Date().toISOString(),
    inputLock,
    inputLockStore: store,
    inputLockActive: inputLockActive(inputLock) || byClass.length > 0 || bySeat.length > 0,
    inputLockExpiresAt: store.expiresAt ?? null,
    inputLockAttendanceSessionId: store.attendanceSessionId ?? null,
    inputLockClearedReason: inputLockClearedReasonNow(),
    summary: {
      global: inputLockFlagsLabel(store.global),
      byClass,
      bySeat,
    },
  };
}

export function broadcastInputLock(db: DatabaseSync) {
  const payload = buildInputLockPayload(db);
  lastPayload = payload;
  const line = `event: input_lock\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const sub of sseClients) {
    try {
      sub.res.write(line);
    } catch {
      sseClients.delete(sub);
    }
  }
}

/** Dedicated SSE — keeps exit-lock channel free of the full inputLockStore blob. */
export function addInputLockSseClient(res: Response, db: DatabaseSync) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  const sub: Sub = { res };
  sseClients.add(sub);
  const snap = lastPayload ?? buildInputLockPayload(db);
  lastPayload = snap;
  res.write(`event: input_lock\ndata: ${JSON.stringify(snap)}\n\n`);
  const heartbeat = setInterval(() => {
    try {
      res.write(`: ping\n\n`);
    } catch {
      clearInterval(heartbeat);
      sseClients.delete(sub);
    }
  }, 25000);
  res.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(sub);
  });
}
