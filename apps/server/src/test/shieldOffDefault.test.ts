import assert from 'node:assert/strict';
import { OffShieldConnector } from '../services/shield/offConnector.js';
import {
  getShieldConnector,
  reloadShieldConnectorFromEnv,
  resetShieldConnectorToOff,
  setShieldConnector,
} from '../services/shield/registry.js';
import { productCapabilities } from '../services/portalAuth.js';

const prev = process.env.CLASSROOM_DESK_SHIELD;
const prevUrl = process.env.CLASSROOM_DESK_SHIELD_URL;
const prevAllow = process.env.CLASSROOM_DESK_ALLOW_SHIELD_MOCK;
const prevNodeEnv = process.env.NODE_ENV;
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
assert.equal(caps.netShieldEnforcing, false);
assert.ok(caps.netShieldAdapters.includes('off'));
assert.ok(caps.netShieldAdapters.includes('opnsense'));
assert.ok(!caps.netShieldAdapters.includes('mock'));

// Legacy mock env is rejected → honest off (use npm run lab:shield + http)
process.env.CLASSROOM_DESK_SHIELD = 'mock';
delete process.env.CLASSROOM_DESK_SHIELD_URL;
reloadShieldConnectorFromEnv();
assert.equal(getShieldConnector().id, 'off');

process.env.NODE_ENV = 'production';
delete process.env.CLASSROOM_DESK_ALLOW_SHIELD_MOCK;
reloadShieldConnectorFromEnv();
assert.equal(
  getShieldConnector().id,
  'off',
  'mock must fall back to off without ALLOW in production',
);

process.env.CLASSROOM_DESK_ALLOW_SHIELD_MOCK = '1';
reloadShieldConnectorFromEnv();
assert.equal(getShieldConnector().id, 'off', 'mock connector removed — always off');

setShieldConnector(new OffShieldConnector());
assert.equal(getShieldConnector().id, 'off');
resetShieldConnectorToOff();
assert.equal(getShieldConnector().id, 'off');

if (prev === undefined) delete process.env.CLASSROOM_DESK_SHIELD;
else process.env.CLASSROOM_DESK_SHIELD = prev;
if (prevUrl === undefined) delete process.env.CLASSROOM_DESK_SHIELD_URL;
else process.env.CLASSROOM_DESK_SHIELD_URL = prevUrl;
if (prevAllow === undefined) delete process.env.CLASSROOM_DESK_ALLOW_SHIELD_MOCK;
else process.env.CLASSROOM_DESK_ALLOW_SHIELD_MOCK = prevAllow;
if (prevNodeEnv === undefined) delete process.env.NODE_ENV;
else process.env.NODE_ENV = prevNodeEnv;
reloadShieldConnectorFromEnv();

console.log('shieldOffDefault.test.ts: ok');
