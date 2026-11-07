import { WEAK_TEACHER_PASSWORDS, isWeakTeacherPassword as sharedIsWeak } from '@classroom-desk/shared';
import type { DatabaseSync } from 'node:sqlite';
import { getSetting } from '../db/migrate.js';
import { openDb } from '../db/client.js';

const EXTRA_KEY = 'weak_teacher_passwords_extra';

export function getExtraWeakPasswords(db: DatabaseSync = openDb()): string[] {
  const raw = getSetting(db, EXTRA_KEY) ?? '[]';
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.map((x) => String(x)).filter((s) => s.length > 0 && s.length <= 128))];
  } catch {
    return [];
  }
}

export function setExtraWeakPasswords(list: string[], db: DatabaseSync = openDb()): string[] {
  const cleaned = [...new Set(list.map((x) => String(x).trim()).filter((s) => s.length > 0 && s.length <= 128))];
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(EXTRA_KEY, JSON.stringify(cleaned));
  return cleaned;
}

export function allWeakPasswords(db: DatabaseSync = openDb()): string[] {
  return [...new Set([...WEAK_TEACHER_PASSWORDS, ...getExtraWeakPasswords(db)])];
}

export function isWeakTeacherPassword(password: string, db: DatabaseSync = openDb()): boolean {
  return sharedIsWeak(password) || getExtraWeakPasswords(db).includes(password);
}
