import assert from 'node:assert/strict';
import { openDb, withTransaction } from '../db/client.js';
import { newId, nowIso } from '../utils/id.js';
import { recycleTiming } from '../utils/recycleRetention.js';

/**
 * Seed ≥500 soft-deleted questions and assert list payload + daysLeft shape
 * (virtual scroll correctness is covered by e2e; this guards API scale).
 */
function run() {
  const db = openDb();
  const cls = db.prepare(`SELECT id FROM classes ORDER BY created_at LIMIT 1`).get() as
    | { id: string }
    | undefined;
  assert.ok(cls, 'need a class');
  const teacher = db
    .prepare(`SELECT id FROM users WHERE role IN ('teacher','admin') LIMIT 1`)
    .get() as { id: string } | undefined;
  assert.ok(teacher, 'need a teacher');

  const stamp = Date.now();
  const ids: string[] = [];
  const at = nowIso();
  withTransaction(db, () => {
    const ins = db.prepare(
      `INSERT INTO questions
         (id, class_id, title, stem, type, answer_key, points, attachments, created_by, created_at, published, deleted_at)
       VALUES (?, ?, ?, ?, 'bool', '["A"]', 1, '[]', ?, ?, 1, ?)`,
    );
    for (let i = 0; i < 520; i++) {
      const id = newId();
      ids.push(id);
      // Stagger deleted_at so daysLeft spans boundary cases
      const deletedAt =
        i === 0
          ? new Date(Date.now() - 7 * 86_400_000 - 60_000).toISOString()
          : i === 1
            ? new Date(Date.now() - 7 * 86_400_000 + 3600_000).toISOString()
            : at;
      ins.run(id, cls!.id, `VR${stamp}-${i}`, 'stem', teacher!.id, at, deletedAt);
    }
  });

  const rows = db
    .prepare(
      `SELECT id, deleted_at AS deletedAt FROM questions
       WHERE class_id = ? AND deleted_at IS NOT NULL AND deleted_at != ''
         AND title LIKE ?
       ORDER BY created_at DESC`,
    )
    .all(cls!.id, `VR${stamp}-%`) as Array<{ id: string; deletedAt: string }>;

  assert.equal(rows.length, 520);
  const withTiming = rows.map((r) => ({ ...r, ...recycleTiming(r.deletedAt) }));
  assert.ok(withTiming.some((r) => r.expired === true));
  assert.ok(withTiming.some((r) => r.daysLeft === 0 && r.expired === false));
  assert.ok(withTiming.filter((r) => (r.daysLeft ?? 0) >= 6).length >= 500);

  // cleanup
  const ph = ids.map(() => '?').join(',');
  db.prepare(`DELETE FROM questions WHERE id IN (${ph})`).run(...ids);

  console.log('qRecycleVirtual.test.ts ok');
}

run();
