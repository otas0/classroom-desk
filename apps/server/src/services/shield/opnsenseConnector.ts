import type { ShieldAuthorizeOpts, ShieldClientRef, ShieldConnector } from './types.js';

/**
 * OPNsense Shield adapter — dual alias: block list + allow list.
 * Env:
 *   CLASSROOM_DESK_SHIELD=opnsense
 *   OPNSENSE_URL=https://192.168.1.1
 *   OPNSENSE_API_KEY=...
 *   OPNSENSE_API_SECRET=...
 *   OPNSENSE_ALIAS=classroom_desk_block          (deny / kick)
 *   OPNSENSE_ALLOW_ALIAS=classroom_desk_allow    (allow / allowlist)
 *
 * Mapping: clientKey should be IPv4 when used with portal admit.
 * authorize allow/allowlist → add IP to allow alias, remove from block alias
 * deny/kick → add IP to block alias, remove from allow alias
 */
export class OpnsenseShieldConnector implements ShieldConnector {
  readonly id = 'opnsense';
  readonly displayName = 'OPNsense Firewall Alias';
  private readonly baseUrl: string;
  private readonly key: string;
  private readonly secret: string;
  private readonly blockAlias: string;
  private readonly allowAlias: string;
  /** Local mirror of last successful intent (API ok still required). */
  private readonly blocked = new Set<string>();
  private readonly allowed = new Set<string>();
  /** Last API paths hit (acceptance / diagnostics). */
  readonly lastApiCalls: string[] = [];

  constructor(opts?: {
    baseUrl?: string;
    apiKey?: string;
    apiSecret?: string;
    alias?: string;
    allowAlias?: string;
  }) {
    this.baseUrl = String(opts?.baseUrl ?? process.env.OPNSENSE_URL ?? '')
      .trim()
      .replace(/\/$/, '');
    this.key = String(opts?.apiKey ?? process.env.OPNSENSE_API_KEY ?? '').trim();
    this.secret = String(opts?.apiSecret ?? process.env.OPNSENSE_API_SECRET ?? '').trim();
    this.blockAlias = String(opts?.alias ?? process.env.OPNSENSE_ALIAS ?? 'classroom_desk_block').trim();
    this.allowAlias = String(
      opts?.allowAlias ?? process.env.OPNSENSE_ALLOW_ALIAS ?? 'classroom_desk_allow',
    ).trim();
  }

  private authHeader(): string {
    const token = Buffer.from(`${this.key}:${this.secret}`).toString('base64');
    return `Basic ${token}`;
  }

