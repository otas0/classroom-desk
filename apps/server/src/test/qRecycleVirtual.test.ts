import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeDb, openDb, withTransaction } from '../db/client.js';
import { migrate } from '../db/migrate.js';
import { newId, nowIso } from '../utils/id.js';
import { recycleTiming } from '../utils/recycleRetention.js';

/**
 * Seed ≥500 soft-deleted questions and assert list payload + daysLeft shape
 * (virtual scroll correctness is covered by e2e; this guards API scale).
 */
function run() {
  const prevData = process.env.CLASSROOM_DESK_DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-qrecycle-'));
  process.env.CLASSROOM_DESK_DATA_DIR = dir;
  closeDb();

  try {
    const db = migrate();
    const classId = newId();
    const teacherId = newId();
    const at = nowIso();
    db.prepare(
      `INSERT INTO classes (id, name, class_code, created_at) VALUES (?, ?, ?, ?)`,
    ).run(classId, 'VR Class', `VR${Date.now() % 100000}`, at);
    db.prepare(
      `INSERT INTO users (id, role, display_name, username, password_hash, class_id, total_points, created_at)
       VALUES (?, 'teacher', ?, ?, ?, NULL, 0, ?)`,
    ).run(teacherId, 'VR Teacher', `vr_teacher_${Date.now()}`, 'x', at);

    const stamp = Date.now();
    const nowMs = stamp;
    const ids: string[] = [];
    const day = 86_400_000;
    withTransaction(db, () => {
      const ins = db.prepare(
        `INSERT INTO questions
           (id, class_id, title, stem, type, answer_key, points, attachments, created_by, created_at, published, deleted_at)
         VALUES (?, ?, ?, ?, 'bool', '["A"]', 1, '[]', ?, ?, 1, ?)`,
      );
      for (let i = 0; i < 520; i++) {
        const id = newId();
        ids.push(id);
        const deletedAt =
          i === 0
            ? new Date(nowMs - 7 * day - 60_000).toISOString()
            : i === 1
              ? new Date(nowMs - 7 * day).toISOString()
              : at;
        ins.run(id, classId, `VR${stamp}-${i}`, 'stem', teacherId, at, deletedAt);
      }
    });

    const rows = db
      .prepare(
        `SELECT id, deleted_at AS deletedAt FROM questions
         WHERE class_id = ? AND deleted_at IS NOT NULL AND deleted_at != ''
           AND title LIKE ?
         ORDER BY created_at DESC`,
      )
      .all(classId, `VR${stamp}-%`) as Array<{ id: string; deletedAt: string }>;

    assert.equal(rows.length, 520);
    const withTiming = rows.map((r) => ({ ...r, ...recycleTiming(r.deletedAt, nowMs) }));
    assert.ok(withTiming.some((r) => r.expired === true));
    assert.ok(withTiming.some((r) => r.daysLeft === 0 && r.expired === false));
    assert.ok(withTiming.filter((r) => (r.daysLeft ?? 0) >= 6).length >= 500);

    console.log('qRecycleVirtual.test.ts ok');
  } finally {
    closeDb();
    if (prevData === undefined) delete process.env.CLASSROOM_DESK_DATA_DIR;
    else process.env.CLASSROOM_DESK_DATA_DIR = prevData;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

run();
