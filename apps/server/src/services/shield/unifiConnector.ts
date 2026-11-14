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
 * Login paths (tried in order):
 *   1. /api/auth/login  — UniFi OS / UniFi Network Application (UDM, UCG, Cloud Key Gen2+)
 *   2. /api/login       — legacy controller
 *
 * Cookies: unifises / TOKEN; UniFi OS also needs X-CSRF-Token from TOKEN cookie.
 * clientKey: prefer MAC (aa:bb:...), else IP (best-effort local only).
 */
export class UnifiShieldConnector implements ShieldConnector {
  readonly id = 'unifi';
  readonly displayName = 'UniFi Controller';
  private readonly baseUrl: string;
  private readonly user: string;
  private readonly pass: string;
  private readonly site: string;
  private cookie = '';
  private csrf = '';
  private loginPathUsed = '';
  private readonly blocked = new Set<string>();

  constructor(opts?: { baseUrl?: string; user?: string; pass?: string; site?: string }) {
    this.baseUrl = String(opts?.baseUrl ?? process.env.UNIFI_URL ?? '')
      .trim()
      .replace(/\/$/, '');
    this.user = String(opts?.user ?? process.env.UNIFI_USER ?? '').trim();
    this.pass = String(opts?.pass ?? process.env.UNIFI_PASS ?? '').trim();
    this.site = String(opts?.site ?? process.env.UNIFI_SITE ?? 'default').trim();
  }

  private ingestCookies(res: Response) {
    const setCookie = res.headers.getSetCookie?.() ?? [];
    const parts: string[] = [];
    for (const c of setCookie) {
      const pair = c.split(';')[0]?.trim();
      if (pair) parts.push(pair);
      const m = /^TOKEN=([^;]+)/i.exec(pair ?? '');
      if (m?.[1]) this.csrf = decodeURIComponent(m[1]);
    }
    if (!parts.length) {
      const raw = res.headers.get('set-cookie');
      if (raw) {
        for (const chunk of raw.split(/,(?=\s*[^;=]+=)/)) {
          const pair = chunk.split(';')[0]?.trim();
          if (pair) parts.push(pair);
          const m = /^TOKEN=([^;]+)/i.exec(pair ?? '');
          if (m?.[1]) this.csrf = decodeURIComponent(m[1]);
        }
      }
    }
    if (parts.length) this.cookie = parts.join('; ');
    // Some UniFi OS builds put CSRF in a dedicated header.
    const hdr = res.headers.get('x-csrf-token') || res.headers.get('x-updated-csrf-token');
    if (hdr) this.csrf = hdr;
  }

  private async tryLogin(path: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: this.user, password: this.pass }),
        signal: AbortSignal.timeout(8_000),
      });
      this.ingestCookies(res);
      if (res.ok && this.cookie) {
        this.loginPathUsed = path;
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  private async login(): Promise<boolean> {
    if (!this.baseUrl || !this.user) return false;
    this.cookie = '';
    this.csrf = '';
    // UniFi OS first, then legacy controller.
    if (await this.tryLogin('/api/auth/login')) return true;
    if (await this.tryLogin('/api/login')) return true;
    // Some UniFi OS proxies under /proxy/network
    if (await this.tryLogin('/proxy/network/api/login')) return true;
    return false;
  }

  private async cmd(path: string, body: unknown): Promise<{ ok: boolean; detail: string }> {
    if (!this.baseUrl) return { ok: false, detail: 'unifi_unconfigured' };
    if (!this.cookie) await this.login();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Cookie: this.cookie,
    };
    if (this.csrf) headers['X-CSRF-Token'] = this.csrf;

    const tryOnce = async (p: string) => {
      const res = await fetch(`${this.baseUrl}${p}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8_000),
      });
      return res;
    };

    try {
      let res = await tryOnce(path);
      if (res.status === 401 || res.status === 403) {
        await this.login();
        headers.Cookie = this.cookie;
        if (this.csrf) headers['X-CSRF-Token'] = this.csrf;
        res = await tryOnce(path);
      }
      // UniFi OS network proxy fallback
      if (!res.ok && !path.startsWith('/proxy/')) {
        const alt = `/proxy/network${path}`;
        const res2 = await tryOnce(alt);
        if (res2.ok) return { ok: true, detail: `http_${res2.status}:proxy` };
      }
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
      if (!mac) return { ok: false, detail: 'deny:mac_required' };
      const r = await this.cmd(`/api/s/${this.site}/cmd/stamgr`, {
        cmd: 'block-sta',
        mac,
      });
      return { ok: r.ok, detail: `deny:${r.detail}` };
    }
    this.blocked.delete(key);
    if (!mac) return { ok: false, detail: `${opts.mode}:mac_required` };
    const r = await this.cmd(`/api/s/${this.site}/cmd/stamgr`, {
      cmd: 'unblock-sta',
      mac,
    });
    return { ok: r.ok, detail: `${opts.mode}:${r.detail}` };
  }

  async revokeClient(opts: ShieldClientRef) {
    return this.authorizeClient({ ...opts, mode: 'allow' });
  }

  async kickClient(opts: ShieldClientRef) {
    return this.authorizeClient({ ...opts, mode: 'deny' });
  }

  /** Lesson-end: unblock (clear admission session without re-adding to allowlists). */
  async releaseClient(opts: ShieldClientRef) {
    return this.authorizeClient({ ...opts, mode: 'allow' });
  }

  async health() {
    if (!this.baseUrl || !this.user) return { ok: false, detail: 'unifi_unconfigured' };
    const ok = await this.login();
    return {
      ok,
      detail: ok
        ? `unifi_login_ok:${this.loginPathUsed || 'unknown'}`
        : 'unifi_login_failed',
    };
  }

  /** Test helper */
  getLoginPathUsed() {
    return this.loginPathUsed;
  }
}
