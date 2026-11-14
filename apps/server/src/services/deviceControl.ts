import type { DatabaseSync } from 'node:sqlite';
import {
  normalizeDeviceControlCommand,
  normalizeDeviceControlPolicy,
  normalizeDeviceControlStore,
  normalizeOfflineLockPolicy,
  normalizeOfflineLockStore,
  resolveDeviceControlPolicy,
  resolveOfflineLockPolicy,
  type DeviceControlCommand,
  type DeviceControlPolicy,
  type DeviceControlScope,
  type DeviceControlStore,
  type OfflineLockPolicy,
  type OfflineLockScope,
  type OfflineLockStore,
} from '@classroom-desk/shared';
import { getSetting } from '../db/migrate.js';
import { upsertSetting } from './exitLock.js';

const KEY_POLICY = 'device_control_policy';
const KEY_OFFLINE = 'offline_lock_policy';
const KEY_CMD = 'device_control_last_command';

const sseClients = new Set<import('express').Response>();

export function getDeviceControlStore(db: DatabaseSync): DeviceControlStore {
  try {
    return normalizeDeviceControlStore(JSON.parse(getSetting(db, KEY_POLICY) ?? 'null'));
  } catch {
    return normalizeDeviceControlStore(null);
  }
}

/** Resolved flat policy (global when no opts). */
export function getDeviceControlPolicy(
  db: DatabaseSync,
  opts?: { classId?: string | null; studentId?: string | null },
): DeviceControlPolicy {
  return resolveDeviceControlPolicy(getDeviceControlStore(db), opts);
}

export function saveDeviceControlStore(db: DatabaseSync, store: DeviceControlStore): DeviceControlStore {
  const next = normalizeDeviceControlStore(store);
  upsertSetting(db, KEY_POLICY, JSON.stringify(next));
  return next;
}

export function saveDeviceControlPolicyScoped(
  db: DatabaseSync,
  policy: DeviceControlPolicy,
  opts: { scope: DeviceControlScope; classId?: string | null; studentIds?: string[] },
): { store: DeviceControlStore; policy: DeviceControlPolicy } {
  const store = getDeviceControlStore(db);
  const nextPolicy = normalizeDeviceControlPolicy(policy);
  const scope = opts.scope;
  if (scope === 'global') {
    store.global = nextPolicy;
  } else if (scope === 'class') {
    const cid = String(opts.classId ?? '').trim();
    if (!cid) throw new Error('class_id_required');
    store.byClass[cid] = nextPolicy;
  } else if (scope === 'student') {
    const ids = (opts.studentIds ?? []).map((x) => String(x).trim()).filter(Boolean);
    if (!ids.length) throw new Error('student_ids_required');
    for (const id of ids) store.byStudent[id] = nextPolicy;
  }
  const saved = saveDeviceControlStore(db, store);
  const resolved = resolveDeviceControlPolicy(saved, {
    classId: opts.classId,
    studentId: opts.studentIds?.[0],
  });
  return { store: saved, policy: resolved };
}

/** @deprecated flat global write — prefer saveDeviceControlPolicyScoped. */
export function saveDeviceControlPolicy(db: DatabaseSync, policy: DeviceControlPolicy): DeviceControlPolicy {
  return saveDeviceControlPolicyScoped(db, policy, { scope: 'global' }).policy;
}

export function clearDeviceControlScope(
  db: DatabaseSync,
  opts: { scope: 'class' | 'student'; classId?: string | null; studentIds?: string[] },
): DeviceControlStore {
  const store = getDeviceControlStore(db);
  if (opts.scope === 'class') {
    const cid = String(opts.classId ?? '').trim();
    if (cid) delete store.byClass[cid];
  } else {
    for (const id of opts.studentIds ?? []) {
      const sid = String(id).trim();
      if (sid) delete store.byStudent[sid];
    }
  }
  return saveDeviceControlStore(db, store);
}

export function getOfflineLockStore(db: DatabaseSync): OfflineLockStore {
  try {
    return normalizeOfflineLockStore(JSON.parse(getSetting(db, KEY_OFFLINE) ?? 'null'));
  } catch {
    return normalizeOfflineLockStore(null);
  }
}

