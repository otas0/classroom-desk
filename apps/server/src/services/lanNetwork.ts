import os from 'node:os';
import type { DatabaseSync } from 'node:sqlite';
import { getSetting } from '../db/migrate.js';

export type LanInterface = {
  name: string;
  address: string;
  netmask?: string;
  mac?: string;
  internal: boolean;
};

export function listLanIpv4Interfaces(): LanInterface[] {
  const out: LanInterface[] = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const n of list ?? []) {
      if (String(n.family) !== 'IPv4') continue;
      out.push({
        name,
        address: n.address,
        netmask: n.netmask,
        mac: n.mac,
        internal: Boolean(n.internal),
      });
    }
  }
  return out;
}

/** Non-loopback IPv4 addresses, in OS order. */
export function listDetectedLanIpv4s(): string[] {
  return listLanIpv4Interfaces().filter((i) => !i.internal).map((i) => i.address);
}

/**
 * Teacher-selected advertise IP (`advertise_lan_ip`), else first detected LAN IPv4.
 */
export function resolveAdvertiseLanIp(db?: DatabaseSync): string {
  const detected = listDetectedLanIpv4s();
  if (db) {
    const configured = String(getSetting(db, 'advertise_lan_ip') ?? '').trim();
    if (configured) {
      if (detected.includes(configured)) return configured;
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(configured)) return configured;
    }
  }
  return detected[0] ?? '';
}

/** Primary advertise IP first, then other detected LAN IPs (for beacon / mDNS). */
export function orderedLanIpsForAdvertise(db: DatabaseSync): string[] {
  const detected = listDetectedLanIpv4s();
  const primary = resolveAdvertiseLanIp(db);
  if (!primary) return detected;
  return [primary, ...detected.filter((ip) => ip !== primary)];
}
