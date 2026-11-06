import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrate } from '../db/migrate.js';

const REQUIRED_TABLES = [
  'users',
  'classes',
  'assignments',
  'assignment_submissions',
  'points_log',
  'messages',
  'message_replies',
  'questions',
  'question_options',
  'student_answers',
  'error_stats',
  'attendance_sessions',
  'attendance_records',
  'point_requests',
  'presence_heartbeats',
  'cleanup_stats',
  'settings',
  'attendance_schedules',
  'attendance_holidays',
];

function run() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'classroom-desk-schema-'));
  const dbPath = path.join(dir, 'test.db');
  const db = new DatabaseSync(dbPath);
  migrate(db);

  const rows = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
    .all() as Array<{ name: string }>;
  const names = new Set(rows.map((r) => r.name));

  for (const table of REQUIRED_TABLES) {
    assert.equal(names.has(table), true, `missing table: ${table}`);
  }

  const ttl = db.prepare(`SELECT value FROM settings WHERE key = 'point_request_ttl_minutes'`).get() as {
    value: string;
  };
  assert.equal(ttl.value, '60');

  const cleanup = db
    .prepare(`SELECT value FROM settings WHERE key = 'point_request_daily_cleanup_time'`)
    .get() as { value: string };
  assert.equal(cleanup.value, '02:00');

  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`schema integration test passed (${REQUIRED_TABLES.length} tables)`);
}

run();
