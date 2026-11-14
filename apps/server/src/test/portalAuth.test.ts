import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrate } from '../db/migrate.js';
import {
  admitPortalClient,
  findStudentByNo,
  issuePortalOtp,
  productCapabilities,
  setPortalSharedCode,
  signPortalSession,
  verifyPortalOtp,
  verifyPortalSession,
} from '../services/portalAuth.js';
import { saveNetworkZones } from '../services/networkZones.js';
import { OffShieldConnector } from '../services/shield/offConnector.js';
import { resetShieldConnectorToOff, setShieldConnector } from '../services/shield/registry.js';

const caps = productCapabilities();
assert.equal(caps.salesPhase, 'pilot');
assert.equal(caps.gaReady, false);
assert.equal(caps.examBoxHardware, false);
assert.equal(caps.netPortal, true);
assert.equal(caps.deviceFingerprinting, false);
assert.equal(caps.neverStudentNetBlock, true);
assert.equal(caps.enterprise8021x, true);

const dir = mkdtempSync(path.join(tmpdir(), 'cd-portal-'));
process.env.CLASSROOM_DESK_DATA_DIR = dir;
process.env.CLASSROOM_DESK_E2E = '1';
const db = new DatabaseSync(path.join(dir, 'test.sqlite'));
migrate(db);

const classId = 'c1';
const studentId = 's1';
db.prepare(`INSERT INTO classes (id, name, class_code, created_at) VALUES (?, ?, ?, ?)`).run(
  classId,
  '班',
  'P1',
  new Date().toISOString(),
);
db.prepare(
  `INSERT INTO users (id, role, display_name, username, password_hash, class_id, total_points, created_at, student_no)
   VALUES (?, 'student', '生', NULL, NULL, ?, 0, ?, ?)`,
).run(studentId, classId, new Date().toISOString(), '20260099');

assert.equal(findStudentByNo(db, '20260099')?.id, studentId);

const issued = issuePortalOtp(db, studentId);
assert.ok(issued.debugCode);
assert.equal(verifyPortalOtp(db, studentId, issued.debugCode!), true);

setPortalSharedCode(db, 'SCHOOLPORTAL');
assert.equal(verifyPortalOtp(db, studentId, 'SCHOOLPORTAL'), true);

const token = await signPortalSession({
  studentId,
  classId,
  displayName: '生',
  studentNo: '20260099',
});
const sess = await verifyPortalSession(token);
assert.equal(sess?.studentId, studentId);

saveNetworkZones(db, [
  {
    id: 'staff',
    label: '教工',
    ssidIncludes: ['Faculty'],
    cidrs: [],
    vlan: '',
    allowedRoles: ['teacher'],
    defaultNetMode: 'allow',
    defaultAllowlistHosts: [],
    studentUnauthorized: 'flag',
    requirePortal: false,
    enabled: true,
  },
  {
    id: 'learn',
    label: '学生',
    ssidIncludes: ['Student'],
    cidrs: [],
    vlan: '',
    allowedRoles: ['student'],
    defaultNetMode: 'allow',
    defaultAllowlistHosts: [],
    studentUnauthorized: 'flag',
    requirePortal: false,
    enabled: true,
  },
]);

setShieldConnector(new OffShieldConnector());

const blocked = await admitPortalClient(db, {
  session: sess!,
  hint: { ssid: 'Faculty-A' },
  clientKey: 'portal-test',
});
assert.equal(blocked.decision, 'block');
assert.equal(blocked.reason, 'never_student_net');

const allowed = await admitPortalClient(db, {
  session: sess!,
  hint: { ssid: 'Student-WiFi' },
  clientKey: 'portal-test',
});
assert.equal(allowed.decision, 'allow');
assert.equal(allowed.everStudentZone, true);

const unmappedHold = await admitPortalClient(db, {
  session: sess!,
  hint: { ssid: 'Unknown-Guest-Net' },
  clientKey: 'portal-unmapped',
});
assert.equal(unmappedHold.decision, 'block');
assert.equal(unmappedHold.reason, 'unmapped_zone');

const prevUnmapped = process.env.CLASSROOM_DESK_PORTAL_UNMAPPED;
process.env.CLASSROOM_DESK_PORTAL_UNMAPPED = 'allow';
const unmappedSoft = await admitPortalClient(db, {
  session: sess!,
  hint: { ssid: 'Unknown-Guest-Net' },
  clientKey: 'portal-unmapped-soft',
});
assert.equal(unmappedSoft.decision, 'allow');
assert.equal(unmappedSoft.reason, 'unmapped_zone');
if (prevUnmapped === undefined) delete process.env.CLASSROOM_DESK_PORTAL_UNMAPPED;
else process.env.CLASSROOM_DESK_PORTAL_UNMAPPED = prevUnmapped;

resetShieldConnectorToOff();
db.close();
rmSync(dir, { recursive: true, force: true });
console.log('portalAuth.test.ts ok');
