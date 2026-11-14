import { openDb } from '../../db/client.js';
import { getSetting } from '../../db/migrate.js';
import { HttpShieldConnector } from './httpConnector.js';
import { MockShieldConnector } from './mockConnector.js';
import { OffShieldConnector } from './offConnector.js';
import { OpnsenseShieldConnector } from './opnsenseConnector.js';
import { UnifiShieldConnector } from './unifiConnector.js';
import type { ShieldConnector } from './types.js';

let active: ShieldConnector = new OffShieldConnector();

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
  // Env wins when set (ops / systemd); otherwise teacher settings.
  const kind = envKind || settings.kind;
  if (kind === 'opnsense') return new OpnsenseShieldConnector();
  if (kind === 'unifi') return new UnifiShieldConnector();
  if (kind === 'http') {
    const url = String(process.env.CLASSROOM_DESK_SHIELD_URL ?? settings.url).trim();
    const token = String(process.env.CLASSROOM_DESK_SHIELD_TOKEN ?? settings.token);
    return new HttpShieldConnector(url, token);
  }
  if (kind === 'mock') {
    // Settings PATCH already blocks mock; env/DB must not bypass in production.
    // Dynamic import avoided — allowShieldMock is tiny and sync.
    const allow =
      process.env.CLASSROOM_DESK_ALLOW_SHIELD_MOCK === '1' ||
      process.env.NODE_ENV === 'test';
    if (!allow) {
      console.warn(
        '[shield] mock requested but CLASSROOM_DESK_ALLOW_SHIELD_MOCK≠1 — using off',
      );
      return new OffShieldConnector();
    }
    return new MockShieldConnector();
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

/** Test helper: force lab mock adapter. */
export function resetShieldConnectorToMock() {
  active = new MockShieldConnector();
  return active;
}

export function reloadShieldConnectorFromEnv() {
  active = createFromEnv();
  return active;
}

export function listShieldAdapterIds(): string[] {
  return ['off', 'http', 'opnsense', 'unifi', 'mock'];
}

export function formatShieldActiveLabel(id: string | null | undefined): string {
  const v = String(id ?? '').trim().toLowerCase();
  if (!v || v === 'off') return 'off';
  return v;
}
