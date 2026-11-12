import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  ipv4InCidr,
  matchNetworkZone,
  studentUnauthorizedOnZone,
  type NetworkZone,
} from '@classroom-desk/shared';
import { migrate } from '../db/migrate.js';
import {
  applyStaffVerificationDefaults,
  enforceStudentZonePolicy,
  getEverStudentZone,
  resolveUnauthorizedAction,
  saveNetworkZones,
} from '../services/networkZones.js';
import { MockShieldConnector } from '../services/shield/mockConnector.js';
import { setShieldConnector, resetShieldConnectorToMock } from '../services/shield/registry.js';

assert.equal(ipv4InCidr('10.20.1.5', '10.20.0.0/16'), true);
assert.equal(
  resolveUnauthorizedAction(
    {
      id: 's',
      label: 'x',
      ssidIncludes: [],
      cidrs: [],
      allowedRoles: ['teacher'],
      defaultNetMode: 'allow',
      defaultAllowlistHosts: [],
      studentUnauthorized: 'flag',
      requirePortal: false,
      enabled: true,
    },
    false,
  ).reason,
  'never_student_net',
);

const zones: NetworkZone[] = [
  {
    id: 'staff',
    label: '教工自定义名',
    ssidIncludes: ['Faculty', 'Teacher'],
    cidrs: ['10.10.0.0/16'],
    allowedRoles: ['teacher', 'staff'],
    defaultNetMode: 'allow',
    defaultAllowlistHosts: [],
    studentUnauthorized: 'flag',
    requirePortal: false,
    enabled: true,
  },
  {
    id: 'learn',
    label: '学习网随便叫',
    ssidIncludes: ['Learn'],
    cidrs: ['10.20.0.0/16'],
    allowedRoles: ['student', 'teacher'],
    defaultNetMode: 'allow',
    defaultAllowlistHosts: [],
    studentUnauthorized: 'flag',
    requirePortal: false,
    enabled: true,
  },
];

assert.equal(matchNetworkZone(zones, { ssid: 'School-Faculty-5G' })?.id, 'staff');
assert.equal(studentUnauthorizedOnZone(matchNetworkZone(zones, { ssid: 'Faculty' })), true);
assert.equal(applyStaffVerificationDefaults(zones).find((z) => z.id === 'staff')?.requirePortal, true);

const dir = mkdtempSync(path.join(tmpdir(), 'cd-netzones-'));
process.env.CLASSROOM_DESK_DATA_DIR = dir;
const db = new DatabaseSync(path.join(dir, 'test.sqlite'));
migrate(db);

const classId = 'c1';
const studentId = 's1';
db.prepare(`INSERT INTO classes (id, name, class_code, created_at) VALUES (?, ?, ?, ?)`).run(
  classId,
  '班',
  'X1',
  new Date().toISOString(),
);
db.prepare(
  `INSERT INTO users (id, role, display_name, username, password_hash, class_id, total_points, created_at)
   VALUES (?, 'student', '生', NULL, NULL, ?, 0, ?)`,
).run(studentId, classId, new Date().toISOString());

saveNetworkZones(db, zones);
const mock = new MockShieldConnector();
setShieldConnector(mock);

const r = await enforceStudentZonePolicy(db, {
  studentId,
  classId,
  clientId: 'cli-1',
  hint: { ssid: 'Campus-Teacher-WiFi', ipv4: '10.10.1.9' },
});
assert.equal(r.unauthorized, true);
assert.equal(r.reason, 'never_student_net');
assert.equal(r.action, 'deny');

await enforceStudentZonePolicy(db, {
  studentId,
  classId,
  clientId: 'cli-1',
  hint: { ssid: 'Learn-Hall', ipv4: '10.20.0.8' },
});
assert.equal(getEverStudentZone(db, studentId), true);

resetShieldConnectorToMock();
db.close();
rmSync(dir, { recursive: true, force: true });
console.log('networkZones.test.ts ok');
