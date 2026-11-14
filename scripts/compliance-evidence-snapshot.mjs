#!/usr/bin/env node
/** Internal helper for export-compliance-evidence.mjs — prints JSON reconcile+audit. */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!process.env.CLASSROOM_DESK_DATA_DIR) {
  process.env.CLASSROOM_DESK_DATA_DIR = path.join(root, 'tmp', 'compliance-data');
}

const { migrate } = await import('../apps/server/src/db/migrate.ts');
const { openDb } = await import('../apps/server/src/db/client.ts');
const { buildNetReconcileReport } = await import('../apps/server/src/services/netReconcile.ts');
const { resolveAuditRetentionDays, countAuditLog, listAudit } = await import(
  '../apps/server/src/services/audit.ts'
);

migrate();
const db = openDb();
const reconcile = buildNetReconcileReport(db, null);
const audit = {
  retentionDays: resolveAuditRetentionDays(db),
  rowCount: countAuditLog(db),
  sample: listAudit({ limit: 50 }),
};
process.stdout.write(JSON.stringify({ reconcile, audit }));
