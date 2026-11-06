import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const dbPath = path.join(root, 'apps/server/data/classroom.db');
const username = process.env.TEACHER_USERNAME?.trim() || 'teacher';
const password = process.env.TEACHER_PASSWORD?.trim() || 'ChangeMe123';
const displayName = process.env.TEACHER_DISPLAY_NAME?.trim() || '本班教师';

const db = new DatabaseSync(dbPath);
const hash = await bcrypt.hash(password, 10);
const existing = db.prepare(`SELECT id, username FROM users WHERE username = ?`).get(username);

if (existing) {
  db.prepare(`UPDATE users SET password_hash = ?, display_name = ?, role = 'teacher' WHERE id = ?`).run(
    hash,
    displayName,
    existing.id,
  );
  console.log(JSON.stringify({ action: 'updated', id: existing.id, username, displayName, password }, null, 2));
} else {
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO users (id, role, display_name, username, password_hash, class_id, total_points, created_at)
     VALUES (?, 'teacher', ?, ?, ?, NULL, 0, ?)`,
  ).run(id, displayName, username, hash, now);
  console.log(JSON.stringify({ action: 'created', id, username, displayName, password }, null, 2));
}
db.close();
