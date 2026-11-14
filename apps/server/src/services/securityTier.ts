import type { DatabaseSync } from 'node:sqlite';
import { getSetting } from '../db/migrate.js';
import { getShieldConnector } from './shield/registry.js';
import { getDeskDnsStatus } from './deskDns.js';

/** S-tier: school maximum hardening (honest ops), not national classified systems. */
export function securityTierSEnabled(db: DatabaseSync): boolean {
  const v = getSetting(db, 'security_tier_s');
  if (v == null || v === '') return true; // default on for new compliance installs
  return v === '1' || v === 'true';
}

export function strictNetFailClosed(db: DatabaseSync): boolean {
  if (!securityTierSEnabled(db)) return false;
  const v = getSetting(db, 'strict_net_fail_closed');
  if (v == null || v === '') return true;
  return v === '1' || v === 'true';
}

/** Production / strict: refuse CLASSROOM_DESK_PORTAL_UNMAPPED soft-allow. */
export function portalUnmappedSoftAllowForbidden(db?: DatabaseSync): boolean {
  if (process.env.NODE_ENV === 'production') return true;
  if (
    process.env.CLASSROOM_DESK_STRICT === '1' ||
    process.env.CLASSROOM_DESK_STRICT === 'true'
  ) {
    return true;
  }
  if (db && securityTierSEnabled(db)) return true;
  return false;
}

export type NetPathArm = {
  shieldArmed: boolean;
  deskDnsArmed: boolean;
  anyArmed: boolean;
  detail: string;
};

/** At least one cut path must be live for S-tier deep-lock tighten. */
export function evaluateNetPathsArmed(): NetPathArm {
  const shield = getShieldConnector();
  const shieldArmed = shield.id !== 'off';
  const dns = getDeskDnsStatus();
  const deskDnsArmed = Boolean(dns.enabled && dns.running);
  return {
    shieldArmed,
    deskDnsArmed,
    anyArmed: shieldArmed || deskDnsArmed,
    detail: `shield=${shield.id};deskdns=${deskDnsArmed ? `up:${dns.port}` : dns.enabled ? 'enabled_not_bound' : 'off'}`,
  };
}
