import type { DatabaseSync } from 'node:sqlite';
import { upsertSetting } from './exitLock.js';
import { nowIso } from '../utils/id.js';

const KEY = 'portal_session_epoch';

/**
 * Cookie TTL sync with lesson end: bump epoch so old portal JWTs are rejected
 * (tokens embed iat; verify checks epoch via issued-at vs stored epoch).
 */
export function getPortalSessionEpoch(db: DatabaseSync): number {
  const raw = String(
    // lazy import avoid cycle — use prepare settings
    (db.prepare(`SELECT value FROM settings WHERE key = ?`).get(KEY) as { value?: string } | undefined)
      ?.value ?? '0',
  );
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

export function bumpPortalSessionEpoch(db: DatabaseSync): number {
  const next = Math.floor(Date.now() / 1000);
  upsertSetting(db, KEY, String(next));
  return next;
}

export function clearPortalSessionsOnLessonEnd(db: DatabaseSync) {
  bumpPortalSessionEpoch(db);
  upsertSetting(db, 'portal_last_lesson_end_at', nowIso());
}
