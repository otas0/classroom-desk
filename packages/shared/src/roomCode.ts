/**
 * Short room code for AP-isolation / cross-VLAN join when /24 TCP scan cannot
 * reach the teacher PC. Encodes IPv4 (+ checksum) so students type the code
 * projected by the teacher and decode to http://ip:8787 without LAN discovery.
 *
 * Alphabet: Crockford base32 (no I/L/O/U). Format: XXXX-XXXX (8 chars + dash).
 */

const ALPH = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function cleanCode(raw: string): string {
  return String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/[IL]/g, (c) => (c === 'O' ? '0' : '1'));
}

export function encodeRoomCode(ipv4: string): string | null {
  const parts = String(ipv4 ?? '')
    .trim()
    .split('.')
    .map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return null;
  }
  let n =
    ((parts[0]! << 24) >>> 0) + (parts[1]! << 16) + (parts[2]! << 8) + parts[3]!;
  let body = '';
  for (let i = 0; i < 7; i++) {
    body = ALPH[n % 32]! + body;
    n = Math.floor(n / 32);
  }
  const chk = (parts[0]! ^ parts[1]! ^ parts[2]! ^ parts[3]!) & 31;
  const full = body + ALPH[chk]!;
  return `${full.slice(0, 4)}-${full.slice(4)}`;
}

export function decodeRoomCode(raw: string): string | null {
  const code = cleanCode(raw);
  if (code.length !== 8) return null;
  let n = 0;
  for (let i = 0; i < 7; i++) {
    const idx = ALPH.indexOf(code[i]!);
    if (idx < 0) return null;
    n = n * 32 + idx;
  }
  const chkIdx = ALPH.indexOf(code[7]!);
  if (chkIdx < 0) return null;
  const a = (n >>> 24) & 255;
  const b = (n >>> 16) & 255;
  const c = (n >>> 8) & 255;
  const d = n & 255;
  if (((a ^ b ^ c ^ d) & 31) !== chkIdx) return null;
  return `${a}.${b}.${c}.${d}`;
}

export function roomCodeToApiBase(raw: string, port = 8787): string | null {
  const ip = decodeRoomCode(raw);
  if (!ip) return null;
  return `http://${ip}:${port}`;
}

/** True when text looks like a room code (not a URL / JSON). */
export function looksLikeRoomCode(raw: string): boolean {
  const code = cleanCode(raw);
  return code.length === 8 && /^[0-9A-Z]{8}$/.test(code);
}
