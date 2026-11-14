import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  DEFAULT_OFFLINE_LOCK_POLICY,
  SECURITY_BUREAU_OFFLINE_LOCK_POLICY,
} from '@classroom-desk/shared';
import { migrate } from '../db/migrate.js';
import {
  evaluateLabGoLive,
  isProductionShieldAdapter,
  looksLikeMaxSecrecyArm,
  offlinePolicyRequiresLabGoLive,
} from '../services/labGoLive.js';
import { setShieldConnector } from '../services/shield/registry.js';
import { OffShieldConnector } from '../services/shield/offConnector.js';
import { HttpShieldConnector } from '../services/shield/httpConnector.js';

const dir = mkdtempSync(path.join(tmpdir(), 'cd-labgolive-'));
process.env.CLASSROOM_DESK_DATA_DIR = dir;

const db = new DatabaseSync(path.join(dir, 'test.sqlite'));
migrate(db);

assert.equal(looksLikeMaxSecrecyArm(SECURITY_BUREAU_OFFLINE_LOCK_POLICY()), true);
assert.equal(looksLikeMaxSecrecyArm(DEFAULT_OFFLINE_LOCK_POLICY()), false);
assert.equal(
  looksLikeMaxSecrecyArm({
    ...SECURITY_BUREAU_OFFLINE_LOCK_POLICY(),
    freezeClassOnPeerDrop: false,
  }),
  true,
);
assert.equal(
  offlinePolicyRequiresLabGoLive({
    ...DEFAULT_OFFLINE_LOCK_POLICY(),
    freezeClassOnPeerDrop: true,
  }),
  true,
);
assert.equal(offlinePolicyRequiresLabGoLive(DEFAULT_OFFLINE_LOCK_POLICY()), false);

assert.equal(isProductionShieldAdapter('opnsense'), true);
assert.equal(isProductionShieldAdapter('mock'), false);
assert.equal(isProductionShieldAdapter('off'), false);

setShieldConnector(new OffShieldConnector());
let status = evaluateLabGoLive(db, { classId: null, deskDnsPathOk: false });
assert.equal(status.readyForMaxSecrecy, false);
assert.ok(status.blockReasons.includes('Assigned Access / Intune（L3）'));
assert.ok(status.blockReasons.includes('Shield 真网关'));
assert.ok(status.blockReasons.includes('DeskDNS/防火墙真进路径'));

setShieldConnector(new HttpShieldConnector('http://127.0.0.1:9/shield', 't'));
for (const [k, v] of [
  ['assigned_access_ready', '1'],
  ['lab_ops_fixed_ip_ready', '1'],
  ['lab_ops_av_allowlist_ready', '1'],
  ['lab_ops_wifi_no_isolation', '1'],
  ['advertise_lan_ip', '10.0.0.2'],
  ['shield_http_url', 'http://127.0.0.1:9/shield'],
] as const) {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(k, v);
}

status = evaluateLabGoLive(db, {
  classId: null,
  deskDnsPathOk: true,
  deskDnsHint: 'test',
});
assert.equal(status.checks.find((c) => c.id === 'shield_prod')?.ok, true);
assert.equal(status.checks.find((c) => c.id === 'aa_l3')?.ok, true);
assert.equal(status.checks.find((c) => c.id === 'deskdns_path')?.ok, true);
assert.equal(status.checks.find((c) => c.id === 'fixed_ip')?.ok, true);
assert.equal(status.checks.find((c) => c.id === 'av_allowlist')?.ok, true);
assert.equal(status.checks.find((c) => c.id === 'wifi_isolation')?.ok, true);
// No class → fleet_hardened fails; backup may fail without files
assert.equal(status.readyForMaxSecrecy, false);
assert.ok(status.blockReasons.includes('在线学生机均已加固'));

setShieldConnector(new OffShieldConnector());
console.log('labGoLive.test.ts ok');
