import type { ShieldClientRef, ShieldConnector, ShieldAuthorizeOpts } from './types.js';

/**
 * Default when no real gateway is configured.
 * Does not pretend authorize/kick succeeded (unlike lab-only MockShieldConnector).
 */
export class OffShieldConnector implements ShieldConnector {
  readonly id = 'off';
  readonly displayName = '未配置（需 OPNsense / UniFi / HTTP）';

  async authorizeClient(_opts: ShieldAuthorizeOpts) {
    return { ok: false, detail: 'shield_not_configured' };
  }

  async revokeClient(_opts: ShieldClientRef) {
    return { ok: false, detail: 'shield_not_configured' };
  }

  async kickClient(_opts: ShieldClientRef) {
    return { ok: false, detail: 'shield_not_configured' };
  }

  async releaseClient(_opts: ShieldClientRef) {
    return { ok: false, detail: 'shield_not_configured' };
  }

  async health() {
    return { ok: false, detail: 'shield_not_configured' };
  }
}
