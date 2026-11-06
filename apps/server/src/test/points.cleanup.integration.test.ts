import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrate } from '../db/migrate.js';
import { cleanupDailyPointRequests, cleanupExpiredPointRequests } from '../services/cleanup.js';
import { addPoints } from '../services/points.js';

function run() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'classroom-desk-points-'));
  const db = new DatabaseSync(path.join(dir, 'test.db'));
  migrate(db);

  const classId = 'class-1';
  const teacherId = 'teacher-1';
  const studentId = 'student-1';
  const now = new Date();

  db.prepare(`INSERT INTO classes (id, name, class_code, created_at) VALUES (?, ?, ?, ?)`).run(
    classId,
    '测试班',
    'TEST01',
    now.toISOString(),
  );
  db.prepare(
    `INSERT INTO users (id, role, display_name, username, password_hash, class_id, total_points, created_at)
     VALUES (?, 'teacher', 'T', 't', 'x', NULL, 0, ?)`,
  ).run(teacherId, now.toISOString());
  db.prepare(
    `INSERT INTO users (id, role, display_name, username, password_hash, class_id, total_points, created_at)
     VALUES (?, 'student', 'S', NULL, NULL, ?, 0, ?)`,
  ).run(studentId, classId, now.toISOString());

  const expiredId = 'req-expired';
  const pendingId = 'req-pending';
  db.prepare(
    `INSERT INTO point_requests
      (id, student_id, class_id, reason, category, status, created_at, expires_at, confirmed_by, confirmed_at, points)
     VALUES (?, ?, ?, '过期理由', 'x', 'pending', ?, ?, NULL, NULL, 2)`,
  ).run(
    expiredId,
    studentId,
    classId,
    new Date(now.getTime() - 120_000).toISOString(),
    new Date(now.getTime() - 60_000).toISOString(),
  );
  db.prepare(
    `INSERT INTO point_requests
      (id, student_id, class_id, reason, category, status, created_at, expires_at, confirmed_by, confirmed_at, points)
     VALUES (?, ?, ?, '待确认理由', 'x', 'pending', ?, ?, NULL, NULL, 3)`,
  ).run(
    pendingId,
    studentId,
    classId,
    now.toISOString(),
    new Date(now.getTime() + 3_600_000).toISOString(),
  );

  // Confirm path simulation: write points_log then delete request
  const awarded = addPoints(db, {
    studentId,
    classId,
    points: 3,
    reasonSummary: '待确认理由',
    source: 'request',
    mode: 'manual',
    requestId: pendingId,
    createdBy: teacherId,
    idempotencyKey: `point-request:${pendingId}`,
  });
  assert.equal(awarded.ok, true);
  db.prepare(`DELETE FROM point_requests WHERE id = ?`).run(pendingId);

  const dup = addPoints(db, {
    studentId,
    classId,
    points: 3,
    reasonSummary: '待确认理由',
    source: 'request',
    mode: 'manual',
    requestId: pendingId,
    createdBy: teacherId,
    idempotencyKey: `point-request:${pendingId}`,
  });
  assert.equal(dup.ok, false);

  const expiredRemoved = cleanupExpiredPointRequests(db);
  assert.equal(expiredRemoved, 1);
  const expiredLeft = db.prepare(`SELECT id FROM point_requests WHERE id = ?`).get(expiredId);
  assert.equal(expiredLeft, undefined);

  // Insert another pending and run daily wipe
  db.prepare(
    `INSERT INTO point_requests
      (id, student_id, class_id, reason, category, status, created_at, expires_at, confirmed_by, confirmed_at, points)
     VALUES ('req-daily', ?, ?, '日清理由', 'x', 'pending', ?, ?, NULL, NULL, 1)`,
  ).run(studentId, classId, now.toISOString(), new Date(now.getTime() + 3_600_000).toISOString());

  const dailyRemoved = cleanupDailyPointRequests(db);
  assert.equal(dailyRemoved >= 1, true);
  const pendingLeft = db
    .prepare(`SELECT COUNT(*) AS c FROM point_requests WHERE status IN ('pending', 'expired')`)
    .get() as { c: number };
  assert.equal(Number(pendingLeft.c), 0);

  const pointsKept = db.prepare(`SELECT COUNT(*) AS c FROM points_log`).get() as { c: number };
  assert.equal(Number(pointsKept.c), 1);

  const reasonGone = db.prepare(`SELECT id FROM point_requests WHERE reason LIKE '%理由%'`).get();
  assert.equal(reasonGone, undefined);

  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('points confirm/cleanup integration test passed');
}

run();
