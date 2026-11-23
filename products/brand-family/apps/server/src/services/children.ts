import { nanoid } from 'nanoid';
import type { ChildProfile } from '@brand-family/shared';
import { getDb } from '../db/connection.js';

type ChildRow = {
  id: string;
  display_name: string;
  note: string | null;
  created_at: string;
};

function toChild(row: ChildRow): ChildProfile {
  return {
    id: row.id,
    displayName: row.display_name,
    note: row.note,
    createdAt: row.created_at,
  };
}

export function listChildren(parentId: string): ChildProfile[] {
  const rows = getDb()
    .prepare(
      `SELECT id, display_name, note, created_at FROM children
       WHERE parent_id = ? ORDER BY created_at ASC`,
    )
    .all(parentId) as ChildRow[];
  return rows.map(toChild);
}

export function getChildOwned(parentId: string, childId: string): ChildProfile | null {
  const row = getDb()
    .prepare(
      `SELECT id, display_name, note, created_at FROM children
       WHERE id = ? AND parent_id = ?`,
    )
    .get(childId, parentId) as ChildRow | undefined;
  return row ? toChild(row) : null;
}

export function createChild(
  parentId: string,
  input: { displayName: string; note?: string | null },
): ChildProfile {
  const id = nanoid();
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO children (id, parent_id, display_name, note, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(id, parentId, input.displayName.trim(), input.note?.trim() || null, now);
  const child = getChildOwned(parentId, id);
  if (!child) throw new Error('child_create_failed');
  return child;
}

export function deleteChild(parentId: string, childId: string): boolean {
  const result = getDb()
    .prepare(`DELETE FROM children WHERE id = ? AND parent_id = ?`)
    .run(childId, parentId);
  return result.changes > 0;
}
