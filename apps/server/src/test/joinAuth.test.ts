import assert from 'node:assert/strict';
import {
  countLiveJoinRateLimitedIps,
  getJoinFailRateLimit,
  noteJoinFailure,
} from '../services/joinAuth.js';
import { openDb } from '../db/client.js';

const ip = '203.0.113.9';

// clear bucket by using unique ip each run slice — use dedicated ip and rely on fresh process
for (let i = 0; i < 9; i++) {
  const db = openDb();
  const r = noteJoinFailure(db, ip, { reason: 'test', n: i });
  assert.equal(r.limited, false);
}
const db = openDb();
const last = noteJoinFailure(db, ip, { reason: 'test_final' });
assert.equal(last.limited, true);
assert.ok(last.retryAfterSec > 0);
const rl = getJoinFailRateLimit(ip);
assert.equal(rl.limited, true);
assert.equal(countLiveJoinRateLimitedIps(), 1);

console.log('joinAuth.test.ts ok');
