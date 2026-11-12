import { openDb } from '../db/client.js';
import { packageVersion } from '../routes/health.js';
import { listPresenceClients } from './presenceHub.js';
import { toCsv } from '../utils/csv.js';

const ONLINE_MS = 90_000;
const JOIN_AUDIT_ACTIONS = ['portal.admit.block', 'classroom.join_failure'] as const;

export function buildPrincipalOpsCsv(): string {
  const db = openDb();
  const expected = packageVersion();
  const at = new Date().toISOString();
  const classes = db
    .prepare(`SELECT id, name FROM classes ORDER BY name`)
    .all() as Array<{ id: string; name: string }>;
  const className = new Map(classes.map((c) => [c.id, c.name]));

  const headers = [
    'section',
    'exportedAt',
    'classId',
    'className',
    'studentId',
    'displayName',
    'studentNo',
    'clientVersion',
    'expectedVersion',
    'hardened',
    'seatLabel',
    'clientIp',
    'auditAction',
    'auditDetail',
    'auditAt',
  ];

  const rows: Array<Array<string | number | null | undefined>> = [];

  for (const c of classes) {
    const clients = listPresenceClients(c.id, ONLINE_MS);
    for (const cl of clients) {
      if (cl.clientVersion && expected && cl.clientVersion !== expected) {
        rows.push([
          'version_drift',
          at,
          c.id,
          className.get(c.id) ?? '',
          cl.studentId,
          cl.displayName,
          cl.studentNo ?? '',
          cl.clientVersion,
          expected,
          cl.hardened ? '1' : '0',
          cl.seatLabel ?? '',
          '',
          '',
          '',
          '',
        ]);
      }
      if (!cl.hardened) {
        rows.push([
          'unhardened',
          at,
          c.id,
          className.get(c.id) ?? '',
          cl.studentId,
          cl.displayName,
          cl.studentNo ?? '',
          cl.clientVersion,
          expected,
          '0',
          cl.seatLabel ?? '',
          '',
          '',
          '',
          '',
        ]);
      }
    }
  }

  const auditRows = db
    .prepare(
      `SELECT action, detail, class_id AS classId, client_ip AS clientIp, created_at AS createdAt
       FROM teacher_audit_log
       WHERE action IN (${JOIN_AUDIT_ACTIONS.map(() => '?').join(',')})
       ORDER BY created_at DESC
       LIMIT 500`,
    )
    .all(...JOIN_AUDIT_ACTIONS) as Array<{
    action: string;
    detail: string;
    classId: string | null;
    clientIp: string | null;
    createdAt: string;
  }>;

  for (const a of auditRows) {
    rows.push([
      'join_failure',
      at,
      a.classId ?? '',
      a.classId ? className.get(a.classId) ?? '' : '',
      '',
      '',
      '',
      '',
      expected,
      '',
      '',
      a.clientIp ?? '',
      a.action,
      a.detail,
      a.createdAt,
    ]);
  }

  return toCsv(headers, rows);
}
