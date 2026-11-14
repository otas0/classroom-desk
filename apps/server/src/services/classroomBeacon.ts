/**
 * Lightweight LAN advertise (UDP broadcast) so students can find the teacher
 * without scanning a full /24 when the subnet allows broadcast.
 * Does not pierce AP/client isolation — use room code for that.
 */
import dgram from 'node:dgram';
import os from 'node:os';
import { config } from '../config.js';
import { openDb } from '../db/client.js';
import { orderedLanIpsForAdvertise } from './lanNetwork.js';
import { maxSecrecyAirgap } from './maxSecrecy.js';

export const CLASSROOM_BEACON_PORT = 8799;

let socket: dgram.Socket | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

function payload(): Buffer {
  const lanIps = orderedLanIpsForAdvertise(openDb()).slice(0, 4);
  return Buffer.from(
    JSON.stringify({
      s: 'classroom-desk',
      p: config.port,
      host: os.hostname(),
      lanIps: lanIps.slice(0, 4),
    }),
    'utf8',
  );
}

export function startClassroomBeacon(): void {
  if (socket) return;
  try {
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    sock.on('error', () => {
      /* ignore transient */
    });
    sock.bind(0, () => {
      try {
        sock.setBroadcast(true);
      } catch {
        /* some hosts disallow broadcast */
      }
      socket = sock;
      const tick = () => {
        if (!socket) return;
        try {
          if (maxSecrecyAirgap(openDb())) return;
        } catch {
          /* continue */
        }
        const buf = payload();
        try {
          socket.send(buf, CLASSROOM_BEACON_PORT, '255.255.255.255');
        } catch {
          /* ignore */
        }
      };
      tick();
      timer = setInterval(tick, 2000);
    });
  } catch (e) {
    console.warn('[classroom-beacon] start failed', e instanceof Error ? e.message : e);
  }
}

export function stopClassroomBeacon(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (socket) {
    try {
      socket.close();
    } catch {
      /* ignore */
    }
    socket = null;
  }
}
