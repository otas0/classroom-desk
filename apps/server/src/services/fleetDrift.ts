import { openDb } from '../db/client.js';
import { getSetting } from '../db/migrate.js';
import { packageVersion } from '../routes/health.js';
import { writeAudit } from './audit.js';
import { listPresenceClients } from './presenceHub.js';

export type FleetDriftSnapshot = {
  expectedVersion: string;
  onlineTotal: number;
  driftCount: number;
  driftRate: number;
  classCount: number;
  intervalMinutes: number;
  at: string;
};

/** Capture fleet version drift and write `fleet.drift_snapshot` audit. */
export function takeFleetDriftSnapshot(opts?: {
  intervalMinutes?: number;
  actorUserId?: string | null;
  actorRole?: string | null;
}): FleetDriftSnapshot {
  const db = openDb();
  const intervalMinutes =
    opts?.intervalMinutes ??
    Math.max(
      0,
      Math.min(1440, Math.trunc(Number(getSetting(db, 'fleet_drift_snapshot_minutes') ?? 5) || 0)),
    );
  const expected = packageVersion();
  const classes = db.prepare(`SELECT id FROM classes`).all() as Array<{ id: string }>;
  let onlineTotal = 0;
  let driftClients = 0;
  for (const c of classes) {
    const clients = listPresenceClients(c.id, 90_000);
    onlineTotal += clients.length;
    driftClients += clients.filter(
      (x) => x.clientVersion && expected && x.clientVersion !== expected,
    ).length;
  }
  const detail: FleetDriftSnapshot = {
    expectedVersion: expected,
    onlineTotal,
    driftCount: driftClients,
    driftRate: onlineTotal > 0 ? driftClients / onlineTotal : 0,
    classCount: classes.length,
    intervalMinutes,
    at: new Date().toISOString(),
  };
  writeAudit({
    actorUserId: opts?.actorUserId ?? null,
    actorRole: opts?.actorRole ?? 'system',
    action: 'fleet.drift_snapshot',
    detail,
  });
  return detail;
}
