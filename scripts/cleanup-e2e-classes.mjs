#!/usr/bin/env node
/**
 * Delete local e2e junk classes that inflate the teacher class <select>.
 *
 * Matches createDedicatedClass naming: `${prefix}_${Date.now()}` (≥12 digit stamp).
 * Keeps 「本教室」 and any class whose name does not end with _<long timestamp>.
 *
 * Usage:
 *   node scripts/cleanup-e2e-classes.mjs
 *   node scripts/cleanup-e2e-classes.mjs --dry-run
 *   node scripts/cleanup-e2e-classes.mjs --db apps/server/data/classroom.db
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const dbIdx = args.indexOf('--db');
const dbPath = path.resolve(
  root,
  dbIdx >= 0 && args[dbIdx + 1] ? args[dbIdx + 1] : 'apps/server/data/classroom.db',
);

/** e2e createDedicatedClass: Prefix_1730… (Date.now(), 13 digits; allow 12+). */
const E2E_STAMP = /^.+_\d{12,}$/;

if (!fs.existsSync(dbPath)) {
  console.error('DB not found:', dbPath);
  process.exit(1);
}

const db = new DatabaseSync(dbPath);
db.exec('PRAGMA foreign_keys = ON');

const all = db
  .prepare(`SELECT id, name, class_code AS classCode, created_at AS createdAt FROM classes ORDER BY created_at DESC`)
  .all();

const junk = all.filter((r) => E2E_STAMP.test(String(r.name ?? '')));
const keep = all.filter((r) => !E2E_STAMP.test(String(r.name ?? '')));

console.log(
  JSON.stringify(
    {
      dbPath,
      dryRun,
      total: all.length,
      keep: keep.map((r) => ({ id: r.id, name: r.name, classCode: r.classCode })),
      junkCount: junk.length,
      junkSample: junk.slice(0, 12).map((r) => r.name),
    },
    null,
    2,
  ),
);

if (junk.length === 0) {
  db.close();
  process.exit(0);
}

if (dryRun) {
  db.close();
  process.exit(0);
}

db.exec('BEGIN');
try {
  const del = db.prepare(`DELETE FROM classes WHERE id = ?`);
  let removed = 0;
  for (const row of junk) {
    del.run(row.id);
    removed += 1;
  }
  // Orphan soft-deleted students whose class was removed (FK SET NULL).
  const orphans = db
    .prepare(
      `DELETE FROM users WHERE role = 'student' AND (class_id IS NULL OR class_id = '')
       AND (deleted_at IS NOT NULL AND deleted_at != '')`,
    )
    .run();
  db.exec('COMMIT');
  console.log(
    JSON.stringify({
      ok: true,
      removedClasses: removed,
      purgedOrphanSoftStudents: Number(orphans.changes ?? 0),
      remaining: db.prepare(`SELECT COUNT(*) AS c FROM classes`).get()?.c,
    }),
  );
} catch (e) {
  db.exec('ROLLBACK');
  db.close();
  console.error(e);
  process.exit(1);
}

db.close();