  private async api(path: string, body?: unknown): Promise<{ ok: boolean; detail: string }> {
    this.lastApiCalls.push(path);
    if (this.lastApiCalls.length > 40) this.lastApiCalls.shift();
    if (!this.baseUrl || !this.key) {
      return { ok: false, detail: 'opnsense_unconfigured' };
    }
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: body !== undefined ? 'POST' : 'GET',
        headers: {
          Authorization: this.authHeader(),
          'Content-Type': 'application/json',
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(8_000),
      });
      const text = await res.text();
      return { ok: res.ok, detail: `http_${res.status}:${text.slice(0, 120)}` };
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : 'fetch_failed' };
    }
  }

  private async aliasAdd(alias: string, address: string) {
    return this.api(`/api/firewall/alias_util/add/${encodeURIComponent(alias)}`, { address });
  }

  private async aliasDelete(alias: string, address: string) {
    return this.api(`/api/firewall/alias_util/delete/${encodeURIComponent(alias)}`, { address });
  }

  private async reconfigure(): Promise<{ ok: boolean; detail: string }> {
    return this.api('/api/firewall/alias/reconfigure', {});
  }

  private async aliasList(alias: string): Promise<{
    ok: boolean;
    members: string[];
    detail: string;
  }> {
    this.lastApiCalls.push(`/api/firewall/alias_util/list/${alias}`);
    if (this.lastApiCalls.length > 40) this.lastApiCalls.shift();
    if (!this.baseUrl || !this.key) {
      return { ok: false, members: [], detail: 'opnsense_unconfigured' };
    }
    try {
      const res = await fetch(
        `${this.baseUrl}/api/firewall/alias_util/list/${encodeURIComponent(alias)}`,
        {
          method: 'GET',
          headers: { Authorization: this.authHeader(), Accept: 'application/json' },
          signal: AbortSignal.timeout(8_000),
        },
      );
      const text = await res.text();
      if (!res.ok) {
        return { ok: false, members: [], detail: `http_${res.status}:${text.slice(0, 120)}` };
      }
      let parsed: unknown = {};
      try {
        parsed = JSON.parse(text);
      } catch {
        return { ok: false, members: [], detail: 'alias_list_bad_json' };
      }
      const obj = parsed as {
        addresses?: unknown;
        rows?: Array<{ address?: string }>;
        rows_addresses?: unknown;
      };
      const members: string[] = [];
      if (Array.isArray(obj.addresses)) {
        for (const a of obj.addresses) {
          const s = String(a ?? '').trim();
          if (s) members.push(s);
        }
      }
      if (Array.isArray(obj.rows)) {
        for (const row of obj.rows) {
          const s = String(row?.address ?? '').trim();
          if (s) members.push(s);
        }
      }
      return {
        ok: true,
        members: [...new Set(members)],
        detail: `http_${res.status};alias=${alias};n=${members.length}`,
      };
    } catch (e) {
      return {
        ok: false,
        members: [],
        detail: e instanceof Error ? e.message : 'fetch_failed',
      };
    }
  }

  async listFirewallMembers(kind: 'allow' | 'block') {
    const alias = kind === 'allow' ? this.allowAlias : this.blockAlias;
    const r = await this.aliasList(alias);
    return {
      ok: r.ok,
      members: r.members,
      detail: r.detail,
      remoteReadable: r.ok,
    };
  }

  async authorizeClient(opts: ShieldAuthorizeOpts) {
    const ip = String(opts.clientKey ?? '').trim();
    if (!ip) return { ok: false, detail: 'missing_client_key' };
    if (opts.mode === 'deny') {
      this.blocked.add(ip);
      this.allowed.delete(ip);
      const add = await this.aliasAdd(this.blockAlias, ip);
      const del = await this.aliasDelete(this.allowAlias, ip);
      const apply = await this.reconfigure();
      const ok = add.ok && del.ok && apply.ok;
      return {
        ok,
        detail: `deny:block=${add.detail};allow_rm=${del.detail};apply=${apply.detail}`,
      };
    }
    // allow | allowlist → write allow alias, clear block
    this.blocked.delete(ip);
    this.allowed.add(ip);
    const add = await this.aliasAdd(this.allowAlias, ip);
    const del = await this.aliasDelete(this.blockAlias, ip);
    const apply = await this.reconfigure();
    const ok = add.ok && del.ok && apply.ok;
    return {
      ok,
      detail: `${opts.mode}:allow=${add.detail};block_rm=${del.detail};apply=${apply.detail}`,
    };
  }

  async revokeClient(opts: ShieldClientRef) {
    return this.authorizeClient({ ...opts, mode: 'allow' });
  }

  async kickClient(opts: ShieldClientRef) {
    return this.authorizeClient({ ...opts, mode: 'deny' });
  }

  /** Lesson-end: remove IP from allow and block aliases (no lasting deny). */
  async releaseClient(opts: ShieldClientRef) {
    const ip = String(opts.clientKey ?? '').trim();
    if (!ip) return { ok: false, detail: 'missing_client_key' };
    this.blocked.delete(ip);
    this.allowed.delete(ip);
    const rmAllow = await this.aliasDelete(this.allowAlias, ip);
    const rmBlock = await this.aliasDelete(this.blockAlias, ip);
    const apply = await this.reconfigure();
    const ok = rmAllow.ok && rmBlock.ok && apply.ok;
    return {
      ok,
      detail: `release:allow_rm=${rmAllow.detail};block_rm=${rmBlock.detail};apply=${apply.detail}`,
    };
  }

  async health() {
    if (!this.baseUrl || !this.key) return { ok: false, detail: 'opnsense_unconfigured' };
    const r = await this.api('/api/core/firmware/status');
    return {
      ok: r.ok,
      detail: `${r.detail};block=${this.blockAlias};allow=${this.allowAlias}`,
    };
  }

  /** Test helpers */
  isBlocked(ip: string) {
    return this.blocked.has(ip);
  }

  isAllowed(ip: string) {
    return this.allowed.has(ip);
  }
}
