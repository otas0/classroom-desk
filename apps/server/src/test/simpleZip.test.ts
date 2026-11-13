import assert from 'node:assert/strict';
import { crc32 } from 'node:zlib';
import { buildStoreZip } from '../utils/simpleZip.js';

const zip = buildStoreZip([
  { name: 'classroom-desk-config.json', data: '{"ok":true}\n' },
  { name: 'CLASS-CARD.txt', data: 'hello\n' },
]);

assert.equal(zip[0], 0x50);
assert.equal(zip[1], 0x4b);
assert.ok(zip.includes(Buffer.from('classroom-desk-config.json')));
assert.ok(zip.includes(Buffer.from('{"ok":true}\n')));
const data = Buffer.from('{"ok":true}\n');
assert.ok(zip.includes(Buffer.from([
  (crc32(data) >>> 0) & 0xff,
])));
console.log('simpleZip.test.ts OK', zip.length, 'bytes');
