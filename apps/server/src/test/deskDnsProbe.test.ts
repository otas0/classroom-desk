import assert from 'node:assert/strict';
import {
  parseLsofUdp53,
  preferDeskDnsProbeTool,
} from '../services/deskDnsProbe.js';

assert.equal(
  preferDeskDnsProbeTool({ platform: 'darwin', hasSs: false, hasLsof: true }),
  'lsof',
);
assert.equal(
  preferDeskDnsProbeTool({ platform: 'darwin', hasSs: true, hasLsof: true }),
  'lsof',
);
assert.equal(
  preferDeskDnsProbeTool({ platform: 'linux', hasSs: true, hasLsof: true }),
  'ss',
);
assert.equal(
  preferDeskDnsProbeTool({ platform: 'linux', hasSs: false, hasLsof: true }),
  'lsof',
);
assert.equal(
  preferDeskDnsProbeTool({ platform: 'linux', hasSs: false, hasLsof: false }),
  'none',
);

assert.equal(parseLsofUdp53(''), false);
assert.equal(
  parseLsofUdp53('COMMAND  PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME\nnamed  1 root  5u  IPv4  UDP *:53'),
  true,
);

if (process.platform === 'darwin') {
  assert.equal(
    preferDeskDnsProbeTool({ platform: process.platform, hasSs: false, hasLsof: true }),
    'lsof',
  );
}

console.log('deskDnsProbe.test.ts ok');
