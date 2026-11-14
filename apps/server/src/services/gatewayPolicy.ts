import type { DatabaseSync } from 'node:sqlite';
import { getDeskDnsResolveSnapshot } from './deskDns.js';
import { listGatewayAccess } from './gatewayAllowlist.js';

/**
 * Public LAN snapshot for openNDS / Exam Box (no JWT).
 * Same trust model as GET /api/v1/desk-dns/policy.
 */
export function getGatewayPolicySnapshot(db: DatabaseSync) {
  const snap = getDeskDnsResolveSnapshot(db);
  const items = listGatewayAccess(db).map((e) => ({
    clientKey: e.clientKey,
    ip: e.ip ?? null,
    mac: e.mac ?? null,
    studentId: e.studentId ?? null,
    classId: e.classId ?? null,
    expiresAt: e.expiresAt,
    updatedAt: e.updatedAt,
  }));
  const allowedIps = [
    ...new Set(
      items
        .map((e) => String(e.ip ?? '').trim())
        .filter((ip) => Boolean(ip) && ip !== 'null'),
    ),
  ];
  const epoch = items.reduce(
    (m, e) => Math.max(m, Number(e.expiresAt) || 0, Date.parse(e.updatedAt) || 0),
    0,
  );
  return {
    type: 'gateway_policy' as const,
    at: new Date().toISOString(),
    epoch,
    items,
    allowedIps,
    deepLock: snap.deepLock,
    portalHost: snap.portalHost,
    teacherApiHosts: snap.teacherApiHosts,
    blockedHosts: snap.blockedHosts,
  };
}
