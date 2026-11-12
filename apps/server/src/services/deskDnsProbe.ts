/**
 * Choose DeskDNS probe tool by platform / binary availability.
 * Linux prefers `ss`; macOS/BSD falls back to `lsof -iUDP:53`.
 */
export type DeskDnsProbeTool = 'ss' | 'lsof' | 'none';

export function preferDeskDnsProbeTool(opts: {
  platform?: string;
  hasSs?: boolean;
  hasLsof?: boolean;
}): DeskDnsProbeTool {
  const platform = opts.platform ?? process.platform;
  const hasSs = opts.hasSs ?? false;
  const hasLsof = opts.hasLsof ?? false;
  if (platform === 'darwin' || platform === 'freebsd') {
    return hasLsof ? 'lsof' : 'none';
  }
  if (hasSs) return 'ss';
  if (hasLsof) return 'lsof';
  return 'none';
}

export function parseLsofUdp53(stdout: string): boolean {
  const text = String(stdout ?? '');
  if (!text.trim()) return false;
  return /UDP.*:53\b|:53\b/i.test(text);
}

export type DeskDnsResolveProbe = {
  hostname: string;
  resolved: string[];
  pointsAtTeacher: boolean | null;
  teacherIps: string[];
  error?: string;
};

/** Best-effort: resolve a probe hostname and see if any A record matches teacher LAN IPs. */
export async function probeDeskDnsResolution(opts: {
  hostname: string;
  teacherIps: string[];
  resolve4?: (host: string) => Promise<string[]>;
}): Promise<DeskDnsResolveProbe> {
  const hostname = String(opts.hostname ?? '')
    .trim()
    .toLowerCase()
    .replace(/\.$/, '');
  const teacherIps = [...new Set((opts.teacherIps ?? []).map((ip) => String(ip).trim()).filter(Boolean))];
  const resolve4 = opts.resolve4 ?? ((h) => import('node:dns/promises').then((dns) => dns.resolve4(h)));
  if (!hostname) {
    return { hostname: '', resolved: [], pointsAtTeacher: null, teacherIps, error: 'hostname_required' };
  }
  try {
    const resolved = await resolve4(hostname);
    const pointsAtTeacher = teacherIps.length
      ? resolved.some((ip) => teacherIps.includes(ip))
      : null;
    return { hostname, resolved, pointsAtTeacher, teacherIps };
  } catch (e) {
    return {
      hostname,
      resolved: [],
      pointsAtTeacher: false,
      teacherIps,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
