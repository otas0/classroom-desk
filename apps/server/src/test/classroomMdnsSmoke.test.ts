import assert from 'node:assert/strict';
import { startClassroomMdns, stopClassroomMdns } from '../services/classroomMdns.js';

process.env.CLASSROOM_DESK_MDNS = '0';
startClassroomMdns();
stopClassroomMdns();
startClassroomMdns();
stopClassroomMdns();
assert.ok(true);

console.log('classroomMdnsSmoke.test.ts ok');
