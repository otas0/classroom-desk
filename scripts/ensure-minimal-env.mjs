#!/usr/bin/env node
/**
 * Create a one-shot .env for TeacherHost packs when missing.
 * Default login is teacher / admin — change in Admin → 设置 (weak-password gate).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(root, '.env');

function secret(bytes = 24) {
  return crypto.randomBytes(bytes).toString('base64url');
}

if (fs.existsSync(envPath)) {
  console.log('.env already exists — keep');
  process.exit(0);
}

const teacherPass = 'admin';
const adminPass = 'admin';
const body = [
  `JWT_SECRET=${secret(32)}`,
  'TEACHER_USERNAME=teacher',
  `TEACHER_PASSWORD=${teacherPass}`,
  `ADMIN_PASSWORD=${adminPass}`,
  `BOOTSTRAP_LOGIN_TOKEN=${secret(24)}`,
  'HOST=0.0.0.0',
  'PORT=8787',
  '',
].join('\n');

fs.writeFileSync(envPath, body, 'utf8');
console.log('Wrote .env');
console.log('Default login: teacher / admin — change in Admin settings');
