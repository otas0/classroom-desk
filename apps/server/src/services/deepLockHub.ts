import type { Response } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { deepLockAggressive, type DeepLockState, type DeepLockStore } from '@classroom-desk/shared';
import {
  deepLockStatusLabel,
  getDeepLockStore,
  listFocusViolations,
  type FocusViolation,
} from './deepLock.js';
import { getShieldConnector } from './shield/registry.js';

export type DeepLockPayload = {
  type: 'deep_lock';
  at: string;
  store: DeepLockStore;
  /** Convenience: global resolved view (clients should resolve by class). */
  global: DeepLockState;
  status: string;
  aggressive: boolean;
  violations: FocusViolation[];
  shield: { id: string; displayName: string };
};

type Sub = { res: Response };
const sseClients = new Set<Sub>();
let lastPayload: DeepLockPayload | null = null;

export function buildDeepLockPayload(db: DatabaseSync): DeepLockPayload {
  const store = getDeepLockStore(db);
  const global = store.global;
  const shield = getShieldConnector();
  return {
    type: 'deep_lock',
    at: new Date().toISOString(),
    store,
    global,
    status: deepLockStatusLabel(global),
    aggressive: deepLockAggressive(global),
    violations: listFocusViolations(db).slice(0, 50),
    shield: { id: shield.id, displayName: shield.displayName },
  };
}

export function broadcastDeepLock(db: DatabaseSync) {
  const payload = buildDeepLockPayload(db);
  lastPayload = payload;
  const data = `event: deep_lock\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of [...sseClients]) {
    try {
      client.res.write(data);
    } catch {
      sseClients.delete(client);
    }
  }
}

export function addDeepLockSseClient(res: Response) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  const sub = { res };
  sseClients.add(sub);
  if (lastPayload) {
    res.write(`event: deep_lock\ndata: ${JSON.stringify(lastPayload)}\n\n`);
  }
  res.on('close', () => {
    sseClients.delete(sub);
  });
}
