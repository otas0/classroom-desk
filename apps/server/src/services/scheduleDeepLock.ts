/**
 * When deep_lock_follow_schedule=1, apply named profile (quiz / self-study) for the
 * active attendance_schedules window; restore saved baseline when the window ends.
 */
import type { DatabaseSync } from 'node:sqlite';
import {
  normalizeDeepLockState,
  type DeepLockState,
  type DeepLockStore,
} from '@classroom-desk/shared';
import { getSetting } from '../db/migrate.js';
import { writeAudit } from './audit.js';
import {
  applyDeepLockAction,
  getDeepLockStore,
  saveDeepLockStore,
} from './deepLock.js';
import { broadcastDeepLock } from './deepLockHub.js';

const REVERT_KEY = 'deep_lock_schedule_revert';
const PROFILE_KEY = 'deep_lock_schedule_profiles';
const ACTIVE_KEY = 'deep_lock_schedule_active';

type ScheduleRow = {
  class_id: string;
  weekdays: string;
  start_time: string;
  end_time: string;
  enabled: number;
  deep_lock_profile: string | null;
};

function localWeekday(d = new Date()): number {
  const js = d.getDay();
  return js === 0 ? 7 : js;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function hmNow(d = new Date()): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function loadProfiles(db: DatabaseSync): Record<string, Partial<DeepLockState>> {
  const raw = getSetting(db, PROFILE_KEY);
  if (!raw) return {};
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, Partial<DeepLockState>> = {};
    for (const [k, v] of Object.entries(o ?? {})) {
      if (v && typeof v === 'object') out[k] = normalizeDeepLockState(v);
    }
    return out;
  } catch {
    return {};
  }
}

function readRevert(db: DatabaseSync): DeepLockStore | null {
  const raw = getSetting(db, REVERT_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DeepLockStore;
  } catch {
    return null;
  }
}

function writeRevert(db: DatabaseSync, store: DeepLockStore | null) {
  if (!store) {
    db.prepare(`DELETE FROM settings WHERE key = ?`).run(REVERT_KEY);
    return;
  }
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(REVERT_KEY, JSON.stringify(store));
}

function activeSchedule(
  db: DatabaseSync,
  now: Date,
): { classId: string; profile: string } | null {
  const weekday = localWeekday(now);
  const hm = hmNow(now);
  const schedules = db
    .prepare(
      `SELECT class_id, weekdays, start_time, end_time, enabled, deep_lock_profile
       FROM attendance_schedules WHERE enabled = 1`,
    )
    .all() as ScheduleRow[];
  for (const s of schedules) {
    let days: number[] = [];
    try {
      days = JSON.parse(s.weekdays) as number[];
    } catch {
      continue;
    }
    if (!days.includes(weekday)) continue;
    if (hm < s.start_time || hm > s.end_time) continue;
    const profile = String(s.deep_lock_profile ?? '').trim();
    if (!profile) continue;
    return { classId: s.class_id, profile };
  }
  return null;
}

export async function syncDeepLockToSchedules(
  db: DatabaseSync,
  now = new Date(),
): Promise<{ applied: boolean; restored: boolean; classId: string | null }> {
  if ((getSetting(db, 'deep_lock_follow_schedule') ?? '0') !== '1') {
    return { applied: false, restored: false, classId: null };
  }

  const active = activeSchedule(db, now);
  const profiles = loadProfiles(db);
  const revert = readRevert(db);

  if (active) {
    const patch = profiles[active.profile];
    if (!patch) return { applied: false, restored: false, classId: active.classId };
    const activeSig = `${active.classId}:${active.profile}`;
    if (getSetting(db, ACTIVE_KEY) === activeSig) {
      return { applied: false, restored: false, classId: active.classId };
    }
  }

  if (active) {
    if (!revert) {
      writeRevert(db, getDeepLockStore(db));
    }
    const activeSig = `${active.classId}:${active.profile}`;
    db.prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(ACTIVE_KEY, activeSig);
    const patch = profiles[active.profile]!;
    try {
      await applyDeepLockAction(
        db,
        { action: 'patch', classId: active.classId, patch },
        { actorRole: 'system' },
      );
    } catch (e) {
      const { LabGoLiveBlockedError } = await import('./labGoLive.js');
      if (e instanceof LabGoLiveBlockedError) {
        console.warn(
          `[deep-lock] schedule profile skipped — lab go-live blocked: ${e.blockReasons.join(';')}`,
        );
        writeAudit({
          actorUserId: null,
          actorRole: 'system',
          action: 'deep_lock.schedule_blocked',
          classId: active.classId,
          detail: { profile: active.profile, blockReasons: e.blockReasons },
        });
        return { applied: false, restored: false, classId: active.classId };
      }
      throw e;
    }
    broadcastDeepLock(db);
    writeAudit({
      actorUserId: null,
      actorRole: 'system',
      action: 'deep_lock.schedule_apply',
      classId: active.classId,
      detail: { profile: active.profile },
    });
    return { applied: true, restored: false, classId: active.classId };
  }

  if (revert) {
    saveDeepLockStore(db, revert);
    writeRevert(db, null);
    db.prepare(`DELETE FROM settings WHERE key = ?`).run(ACTIVE_KEY);
    broadcastDeepLock(db);
    writeAudit({
      actorUserId: null,
      actorRole: 'system',
      action: 'deep_lock.schedule_restore',
      detail: { reason: 'schedule_end' },
    });
    return { applied: false, restored: true, classId: null };
  }

  return { applied: false, restored: false, classId: null };
}
