import { HttpShieldConnector } from './httpConnector.js';
import { MockShieldConnector } from './mockConnector.js';
import { OpnsenseShieldConnector } from './opnsenseConnector.js';
import { UnifiShieldConnector } from './unifiConnector.js';
import type { ShieldConnector } from './types.js';

let active: ShieldConnector = createFromEnv();

function createFromEnv(): ShieldConnector {
  const kind = String(process.env.CLASSROOM_DESK_SHIELD ?? '')
    .trim()
    .toLowerCase();
  if (kind === 'opnsense') return new OpnsenseShieldConnector();
  if (kind === 'unifi') return new UnifiShieldConnector();
  if (kind === 'http') {
    return new HttpShieldConnector(
      process.env.CLASSROOM_DESK_SHIELD_URL ?? '',
      process.env.CLASSROOM_DESK_SHIELD_TOKEN ?? '',
    );
  }
  // Legacy: SHIELD_URL alone implies HTTP adapter.
  const url = String(process.env.CLASSROOM_DESK_SHIELD_URL ?? '').trim();
  if (url) {
    return new HttpShieldConnector(url, process.env.CLASSROOM_DESK_SHIELD_TOKEN ?? '');
  }
  return new MockShieldConnector();
}

export function getShieldConnector(): ShieldConnector {
  return active;
}

export function setShieldConnector(connector: ShieldConnector) {
  active = connector;
}

export function resetShieldConnectorToMock() {
  active = new MockShieldConnector();
  return active;
}

export function reloadShieldConnectorFromEnv() {
  active = createFromEnv();
  return active;
}

export function listShieldAdapterIds(): string[] {
  return ['mock', 'http', 'opnsense', 'unifi'];
}
