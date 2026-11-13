import assert from 'node:assert/strict';
import { OffShieldConnector } from '../services/shield/offConnector.js';
import {
  getShieldConnector,
  LAB_SHIELD_DEFAULT_URL,
  reloadShieldConnectorFromEnv,
  resetShieldConnectorToOff,
  setShieldConnector,
} from '../services/shield/registry.js';
import { productCapabilities } from '../services/portalAuth.js';

const prev = process.env.CLASSROOM_DESK_SHIELD;
const prevUrl = process.env.CLASSROOM_DESK_SHIELD_URL;
delete process.env.CLASSROOM_DESK_SHIELD;
delete process.env.CLASSROOM_DESK_SHIELD_URL;

reloadShieldConnectorFromEnv();
const off = getShieldConnector();
assert.equal(off.id, 'off');
assert.match(off.displayName, /未配置/);
const auth = await off.authorizeClient({ clientKey: 'c1', mode: 'deny' });
assert.equal(auth.ok, false);
assert.equal(auth.detail, 'shield_not_configured');

const caps = productCapabilities();
assert.equal(caps.netShieldActive, 'off');
assert.ok(caps.netShieldAdapters.includes('off'));
assert.ok(caps.netShieldAdapters.includes('opnsense'));
assert.ok(!caps.netShieldAdapters.includes('mock'));

// Legacy mock env → real lab HTTP connector (npm run lab:shield)
process.env.CLASSROOM_DESK_SHIELD = 'mock';
delete process.env.CLASSROOM_DESK_SHIELD_URL;
reloadShieldConnectorFromEnv();
assert.equal(getShieldConnector().id, 'http');
assert.match(getShieldConnector().displayName, /127\.0\.0\.1:8791|lab|HTTP/i);
assert.equal(process.env.CLASSROOM_DESK_SHIELD_URL, LAB_SHIELD_DEFAULT_URL);

setShieldConnector(new OffShieldConnector());
assert.equal(getShieldConnector().id, 'off');
resetShieldConnectorToOff();
assert.equal(getShieldConnector().id, 'off');

if (prev === undefined) delete process.env.CLASSROOM_DESK_SHIELD;
else process.env.CLASSROOM_DESK_SHIELD = prev;
if (prevUrl === undefined) delete process.env.CLASSROOM_DESK_SHIELD_URL;
else process.env.CLASSROOM_DESK_SHIELD_URL = prevUrl;
reloadShieldConnectorFromEnv();

console.log('shieldOffDefault.test.ts: ok');
