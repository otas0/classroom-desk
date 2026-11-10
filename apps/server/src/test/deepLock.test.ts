import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { deepLockAggressive, resolveDeepLockState } from '@classroom-desk/shared';
import { migrate } from '../db/migrate.js';
import {
  applyDeepLockAction,
  getDeepLockStore,
  recordFocusViolation,
  listFocusViolations,
} from '../services/deepLock.js';
import { MockShieldConnector } from '../services/shield/mockConnector.js';
import { resetShieldConnectorToMock, setShieldConnector } from '../services/shield/registry.js';

const dir = mkdtempSync(path.join(tmpdir(), 'cd-deeplock-'));
process.env.CLASSROOM_DESK_DATA_DIR = dir;

const db = new DatabaseSync(path.join(dir, 'test.sqlite'));
migrate(db);

const classId = 'class-a';
const studentId = 'stu-1';
db.prepare(
  `INSERT INTO classes (id, name, class_code, created_at) VALUES (?, ?, ?, ?)`,
).run(classId, '一班', 'C1', new Date().toISOString());
db.prepare(
  `INSERT INTO users (id, role, display_name, username, password_hash, class_id, total_points, created_at)
   VALUES (?, 'student', '甲', NULL, NULL, ?, 0, ?)`,
).run(studentId, classId, new Date().toISOString());
db.prepare(
  `INSERT INTO presence_heartbeats (student_id, class_id, last_seen_at, client_id)
   VALUES (?, ?, ?, ?)`,
).run(studentId, classId, new Date().toISOString(), 'client-1');

const mock = new MockShieldConnector();
setShieldConnector(mock);

{
  const { state } = await applyDeepLockAction(db, { action: 'freeze', classId });
  assert.equal(state.frozen, true);
  assert.equal(state.netMode, 'deny');
  assert.equal(state.killForeignBrowsers, true);
  assert.ok(deepLockAggressive(state));
  assert.equal(mock.clients.get('client-1')?.mode, 'deny');
}

{
  const { state } = await applyDeepLockAction(db, {
    action: 'exam_net',
    classId,
    examUrl: 'https://exam.example.edu/paper/1',
    allowlistHosts: ['exam.example.edu', 'cdn.example.edu'],
  });
  assert.equal(state.netMode, 'allowlist');
  assert.ok(state.allowlistHosts.includes('exam.example.edu'));
  assert.equal(mock.clients.get('client-1')?.mode, 'allowlist');
}

{
  await applyDeepLockAction(db, { action: 'kick_class', classId });
  assert.ok(mock.kicks.includes('client-1'));
}

{
  const v = recordFocusViolation(db, { studentId, classId });
  assert.equal(v.count, 1);
  recordFocusViolation(db, { studentId, classId });
  assert.equal(listFocusViolations(db)[0]?.count, 2);
}

{
  const { state } = await applyDeepLockAction(db, { action: 'end', classId });
  assert.equal(state.frozen, false);
  assert.equal(state.netMode, 'allow');
  const store = getDeepLockStore(db);
  assert.equal(resolveDeepLockState(store, classId).netMode, 'allow');
}

resetShieldConnectorToMock();
db.close();
rmSync(dir, { recursive: true, force: true });
console.log('deepLock.test.ts ok');
