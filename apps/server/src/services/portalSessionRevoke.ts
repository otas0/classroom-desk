import type { DatabaseSync } from 'node:sqlite';
import { upsertSetting } from './exitLock.js';
import { nowIso } from '../utils/id.js';

const KEY_GLOBAL = 'portal_session_epoch';
const KEY_CLASS_PREFIX = 'portal_session_epoch:';

/**
 * Cookie TTL sync with lesson end.
 * Global epoch bumps on school-wide revoke; per-class epoch supports multi-class parallel.
 * Tokens embed iat; verify rejects when iat < max(global, class) epoch.
 */
export function getPortalSessionEpoch(db: DatabaseSync, classId?: string | null): number {
  const global = readEpoch(db, KEY_GLOBAL);
  const cid = String(classId ?? '').trim();
  if (!cid) return global;
  const perClass = readEpoch(db, `${KEY_CLASS_PREFIX}${cid}`);
  return Math.max(global, perClass);
}

function readEpoch(db: DatabaseSync, key: string): number {
  const raw = String(
    (db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as { value?: string } | undefined)
      ?.value ?? '0',
  );
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

export function bumpPortalSessionEpoch(db: DatabaseSync, classId?: string | null): number {
  const next = Math.floor(Date.now() / 1000);
  const cid = String(classId ?? '').trim();
  if (cid) {
    upsertSetting(db, `${KEY_CLASS_PREFIX}${cid}`, String(next));
  } else {
    upsertSetting(db, KEY_GLOBAL, String(next));
  }
  return next;
}

/** End of lesson for one class — only that class's portal sessions expire. */
export function clearPortalSessionsOnLessonEnd(db: DatabaseSync, classId?: string | null) {
  const cid = String(classId ?? '').trim();
  bumpPortalSessionEpoch(db, cid || null);
  upsertSetting(db, 'portal_last_lesson_end_at', nowIso());
  if (cid) upsertSetting(db, `portal_last_lesson_end_at:${cid}`, nowIso());
}
