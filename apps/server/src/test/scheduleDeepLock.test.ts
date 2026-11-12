import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrate, getSetting } from '../db/migrate.js';
import { newId, nowIso } from '../utils/id.js';
import { syncDeepLockToSchedules } from '../services/scheduleDeepLock.js';
import { getDeepLockForClass } from '../services/deepLock.js';

const dir = mkdtempSync(path.join(tmpdir(), 'cd-sched-dl-'));
process.env.CLASSROOM_DESK_DATA_DIR = dir;

const db = new DatabaseSync(path.join(dir, 'test.sqlite'));
migrate(db);

const classId = newId();
const teacherId = newId();
db.prepare(
  `INSERT INTO users (id, role, display_name, username, password_hash, created_at)
   VALUES (?, 'teacher', 'T', ?, '', ?)`,
).run(teacherId, `t-${teacherId.slice(0, 6)}`, nowIso());
db.prepare(`INSERT INTO classes (id, name, class_code, created_at) VALUES (?, 't', ?, ?)`).run(
  classId,
  `c-${classId.slice(0, 8)}`,
  nowIso(),
);
db.prepare(`INSERT INTO settings (key, value) VALUES ('deep_lock_follow_schedule', '1')
  ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run();

// Ensure quiz profile exists even if migrate defaults were skipped on an older DB shape.
const profiles = getSetting(db, 'deep_lock_schedule_profiles');
assert.ok(profiles && profiles.includes('"quiz"'), 'migrate must seed quiz profile');

const scheduleId = newId();
const now = new Date();
const js = now.getDay();
const weekday = js === 0 ? 7 : js;

db.prepare(
  `INSERT INTO attendance_schedules
   (id, class_id, weekdays, start_time, end_time, late_after_minutes, enabled, deep_lock_profile, created_by, created_at)
   VALUES (?, ?, ?, '00:00', '23:59', 5, 1, 'quiz', ?, ?)`,
).run(scheduleId, classId, JSON.stringify([weekday]), teacherId, nowIso());

const result = await syncDeepLockToSchedules(db, now);
assert.equal(result.applied, true);
assert.equal(result.classId, classId);

const state = getDeepLockForClass(db, classId);
assert.equal(state.frozen, true);
assert.equal(state.netMode, 'deny');
assert.ok(getSetting(db, 'deep_lock_schedule_revert'));

rmSync(dir, { recursive: true, force: true });
console.log('scheduleDeepLock.test.ts ok');
