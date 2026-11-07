import type { DatabaseSync } from 'node:sqlite';
import { openDb } from '../db/client.js';
import type { AuthUser } from '../types.js';

export type ClassGrant = {
  classId: string;
  canExport: boolean;
  canAwardPoints: boolean;
};

export function listGrantsForAssistant(
  assistantId: string,
  db: DatabaseSync = openDb(),
): ClassGrant[] {
  return (
    db
      .prepare(
        `SELECT class_id AS classId, can_export AS canExport, can_award_points AS canAwardPoints
         FROM assistant_class_grants WHERE assistant_id = ?`,
      )
      .all(assistantId) as Array<{ classId: string; canExport: number; canAwardPoints: number }>
  ).map((r) => ({
    classId: r.classId,
    canExport: Boolean(r.canExport),
    canAwardPoints: Boolean(r.canAwardPoints),
  }));
}

/**
 * Assistants with zero grant rows keep legacy read-only (export allowed, award denied).
 * Once any grant exists, export/award must match the class row.
 */
export function assistantMayExport(
  user: AuthUser | undefined,
  classId: string,
  db: DatabaseSync = openDb(),
): boolean {
  if (!user) return false;
  if (user.role === 'teacher' || user.role === 'admin') return true;
  if (user.role !== 'assistant') return false;
  const grants = listGrantsForAssistant(user.id, db);
  if (grants.length === 0) return true;
  return grants.some((g) => g.classId === classId && g.canExport);
}

export function assistantMayAward(
  user: AuthUser | undefined,
  classId: string,
  db: DatabaseSync = openDb(),
): boolean {
  if (!user) return false;
  if (user.role === 'teacher' || user.role === 'admin') return true;
  if (user.role !== 'assistant') return false;
  const grants = listGrantsForAssistant(user.id, db);
  if (grants.length === 0) return false;
  return grants.some((g) => g.classId === classId && g.canAwardPoints);
}
