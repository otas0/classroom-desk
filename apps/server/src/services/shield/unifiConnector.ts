import type { ShieldAuthorizeOpts, ShieldClientRef, ShieldConnector } from './types.js';

/**
 * UniFi Network Shield adapter — block/unblock clients by MAC/IP via controller API.
 * Env:
 *   CLASSROOM_DESK_SHIELD=unifi
 *   UNIFI_URL=https://192.168.1.1
 *   UNIFI_USER=...
 *   UNIFI_PASS=...
 *   UNIFI_SITE=default
 *
 * clientKey: prefer MAC (aa:bb:...), else IP (best-effort).
 */
export class UnifiShieldConnector implements ShieldConnector {
  readonly id = 'unifi';
  readonly displayName = 'UniFi Controller';
  private readonly baseUrl: string;
  private readonly user: string;
  private readonly pass: string;
  private readonly site: string;
  private cookie = '';
  private readonly blocked = new Set<string>();

  constructor(opts?: { baseUrl?: string; user?: string; pass?: string; site?: string }) {
    this.baseUrl = String(opts?.baseUrl ?? process.env.UNIFI_URL ?? '')
      .trim()
      .replace(/\/$/, '');
    this.user = String(opts?.user ?? process.env.UNIFI_USER ?? '').trim();
    this.pass = String(opts?.pass ?? process.env.UNIFI_PASS ?? '').trim();
    this.site = String(opts?.site ?? process.env.UNIFI_SITE ?? 'default').trim();
  }

  private async login(): Promise<boolean> {
    if (!this.baseUrl || !this.user) return false;
    try {
      const res = await fetch(`${this.baseUrl}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: this.user, password: this.pass }),
        signal: AbortSignal.timeout(8_000),
      });
      const setCookie = res.headers.getSetCookie?.() ?? [];
      this.cookie = setCookie.map((c) => c.split(';')[0]).join('; ');
      if (!this.cookie) {
        const raw = res.headers.get('set-cookie');
        if (raw) this.cookie = raw.split(',').map((c) => c.split(';')[0]!.trim()).join('; ');
      }
      return res.ok;
    } catch {
      return false;
    }
  }

  private async cmd(path: string, body: unknown): Promise<{ ok: boolean; detail: string }> {
    if (!this.baseUrl) return { ok: true, detail: 'unifi_unconfigured_local_only' };
    if (!this.cookie) await this.login();
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: this.cookie,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8_000),
      });
      return { ok: res.ok, detail: `http_${res.status}` };
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : 'fetch_failed' };
    }
  }

  async authorizeClient(opts: ShieldAuthorizeOpts) {
    const key = String(opts.clientKey ?? '').trim();
    if (!key) return { ok: false, detail: 'missing_client_key' };
    const mac = /([0-9a-f]{2}[:-]){5}[0-9a-f]{2}/i.test(key) ? key : '';
    if (opts.mode === 'deny') {
      this.blocked.add(key);
      if (mac) {
        const r = await this.cmd(`/api/s/${this.site}/cmd/stamgr`, {
          cmd: 'block-sta',
          mac,
        });
        return { ok: true, detail: `deny:${r.detail}` };
      }
      return { ok: true, detail: 'deny:local_no_mac' };
    }
    this.blocked.delete(key);
    if (mac) {
      const r = await this.cmd(`/api/s/${this.site}/cmd/stamgr`, {
        cmd: 'unblock-sta',
        mac,
      });
      return { ok: true, detail: `${opts.mode}:${r.detail}` };
    }
    return { ok: true, detail: `${opts.mode}:local_no_mac` };
  }

  async revokeClient(opts: ShieldClientRef) {
    return this.authorizeClient({ ...opts, mode: 'allow' });
  }

  async kickClient(opts: ShieldClientRef) {
    return this.authorizeClient({ ...opts, mode: 'deny' });
  }

  async health() {
    if (!this.baseUrl) return { ok: true, detail: 'unifi_local_mirror' };
    const ok = await this.login();
    return { ok, detail: ok ? 'unifi_login_ok' : 'unifi_login_failed' };
  }
}