/** @deprecated prefer getOfflineLockStore + resolve — kept for callers expecting flat global. */
export function getOfflineLockPolicy(db: DatabaseSync): OfflineLockPolicy {
  return resolveOfflineLockPolicy(getOfflineLockStore(db), {});
}

export function saveOfflineLockStore(db: DatabaseSync, store: OfflineLockStore): OfflineLockStore {
  const next = normalizeOfflineLockStore(store);
  upsertSetting(db, KEY_OFFLINE, JSON.stringify(next));
  return next;
}

export function saveOfflineLockPolicyScoped(
  db: DatabaseSync,
  policy: OfflineLockPolicy,
  opts: { scope: OfflineLockScope; classId?: string | null; studentIds?: string[] },
): { store: OfflineLockStore; offline: OfflineLockPolicy } {
  const store = getOfflineLockStore(db);
  const nextPolicy = normalizeOfflineLockPolicy(policy);
  const scope = opts.scope;
  if (scope === 'global') {
    store.global = nextPolicy;
  } else if (scope === 'class') {
    const cid = String(opts.classId ?? '').trim();
    if (!cid) throw new Error('class_id_required');
    store.byClass[cid] = nextPolicy;
  } else if (scope === 'student') {
    const ids = (opts.studentIds ?? []).map((x) => String(x).trim()).filter(Boolean);
    if (!ids.length) throw new Error('student_ids_required');
    for (const id of ids) store.byStudent[id] = nextPolicy;
  }
  const saved = saveOfflineLockStore(db, store);
  const offline = resolveOfflineLockPolicy(saved, {
    classId: opts.classId,
    studentId: opts.studentIds?.[0],
  });
  return { store: saved, offline };
}

/** Remove class or student overrides (revert to parent scope). */
export function clearOfflineLockScope(
  db: DatabaseSync,
  opts: { scope: 'class' | 'student'; classId?: string | null; studentIds?: string[] },
): OfflineLockStore {
  const store = getOfflineLockStore(db);
  if (opts.scope === 'class') {
    const cid = String(opts.classId ?? '').trim();
    if (cid) delete store.byClass[cid];
  } else {
    for (const id of opts.studentIds ?? []) {
      const sid = String(id).trim();
      if (sid) delete store.byStudent[sid];
    }
  }
  return saveOfflineLockStore(db, store);
}

export function getLastDeviceCommand(db: DatabaseSync): DeviceControlCommand | null {
  try {
    return normalizeDeviceControlCommand(JSON.parse(getSetting(db, KEY_CMD) ?? 'null'));
  } catch {
    return null;
  }
}

export function publishDeviceCommand(
  db: DatabaseSync,
  cmd: Omit<DeviceControlCommand, 'id' | 'at'> & { id?: string; at?: string },
): DeviceControlCommand {
  const full = normalizeDeviceControlCommand({
    ...cmd,
    id: cmd.id ?? `cmd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    at: cmd.at ?? new Date().toISOString(),
  });
  if (!full) throw new Error('invalid_device_command');
  upsertSetting(db, KEY_CMD, JSON.stringify(full));
  broadcastDeviceControl(deviceControlPublicPayload(db));
  return full;
}

export function deviceControlPublicPayload(
  db: DatabaseSync,
  opts?: { classId?: string | null; studentId?: string | null },
) {
  const offlineStore = getOfflineLockStore(db);
  const policyStore = getDeviceControlStore(db);
  return {
    type: 'device_control' as const,
    policy: resolveDeviceControlPolicy(policyStore, opts),
    policyStore,
    offline: resolveOfflineLockPolicy(offlineStore, opts),
    offlineStore,
    command: getLastDeviceCommand(db),
  };
}

export function addDeviceControlSseClient(res: import('express').Response) {
  sseClients.add(res);
  res.on('close', () => sseClients.delete(res));
}

export function broadcastDeviceControl(payload: unknown) {
  const data = `event: device_control\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of [...sseClients]) {
    try {
      res.write(data);
    } catch {
      sseClients.delete(res);
    }
  }
}
