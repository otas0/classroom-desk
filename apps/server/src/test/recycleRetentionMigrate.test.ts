import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RECYCLE_RETENTION_DAYS } from '@classroom-desk/shared';
import { closeDb, openDb } from '../db/client.js';
import { getSetting, migrate } from '../db/migrate.js';

function run() {
  const prevData = process.env.CLASSROOM_DESK_DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-ret-mig-'));
  process.env.CLASSROOM_DESK_DATA_DIR = dir;
  closeDb();

  try {
    migrate();
    const db = openDb();
    // Simulate legacy default
    db.prepare(
      `INSERT INTO settings (key, value) VALUES ('recycle_retention_days', '30')
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run();
    db.prepare(`DELETE FROM settings WHERE key = 'recycle_retention_align_shared_v1'`).run();
    closeDb();

    migrate();
    const db2 = openDb();
    assert.equal(getSetting(db2, 'recycle_retention_days'), String(RECYCLE_RETENTION_DAYS));
    assert.equal(getSetting(db2, 'recycle_retention_align_shared_v1'), '1');

    // Custom 14 must not be rewritten on second migrate
    db2
      .prepare(
        `INSERT INTO settings (key, value) VALUES ('recycle_retention_days', '14')
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run();
    closeDb();
    migrate();
    const db3 = openDb();
    assert.equal(getSetting(db3, 'recycle_retention_days'), '14');

    console.log('recycleRetentionMigrate.test.ts ok');
  } finally {
    closeDb();
    if (prevData === undefined) delete process.env.CLASSROOM_DESK_DATA_DIR;
    else process.env.CLASSROOM_DESK_DATA_DIR = prevData;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

run();
