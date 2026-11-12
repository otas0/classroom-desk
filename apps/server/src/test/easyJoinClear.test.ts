import assert from 'node:assert/strict';
import { openDb } from '../db/client.js';
import { migrate, getSetting } from '../db/migrate.js';
import { clearEasyJoin } from '../services/easyJoin.js';

const db = openDb();
migrate(db);
db.prepare(`INSERT INTO settings (key, value) VALUES ('student_easy_join', '1')
  ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run();
db.prepare(`INSERT INTO settings (key, value) VALUES ('student_easy_join_class_id', 'c1')
  ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run();
assert.equal(clearEasyJoin(db, { reason: 'class_end' }), true);
assert.equal(getSetting(db, 'student_easy_join'), '0');
assert.equal(getSetting(db, 'student_easy_join_class_id'), '');

console.log('easyJoinClear.test.ts ok');
