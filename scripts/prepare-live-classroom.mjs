#!/usr/bin/env node
/**
 * Wipe demo/E2E/联调 fake data and prepare one live classroom for student LAN connect.
 *
 * Usage:
 *   TEACHER_PASSWORD=... node scripts/prepare-live-classroom.mjs
 *   node scripts/prepare-live-classroom.mjs --apiBase http://192.168.31.179:8787 --className 高一(3)班
 */
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import { networkInterfaces } from 'node:os';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, cur, i, arr) => {
    if (cur.startsWith('--')) acc.push([cur.slice(2), arr[i + 1] ?? '']);
    return acc;
  }, []),
);

function detectLanIp() {
  try {
    const nets = networkInterfaces();
    const preferred = [];
    for (const list of Object.values(nets)) {
      for (const n of list ?? []) {
        if (n.family !== 'IPv4' && n.family !== 4) continue;
        if (n.internal) continue;
        if (n.address.startsWith('192.168.') || n.address.startsWith('10.')) preferred.push(n.address);
      }
    }
    return preferred[0] ?? '';
  } catch {
    return '';
  }
}

const lanIp =
  detectLanIp() ||
  String(args.apiBase ?? '')
    .replace(/^https?:\/\//, '')
    .split(':')[0] ||
  '192.168.31.179';
const apiBase = String(args.apiBase ?? `http://${lanIp}:8787`).replace(/\/$/, '');
const className = String(args.className ?? '本教室').trim() || '本教室';
const teacherPassword = process.env.TEACHER_PASSWORD?.trim() || 'TeacherPass123';
const dbPath = path.join(root, 'apps/server/data/classroom.db');

if (!fs.existsSync(dbPath)) {
  console.error('DB not found:', dbPath, '— start server once first');
  process.exit(1);
}

const db = new DatabaseSync(dbPath);
db.exec('PRAGMA foreign_keys = ON');

const teacher = db.prepare(`SELECT id FROM users WHERE role = 'teacher' ORDER BY created_at LIMIT 1`).get();
if (!teacher?.id) {
  console.error('No teacher user; run ensure-teacher.mjs first');
  process.exit(1);
}

db.exec('BEGIN');
try {
  // Wipe classroom activity + students (keep teacher)
  const tables = [
    'student_answers',
    'question_options',
    'questions',
    'error_stats',
    'attendance_records',
    'attendance_sessions',
    'attendance_schedules',
    'attendance_holidays',
    'presence_heartbeats',
    'point_requests',
    'points_log',
    'message_replies',
    'messages',
    'assignment_submissions',
    'assignments',
    'cleanup_stats',
  ];
  for (const t of tables) {
    try {
      db.exec(`DELETE FROM ${t}`);
    } catch {
      /* table may not exist */
    }
  }
  db.prepare(`DELETE FROM users WHERE role = 'student'`).run();

  let klass = db.prepare(`SELECT id FROM classes ORDER BY created_at LIMIT 1`).get();
  const now = new Date().toISOString();
  if (!klass?.id) {
    const id = randomUUID();
    const code = `C${Date.now().toString(36).toUpperCase().slice(-6)}`;
    db.prepare(`INSERT INTO classes (id, name, class_code, created_at) VALUES (?, ?, ?, ?)`).run(
      id,
      className,
      code,
      now,
    );
    klass = { id };
  } else {
    db.prepare(`UPDATE classes SET name = ? WHERE id = ?`).run(className, klass.id);
  }

  const hash = await bcrypt.hash(teacherPassword, 10);
  db.prepare(`UPDATE users SET password_hash = ?, display_name = ? WHERE id = ?`).run(
    hash,
    '本班教师',
    teacher.id,
  );

  // Live settings for student connect
  const settings = {
    messages_enabled: '0', // off until teacher opens
    notice_text: '请在花名册点选自己的姓名后签到、答题、申请加分。',
    attendance_notice_text: '签到记录本工具内的到课状态。',
    classroom_api_base: apiBase,
  };
  for (const [key, value] of Object.entries(settings)) {
    db.prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(key, value);
  }

  db.exec('COMMIT');
} catch (e) {
  db.exec('ROLLBACK');
  throw e;
}

const classId = db.prepare(`SELECT id, name FROM classes ORDER BY created_at LIMIT 1`).get();
db.close();

const identity = {
  hostName: os.hostname(),
  lanIp,
  apiBase,
  classId: classId.id,
  className: classId.name,
  teacherUsername: 'teacher',
  teacherPasswordNote: '已写入 TEACHER_PASSWORD（或默认 TeacherPass123）；请在 /admin 设置里立刻改密',
  healthUrl: `${apiBase}/health`,
  adminUrl: `${apiBase}/admin/`,
  studentConfig: {
    apiBase,
    classId: classId.id,
    comment: 'Live classroom. Never use 127.0.0.1 on student PCs.',
  },
  preparedAt: new Date().toISOString(),
};

const outDir = path.join(root, 'artifacts/live-classroom');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'classroom-identity.json'), JSON.stringify(identity, null, 2) + '\n');

const cfgPath = path.join(root, 'apps/student-desktop/resources/config.json');
fs.writeFileSync(cfgPath, JSON.stringify(identity.studentConfig, null, 2) + '\n');

const rosterTpl = path.join(root, 'docs/templates/roster-import-template.csv');
fs.mkdirSync(path.dirname(rosterTpl), { recursive: true });
// Header-only template — no fake student names/numbers in repo defaults (no-mock).
fs.writeFileSync(rosterTpl, '姓名,学号\n');

console.log(JSON.stringify(identity, null, 2));
console.log('Wrote', path.join(outDir, 'classroom-identity.json'));
console.log('Wrote', cfgPath);
console.log('Roster template', rosterTpl);
console.log('Next: npm run backup:db && node scripts/pack-classroom-config.mjs --apiBase', apiBase, '--classId', classId.id);
