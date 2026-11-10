import { createHmac, timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { config } from '../config.js';
import { getSetting } from '../db/migrate.js';

export const KEY_PORTAL_SSID_REQUIRE_SIG = 'portal_ssid_require_sig';

/**
 * Gateway injects signed SSID to reduce client spoofing:
 *   /portal?ssid=Faculty&ssid_ts=...&ssid_sig=...
 * sig = hex(hmac_sha256(jwtSecret, `${ssid}|${ts}`))
 * ts must be within 10 minutes.
 *
 * Force mode: env CLASSROOM_DESK_PORTAL_SSID_REQUIRE_SIG=1 OR settings.portal_ssid_require_sig=1
 */
export function portalSsidRequireSig(db?: DatabaseSync | null): boolean {
  if (
    process.env.CLASSROOM_DESK_PORTAL_SSID_REQUIRE_SIG === '1' ||
    process.env.CLASSROOM_DESK_PORTAL_SSID_REQUIRE_SIG === 'true'
  ) {
    return true;
  }
  if (db) {
    return getSetting(db, KEY_PORTAL_SSID_REQUIRE_SIG) === '1';
  }
  return false;
}

export function signPortalSsid(ssid: string, ts = Math.floor(Date.now() / 1000)): string {
  const payload = `${String(ssid).trim()}|${ts}`;
  return createHmac('sha256', config.jwtSecret).update(payload).digest('hex');
}

export function verifyPortalSsid(opts: {
  ssid: string;
  ts?: string | number;
  sig?: string;
  /** When omitted, only env force-mode applies (tests). Pass db-backed flag from routes. */
  requireSig?: boolean;
}): { ok: boolean; ssid: string; reason?: string } {
  const ssid = String(opts.ssid ?? '').trim();
  const sig = String(opts.sig ?? '').trim();
  const ts = Number(opts.ts);
  if (!ssid) return { ok: false, ssid: '', reason: 'missing_ssid' };
  const requireSig = opts.requireSig ?? portalSsidRequireSig();
  if (!sig || !Number.isFinite(ts)) {
    if (requireSig) return { ok: false, ssid, reason: 'ssid_unsigned_rejected' };
    return { ok: true, ssid, reason: 'unsigned_accepted' };
  }
  if (Math.abs(Math.floor(Date.now() / 1000) - ts) > 600) {
    return { ok: false, ssid, reason: 'ssid_expired' };
  }
  const expect = signPortalSsid(ssid, ts);
  try {
    const a = Buffer.from(expect, 'hex');
    const b = Buffer.from(sig, 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return { ok: false, ssid, reason: 'ssid_bad_sig' };
    }
  } catch {
    return { ok: false, ssid, reason: 'ssid_bad_sig' };
  }
  return { ok: true, ssid };
}

export function portalSsidQuery(ssid: string): string {
  const ts = Math.floor(Date.now() / 1000);
  const sig = signPortalSsid(ssid, ts);
  return `ssid=${encodeURIComponent(ssid)}&ssid_ts=${ts}&ssid_sig=${sig}`;
}
