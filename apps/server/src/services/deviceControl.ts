import type { DatabaseSync } from 'node:sqlite';
import {
  normalizeDeviceControlCommand,
  normalizeDeviceControlPolicy,
  normalizeOfflineLockPolicy,
  type DeviceControlCommand,
  type DeviceControlPolicy,
  type OfflineLockPolicy,
} from '@classroom-desk/shared';
import { getSetting } from '../db/migrate.js';
import { upsertSetting } from './exitLock.js';

const KEY_POLICY = 'device_control_policy';
const KEY_OFFLINE = 'offline_lock_policy';
const KEY_CMD = 'device_control_last_command';

const sseClients = new Set<import('express').Response>();

export function getDeviceControlPolicy(db: DatabaseSync): DeviceControlPolicy {
  try {
    return normalizeDeviceControlPolicy(JSON.parse(getSetting(db, KEY_POLICY) ?? 'null'));
  } catch {
    return normalizeDeviceControlPolicy(null);
  }
}

export function saveDeviceControlPolicy(db: DatabaseSync, policy: DeviceControlPolicy): DeviceControlPolicy {
  const next = normalizeDeviceControlPolicy(policy);
  upsertSetting(db, KEY_POLICY, JSON.stringify(next));
  return next;
}

export function getOfflineLockPolicy(db: DatabaseSync): OfflineLockPolicy {
  try {
    return normalizeOfflineLockPolicy(JSON.parse(getSetting(db, KEY_OFFLINE) ?? 'null'));
  } catch {
    return normalizeOfflineLockPolicy(null);
  }
}

export function saveOfflineLockPolicy(db: DatabaseSync, policy: OfflineLockPolicy): OfflineLockPolicy {
  const next = normalizeOfflineLockPolicy(policy);
  upsertSetting(db, KEY_OFFLINE, JSON.stringify(next));
  return next;
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
  broadcastDeviceControl({ type: 'device_control', command: full, policy: getDeviceControlPolicy(db) });
  return full;
}

export function deviceControlPublicPayload(db: DatabaseSync) {
  return {
    type: 'device_control' as const,
    policy: getDeviceControlPolicy(db),
    offline: getOfflineLockPolicy(db),
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
