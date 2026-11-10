import { HttpShieldConnector } from './httpConnector.js';
import { MockShieldConnector } from './mockConnector.js';
import type { ShieldConnector } from './types.js';

function createDefaultConnector(): ShieldConnector {
  const url = String(process.env.CLASSROOM_DESK_SHIELD_URL ?? '').trim();
  if (url) {
    return new HttpShieldConnector(url, process.env.CLASSROOM_DESK_SHIELD_TOKEN ?? '');
  }
  return new MockShieldConnector();
}

let active: ShieldConnector = createDefaultConnector();

export function getShieldConnector(): ShieldConnector {
  return active;
}

/** Tests / future gateway adapters swap the active connector here. */
export function setShieldConnector(connector: ShieldConnector) {
  active = connector;
}

export function resetShieldConnectorToMock() {
  active = new MockShieldConnector();
  return active;
}

/** Re-read env (after tests mutate CLASSROOM_DESK_SHIELD_URL). */
export function refreshShieldConnectorFromEnv() {
  active = createDefaultConnector();
  return active;
}
