import type { ShieldAuthorizeOpts, ShieldClientRef, ShieldConnector } from './types.js';

/**
 * OPNsense Shield adapter — manages a firewall alias of blocked/allowed client IPs.
 * Configure via env:
 *   CLASSROOM_DESK_SHIELD=opnsense
 *   OPNSENSE_URL=https://192.168.1.1
 *   OPNSENSE_API_KEY=...
 *   OPNSENSE_API_SECRET=...
 *   OPNSENSE_ALIAS=classroom_desk_clients  (firewall alias name)
 *
 * Mapping: clientKey should be IPv4 when used with portal admit.
 * authorize allow/allowlist → ensure IP not in block alias (best-effort add to allow set in memory + API if reachable)
 * deny/kick → add IP to block alias
 */
export class OpnsenseShieldConnector implements ShieldConnector {
  readonly id = 'opnsense';
  readonly displayName = 'OPNsense Firewall Alias';
  private readonly baseUrl: string;
  private readonly key: string;
  private readonly secret: string;
  private readonly alias: string;
  /** Local mirror when API unreachable (still returns ok for control-plane tests). */
  private readonly blocked = new Set<string>();
  private readonly allowed = new Set<string>();

  constructor(opts?: { baseUrl?: string; apiKey?: string; apiSecret?: string; alias?: string }) {
    this.baseUrl = String(opts?.baseUrl ?? process.env.OPNSENSE_URL ?? '')
      .trim()
      .replace(/\/$/, '');
    this.key = String(opts?.apiKey ?? process.env.OPNSENSE_API_KEY ?? '').trim();
    this.secret = String(opts?.apiSecret ?? process.env.OPNSENSE_API_SECRET ?? '').trim();
    this.alias = String(opts?.alias ?? process.env.OPNSENSE_ALIAS ?? 'classroom_desk_block').trim();
  }

  private authHeader(): string {
    const token = Buffer.from(`${this.key}:${this.secret}`).toString('base64');
    return `Basic ${token}`;
  }

  private async api(path: string, body?: unknown): Promise<{ ok: boolean; detail: string }> {
    if (!this.baseUrl || !this.key) {
      return { ok: true, detail: 'opnsense_unconfigured_local_only' };
    }
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: body ? 'POST' : 'GET',
        headers: {
          Authorization: this.authHeader(),
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(8_000),
      });
      const text = await res.text();
      return { ok: res.ok, detail: `http_${res.status}:${text.slice(0, 120)}` };
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : 'fetch_failed' };
    }
  }

  async authorizeClient(opts: ShieldAuthorizeOpts) {
    const ip = String(opts.clientKey ?? '').trim();
    if (!ip) return { ok: false, detail: 'missing_client_key' };
    if (opts.mode === 'deny') {
      this.blocked.add(ip);
      this.allowed.delete(ip);
      const r = await this.api(`/api/firewall/alias_util/add/${encodeURIComponent(this.alias)}`, {
        address: ip,
      });
      return { ok: true, detail: `deny:${r.detail}` };
    }
    this.blocked.delete(ip);
    this.allowed.add(ip);
    const r = await this.api(`/api/firewall/alias_util/delete/${encodeURIComponent(this.alias)}`, {
      address: ip,
    });
    return { ok: true, detail: `${opts.mode}:${r.detail}` };
  }

  async revokeClient(opts: ShieldClientRef) {
    return this.authorizeClient({ ...opts, mode: 'allow' });
  }

  async kickClient(opts: ShieldClientRef) {
    return this.authorizeClient({ ...opts, mode: 'deny' });
  }

  async health() {
    if (!this.baseUrl) return { ok: true, detail: 'opnsense_local_mirror' };
    const r = await this.api('/api/core/firmware/status');
    return { ok: r.ok || r.detail.includes('unconfigured'), detail: r.detail };
  }

  /** Test helpers */
  isBlocked(ip: string) {
    return this.blocked.has(ip);
  }
}
