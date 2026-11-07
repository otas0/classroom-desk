import type { Response } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import {
  getInputLockStore,
  inputLockActive,
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
  summary: {
    global: string;
    byClass: Array<{ classId: string; label: string }>;
    bySeat: Array<{ key: string; classId: string; seatId: string; label: string }>;
  };
};

type Sub = { res: Response };

const sseClients = new Set<Sub>();
let lastPayload: InputLockPayload | null = null;

export function buildInputLockPayload(db: DatabaseSync): InputLockPayload {
  const store = getInputLockStore(db);
  const inputLock = resolveInputLock(store);
  const byClass = Object.entries(store.byClass).map(([classId, flags]) => ({
    classId,
    label: inputLockFlagsLabel(flags),
  }));
  const bySeat = Object.entries(store.bySeat).map(([key, flags]) => {
    const [classId = '', seatId = ''] = key.split(':');
    return {
      key,
      classId,
      seatId,
      label: inputLockFlagsLabel(flags),
    };
  });
  return {
    type: 'input_lock',
    at: new Date().toISOString(),
    inputLock,
    inputLockStore: store,
    inputLockActive: inputLockActive(inputLock) || byClass.length > 0 || bySeat.length > 0,
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