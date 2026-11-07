#!/usr/bin/env node
/**
 * Single source of truth: docs/PERMISSIONS.md → apps/teacher-web/public/PERMISSIONS.md
 * Run before teacher-web build / Vite public serve.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'docs', 'PERMISSIONS.md');
const dest = path.join(root, 'apps', 'teacher-web', 'public', 'PERMISSIONS.md');

if (!fs.existsSync(src)) {
  console.error(`[sync-permissions] missing ${src}`);
  process.exit(1);
}
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.copyFileSync(src, dest);
console.log(`[sync-permissions] ${path.relative(root, src)} → ${path.relative(root, dest)}`);
