import type { ShieldClientRef, ShieldConnector, ShieldAuthorizeOpts } from './types.js';

type Entry = {
  mode: 'deny' | 'allowlist' | 'allow';
  allowlistHosts: string[];
  updatedAt: string;
};

/** In-memory shield for labs without a gateway — proves control-plane wiring. */
export class MockShieldConnector implements ShieldConnector {
  readonly id = 'mock';
  readonly displayName = 'Mock Shield (in-memory)';
  readonly clients = new Map<string, Entry>();
  readonly kicks: string[] = [];

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
    return this.revokeClient(opts);
  }

  async health() {
    return { ok: true, detail: `mock_clients=${this.clients.size}` };
  }
}
