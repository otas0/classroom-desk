import assert from 'node:assert/strict';
import { decodeRoomCode, encodeRoomCode, roomCodeToApiBase } from '@classroom-desk/shared';

for (const ip of ['192.168.1.50', '10.0.0.12', '192.168.64.2']) {
  const code = encodeRoomCode(ip);
  assert.match(code!, /^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
  assert.equal(decodeRoomCode(code!), ip);
  assert.equal(roomCodeToApiBase(code!), `http://${ip}:8787`);
}

{
  const code = encodeRoomCode('192.168.1.50')!;
  const bad = `${code.slice(0, -1)}0`;
  assert.equal(decodeRoomCode(bad), null);
}

console.log('roomCode.test.ts ok');
