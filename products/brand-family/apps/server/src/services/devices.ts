import { nanoid } from 'nanoid';
import type { DevicePlatform, DeviceRecord } from '@brand-family/shared';
import { getDb } from '../db/connection.js';
import { getChildOwned } from './children.js';

type DeviceRow = {
  id: string;
  child_id: string;
  child_name: string;
  name: string;
  platform: DevicePlatform;
  last_seen_at: string | null;
  created_at: string;
};

function toDevice(row: DeviceRow): DeviceRecord {
  return {
    id: row.id,
    childId: row.child_id,
    childName: row.child_name,
    name: row.name,
    platform: row.platform,
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
  };
}

export function listDevices(parentId: string): DeviceRecord[] {
  const rows = getDb()
    .prepare(
      `SELECT d.id, d.child_id, c.display_name AS child_name, d.name, d.platform,
              d.last_seen_at, d.created_at
       FROM devices d
       JOIN children c ON c.id = d.child_id
       WHERE c.parent_id = ?
       ORDER BY d.created_at ASC`,
    )
    .all(parentId) as DeviceRow[];
  return rows.map(toDevice);
}

export function createDevice(
  parentId: string,
  input: { childId: string; name: string; platform: DevicePlatform },
): DeviceRecord | null {
  if (!getChildOwned(parentId, input.childId)) return null;
  const id = nanoid();
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO devices (id, child_id, name, platform, last_seen_at, created_at)
       VALUES (?, ?, ?, ?, NULL, ?)`,
    )
    .run(id, input.childId, input.name.trim(), input.platform, now);
  const row = getDb()
    .prepare(
      `SELECT d.id, d.child_id, c.display_name AS child_name, d.name, d.platform,
              d.last_seen_at, d.created_at
       FROM devices d
       JOIN children c ON c.id = d.child_id
       WHERE d.id = ? AND c.parent_id = ?`,
    )
    .get(id, parentId) as DeviceRow | undefined;
  return row ? toDevice(row) : null;
}

export function deleteDevice(parentId: string, deviceId: string): boolean {
  const result = getDb()
    .prepare(
      `DELETE FROM devices
       WHERE id = ? AND child_id IN (SELECT id FROM children WHERE parent_id = ?)`,
    )
    .run(deviceId, parentId);
  return result.changes > 0;
}
