import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeDb, openDb } from '../db/client.js';
import { migrate } from '../db/migrate.js';
import {
  getInputLockStore,
  purgeExpiredInputLocks,
  setInputLockStore,
  setInputLockTtl,
} from '../services/inputLock.js';
import { broadcastInputLock, buildInputLockPayload } from '../services/inputLockHub.js';

async function run() {
  const prev = process.env.CLASSROOM_DESK_DATA_DIR;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cd-input-lock-ttl-'));
  process.env.CLASSROOM_DESK_DATA_DIR = dir;
  closeDb();

  try {
    migrate();
    const db = openDb();

    setInputLockStore(db, {
      flags: { keyboard: true, mouse: false, voice: false, camera: false },
    });
    const past = new Date(Date.now() - 60_000).toISOString();
    setInputLockTtl(db, { expiresAt: past, attendanceSessionId: 'sess-fake' });

    const before = getInputLockStoreRawSafe(db);
    assert.equal(before.global.keyboard, true);
    assert.ok(before.expiresAt);

    // Fake clock: still "now" in the past relative to expiresAt → purge
    const nowMs = Date.parse(past) + 1;
    const { purged, store } = purgeExpiredInputLocks(db, { actorRole: 'system' }, nowMs);
    assert.equal(purged, true);
    assert.equal(store.global.keyboard, false);
    assert.equal(store.expiresAt ?? null, null);

    // After purge, payload used for SSE broadcast is unlocked
    broadcastInputLock(db);
    const payload = buildInputLockPayload(db);
    assert.equal(payload.inputLock.keyboard, false);
    assert.equal(payload.inputLockExpiresAt, null);
    assert.equal(payload.inputLockActive, false);

    // Future expiry must not purge
    setInputLockStore(db, {
      flags: { keyboard: true, mouse: false, voice: false, camera: false },
    });
    const future = new Date(Date.now() + 3_600_000).toISOString();
    setInputLockTtl(db, { expiresAt: future, attendanceSessionId: 'sess-2' });
    const keep = purgeExpiredInputLocks(db, undefined, Date.now());
    assert.equal(keep.purged, false);
    assert.equal(getInputLockStore(db).global.keyboard, true);

    console.log('inputLockTtl.test.ts OK');
  } finally {
    closeDb();
    if (prev === undefined) delete process.env.CLASSROOM_DESK_DATA_DIR;
    else process.env.CLASSROOM_DESK_DATA_DIR = prev;
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

/** Peek store without TTL purge (inject nowMs=0 so real expiresAt never looks past). */
function getInputLockStoreRawSafe(db: ReturnType<typeof openDb>) {
  return purgeExpiredInputLocks(db, undefined, 0).store;
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
