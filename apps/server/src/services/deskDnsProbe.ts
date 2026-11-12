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
