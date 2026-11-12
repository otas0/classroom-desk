import type { ShieldClientRef, ShieldConnector, ShieldAuthorizeOpts } from './types.js';

type Entry = {
  mode: 'deny' | 'allowlist' | 'allow';
  allowlistHosts: string[];
  updatedAt: string;
};

/**
 * Lab-only in-memory shield (`CLASSROOM_DESK_SHIELD=mock` or tests).
 * Product default is OffShieldConnector — do not use this as silent production fallback.
 */
export class MockShieldConnector implements ShieldConnector {
  readonly id = 'mock';
  readonly displayName = 'Mock Shield（仅联调，非生产）';
  readonly clients = new Map<string, Entry>();
  readonly kicks: string[] = [];
  /** When true, releaseClient throws (for failure-path tests). */
  failRelease = false;
  failReleaseDetail = 'mock_release_boom';

  async authorizeClient(opts: ShieldAuthorizeOpts) {
    const key = String(opts.clientKey ?? '').trim();
    if (!key) return { ok: false, detail: 'missing_client_key' };
    this.clients.set(key, {
      mode: opts.mode,
      allowlistHosts: [...(opts.allowlistHosts ?? [])],
      updatedAt: new Date().toISOString(),
    });
    return { ok: true, detail: `mock_${opts.mode}` };
  }

  async revokeClient(opts: ShieldClientRef) {
    const key = String(opts.clientKey ?? '').trim();
    if (!key) return { ok: false, detail: 'missing_client_key' };
    this.clients.delete(key);
    return { ok: true, detail: 'mock_revoked' };
  }

  async kickClient(opts: ShieldClientRef) {
    const key = String(opts.clientKey ?? '').trim();
    if (!key) return { ok: false, detail: 'missing_client_key' };
    this.clients.delete(key);
    this.kicks.push(key);
    return { ok: true, detail: 'mock_kicked' };
  }

  async releaseClient(opts: ShieldClientRef) {
    if (this.failRelease) {
      throw new Error(this.failReleaseDetail);
    }
    return this.revokeClient(opts);
  }

  async health() {
    return { ok: true, detail: `mock_clients=${this.clients.size}` };
  }
}
