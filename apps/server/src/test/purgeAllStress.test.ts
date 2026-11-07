import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeDb, openDb, withTransaction } from '../db/client.js';
import { migrate } from '../db/migrate.js';
import { chunkIds, sqlInPlaceholders } from '../utils/bulkIds.js';
import { newId, nowIso } from '../utils/id.js';
import { purgeChunkSize } from '../utils/purgeChunk.js';

/** Soft-delete >2k students then chunked purge-all (mirrors recycle route). */
function run() {
  const prevData = process.env.CLASSROOM_DESK_DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-purge-stress-'));
  process.env.CLASSROOM_DESK_DATA_DIR = dir;
  closeDb();

  try {
    migrate();
    const db = openDb();
    const classId = newId();
    const at = nowIso();
    db.prepare(
      `INSERT INTO classes (id, name, class_code, created_at) VALUES (?, ?, ?, ?)`,
    ).run(classId, '压测班', `P${Date.now() % 1e6}`, at);

    const N = 2100;
    assert.ok(purgeChunkSize(N) >= 200, ' >2k should use larger chunks');

    withTransaction(db, () => {
      const ins = db.prepare(
        `INSERT INTO users (id, role, display_name, username, password_hash, class_id, total_points, created_at, deleted_at)
         VALUES (?, 'student', ?, NULL, '', ?, 0, ?, ?)`,
      );
      for (let i = 0; i < N; i++) {
        ins.run(newId(), `压测${i}`, classId, at, at);
      }
    });

    const ids = (
      db
        .prepare(
          `SELECT id FROM users
           WHERE role = 'student' AND class_id = ?
             AND deleted_at IS NOT NULL AND deleted_at != ''`,
        )
        .all(classId) as Array<{ id: string }>
    ).map((r) => r.id);
    assert.equal(ids.length, N);

    const CHUNK = purgeChunkSize(ids.length);
    const chunks = chunkIds(ids, CHUNK);
    assert.ok(chunks.length >= Math.ceil(N / CHUNK) - 1);
    assert.ok(chunks.length > 5, 'expect multiple progress ticks');

    let purged = 0;
    const progress: number[] = [];
    for (const chunk of chunks) {
      const ph = sqlInPlaceholders(chunk.length);
      const info = db
        .prepare(
          `DELETE FROM users
           WHERE role = 'student' AND class_id = ?
             AND deleted_at IS NOT NULL AND deleted_at != ''
             AND id IN (${ph})`,
        )
        .run(classId, ...chunk);
      purged += Number(info.changes ?? 0);
      progress.push(purged);
    }
    assert.equal(purged, N);
    assert.equal(progress[progress.length - 1], N);
    const left = db
      .prepare(
        `SELECT COUNT(*) AS c FROM users
         WHERE role = 'student' AND class_id = ?
           AND deleted_at IS NOT NULL AND deleted_at != ''`,
      )
      .get(classId) as { c: number };
    assert.equal(Number(left.c), 0);

    assert.equal(purgeChunkSize(100), 100);
    assert.equal(purgeChunkSize(600), 150);
    assert.equal(purgeChunkSize(2500), 200);
    assert.equal(purgeChunkSize(6000), 250);

    console.log(`purgeAllStress.test.ts ok (N=${N}, chunks=${chunks.length}, chunk=${CHUNK})`);
  } finally {
    closeDb();
    if (prevData === undefined) delete process.env.CLASSROOM_DESK_DATA_DIR;
    else process.env.CLASSROOM_DESK_DATA_DIR = prevData;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

run();
