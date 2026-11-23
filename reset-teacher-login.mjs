#!/usr/bin/env node
/**
 * Reset teacher login to username=teacher / password=admin (and ADMIN_PASSWORD=admin).
 * Safe to drop into an already-installed C:\ClassroomDesk tree and run via Reset-Teacher-Login.bat.
 * After login, Admin forces a password change in 设置 (admin is on the weak list).
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const DEFAULT_USER = 'teacher';
const DEFAULT_PASS = 'admin';
/** Fallback bcrypt hash for "admin" (cost 10) when bcryptjs cannot be loaded. */
const ADMIN_BCRYPT =
  '$2b$10$hqr6zRjWW5mchgqlYZfa6O9qCAfUdXqk4LLu.pKIrzqvWkWUS9/rS';

const root = process.env.CLASSROOM_DESK_ROOT
  ? path.resolve(process.env.CLASSROOM_DESK_ROOT)
  : path.resolve(process.cwd());

function setEnvKey(envPath, key, value) {
  let text = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  const lines = text.split(/\r?\n/);
  let found = false;
  const next = lines.map((line) => {
    if (line.startsWith(`${key}=`)) {
      found = true;
      return `${key}=${value}`;
    }
    return line;
  });
  if (!found) next.push(`${key}=${value}`);
  while (next.length && next[next.length - 1] === '') next.pop();
  next.push('');
  fs.writeFileSync(envPath, next.join('\n'), 'utf8');
}

async function loadBcrypt(installRoot) {
  const candidates = [
    path.join(installRoot, 'node_modules', 'bcryptjs'),
    path.join(installRoot, 'apps', 'server', 'node_modules', 'bcryptjs'),
  ];
  for (const dir of candidates) {
    if (!fs.existsSync(path.join(dir, 'package.json'))) continue;
    try {
      const req = createRequire(path.join(dir, 'package.json'));
      return req('bcryptjs');
    } catch {
      try {
        const mod = await import(pathToFileURL(path.join(dir, 'index.js')).href);
        return mod.default ?? mod;
      } catch {
        /* try next */
      }
    }
  }
  return null;
}

async function hashPass(installRoot, password) {
  const bcrypt = await loadBcrypt(installRoot);
  if (bcrypt?.hash) return bcrypt.hash(password, 10);
  if (password === DEFAULT_PASS) return ADMIN_BCRYPT;
  throw new Error('bcryptjs missing — cannot hash non-default password');
}

function findDb(installRoot) {
  const envData = process.env.CLASSROOM_DESK_DATA_DIR?.trim();
  const candidates = [
    envData ? path.join(envData, 'classroom.db') : '',
    path.join(installRoot, 'apps', 'server', 'data', 'classroom.db'),
    path.join(installRoot, 'data', 'classroom.db'),
  ].filter(Boolean);
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return candidates[0];
}

const envPath = path.join(root, '.env');
if (!fs.existsSync(envPath) && !fs.existsSync(path.join(root, 'Install.bat'))) {
  console.error(`Not a Classroom Desk install root: ${root}`);
  process.exit(1);
}

setEnvKey(envPath, 'TEACHER_USERNAME', DEFAULT_USER);
setEnvKey(envPath, 'TEACHER_PASSWORD', DEFAULT_PASS);
setEnvKey(envPath, 'ADMIN_PASSWORD', DEFAULT_PASS);
console.log(`Updated ${envPath}`);

const dbPath = findDb(root);
const hash = await hashPass(root, DEFAULT_PASS);

if (!fs.existsSync(dbPath)) {
  console.log(`No DB yet at ${dbPath} — .env only; first start will bootstrap teacher/admin`);
  process.exit(0);
}

const db = new DatabaseSync(dbPath);
try {
  db.exec('BEGIN');
  const named = db.prepare(`SELECT id FROM users WHERE username = ?`).get(DEFAULT_USER);
  const firstTeacher = db
    .prepare(
      `SELECT id FROM users WHERE role IN ('teacher', 'admin') ORDER BY created_at ASC LIMIT 1`,
    )
    .get();
  const targetId = named?.id || firstTeacher?.id;
  if (targetId) {
    db.prepare(
      `UPDATE users SET username = ?, password_hash = ?, role = 'teacher', password_ok = 0 WHERE id = ?`,
    ).run(DEFAULT_USER, hash, targetId);
    console.log(`Reset user id=${targetId} → ${DEFAULT_USER} / ${DEFAULT_PASS}`);
  } else {
    console.log('No teacher row yet — bootstrap on next start will create teacher/admin');
  }
  db.prepare(
    `INSERT INTO settings (key, value) VALUES ('admin_password_hash', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(hash);
  db.prepare(
    `INSERT INTO settings (key, value) VALUES ('teacher_password_ok', '0')
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run();
  db.exec('COMMIT');
} catch (e) {
  try {
    db.exec('ROLLBACK');
  } catch {
    /* ignore */
  }
  console.error(e);
  process.exit(1);
} finally {
  db.close();
}

console.log('Done. Login: teacher / admin — then change password in Admin → 设置');
