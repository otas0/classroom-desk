import assert from 'node:assert/strict';
import { openDb } from '../db/client.js';
import { migrate, getSetting } from '../db/migrate.js';
import { newId, nowIso } from '../utils/id.js';
import { syncDeepLockToSchedules } from '../services/scheduleDeepLock.js';
import { getDeepLockForClass } from '../services/deepLock.js';

const db = openDb();
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

const scheduleId = newId();
const now = new Date();
const js = now.getDay();
const weekday = js === 0 ? 7 : js;

db.prepare(
  `INSERT INTO attendance_schedules
   (id, class_id, weekdays, start_time, end_time, late_after_minutes, enabled, deep_lock_profile, created_by, created_at)
   VALUES (?, ?, ?, '00:00', '23:59', 5, 1, 'quiz', ?, ?)`,
).run(scheduleId, classId, JSON.stringify([weekday]), teacherId, nowIso());

await syncDeepLockToSchedules(db, now);
const state = getDeepLockForClass(db, classId);
assert.equal(state.frozen, true);
assert.equal(state.netMode, 'deny');
assert.ok(getSetting(db, 'deep_lock_schedule_revert'));

console.log('scheduleDeepLock.test.ts ok');
