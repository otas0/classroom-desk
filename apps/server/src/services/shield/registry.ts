import { MockShieldConnector } from './mockConnector.js';
import type { ShieldConnector } from './types.js';

let active: ShieldConnector = new MockShieldConnector();

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
