import { openDb } from '../../db/client.js';
import { getSetting } from '../../db/migrate.js';
import { HttpShieldConnector } from './httpConnector.js';
import { OffShieldConnector } from './offConnector.js';
import { OpnsenseShieldConnector } from './opnsenseConnector.js';
import { UnifiShieldConnector } from './unifiConnector.js';
import type { ShieldConnector } from './types.js';

let active: ShieldConnector = new OffShieldConnector();

/** Default URL for the runnable lab HTTP gateway (deploy/lab-shield-http). */
export const LAB_SHIELD_DEFAULT_URL = 'http://127.0.0.1:8791';

function readSettingsShield(): { kind: string; url: string; token: string } {
  try {
    const db = openDb();
    return {
      kind: String(getSetting(db, 'shield_adapter') ?? '')
        .trim()
        .toLowerCase(),
      url: String(getSetting(db, 'shield_http_url') ?? '').trim(),
      token: String(getSetting(db, 'shield_http_token') ?? '').trim(),
    };
  } catch {
    return { kind: '', url: '', token: '' };
  }
}

function createFromEnv(): ShieldConnector {
  const envKind = String(process.env.CLASSROOM_DESK_SHIELD ?? '')
    .trim()
    .toLowerCase();
  const settings = readSettingsShield();
  const kind = envKind || settings.kind;

  if (kind === 'mock') {
    console.error(
      '[shield] CLASSROOM_DESK_SHIELD=mock is not supported. Use off|http|opnsense|unifi. Local: npm run lab:shield',
    );
    return new OffShieldConnector();
  }
  if (kind === 'opnsense') return new OpnsenseShieldConnector();
  if (kind === 'unifi') return new UnifiShieldConnector();
  if (kind === 'http' || kind === 'lab') {
    const url = String(
      process.env.CLASSROOM_DESK_SHIELD_URL ?? (settings.url || LAB_SHIELD_DEFAULT_URL),
    ).trim();
    const token = String(process.env.CLASSROOM_DESK_SHIELD_TOKEN ?? settings.token);
    return new HttpShieldConnector(url, token);
  }
  if (kind === 'off') return new OffShieldConnector();
  const url = String(process.env.CLASSROOM_DESK_SHIELD_URL ?? settings.url).trim();
  if (url) {
    return new HttpShieldConnector(
      url,
      process.env.CLASSROOM_DESK_SHIELD_TOKEN ?? settings.token,
    );
  }
  return new OffShieldConnector();
}

export function getShieldConnector(): ShieldConnector {
  return active;
}

export function setShieldConnector(connector: ShieldConnector) {
  active = connector;
}

/** Test / reload helper: honest off adapter. */
export function resetShieldConnectorToOff() {
  active = new OffShieldConnector();
  return active;
}

export function reloadShieldConnectorFromEnv() {
  active = createFromEnv();
  return active;
}

export function listShieldAdapterIds(): string[] {
  return ['off', 'http', 'opnsense', 'unifi'];
}

export function formatShieldActiveLabel(id: string | null | undefined): string {
  const v = String(id ?? '').trim().toLowerCase();
  if (!v || v === 'off' || v === 'mock') return 'off';
  return v;
}
