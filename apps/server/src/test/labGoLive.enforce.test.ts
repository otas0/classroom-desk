import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { EMPTY_DEEP_LOCK_STATE, SECURITY_BUREAU_OFFLINE_LOCK_POLICY } from '@classroom-desk/shared';
import { migrate } from '../db/migrate.js';
import {
  LabGoLiveBlockedError,
  assertLabGoLiveReady,
  deepLockActionRequiresLabGoLive,
  offlinePolicyRequiresLabGoLive,
} from '../services/labGoLive.js';
import { applyDeepLockAction } from '../services/deepLock.js';
import { setShieldConnector } from '../services/shield/registry.js';
import { OffShieldConnector } from '../services/shield/offConnector.js';

const dir = mkdtempSync(path.join(tmpdir(), 'cd-labenforce-'));
process.env.CLASSROOM_DESK_DATA_DIR = dir;
process.env.CLASSROOM_DESK_ENFORCE_LAB_GO_LIVE = '1';
process.env.NODE_ENV = 'test';

const db = new DatabaseSync(path.join(dir, 'test.sqlite'));
migrate(db);

assert.equal(offlinePolicyRequiresLabGoLive(SECURITY_BUREAU_OFFLINE_LOCK_POLICY()), true);
assert.equal(
  offlinePolicyRequiresLabGoLive({
    ...SECURITY_BUREAU_OFFLINE_LOCK_POLICY(),
    graceMs: 1_500,
    freezeClassOnPeerDrop: true,
  }),
  true,
);

const idle = EMPTY_DEEP_LOCK_STATE();
const deny = { ...idle, frozen: true, netMode: 'deny' as const };
assert.equal(deepLockActionRequiresLabGoLive(idle, deny, 'freeze'), true);
assert.equal(deepLockActionRequiresLabGoLive(deny, deny, 'kick_class'), false);
assert.equal(deepLockActionRequiresLabGoLive(deny, idle, 'end'), false);

setShieldConnector(new OffShieldConnector());

await assert.rejects(
  () => assertLabGoLiveReady(db, null),
  (e: unknown) => e instanceof LabGoLiveBlockedError,
);

await assert.rejects(
  () => applyDeepLockAction(db, { action: 'freeze', classId: null }),
  (e: unknown) => e instanceof LabGoLiveBlockedError,
);

delete process.env.CLASSROOM_DESK_ENFORCE_LAB_GO_LIVE;
setShieldConnector(new OffShieldConnector());
console.log('labGoLive.enforce.test.ts ok');
