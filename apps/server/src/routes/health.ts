import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { getDataDir, getDbPath, openDb } from '../db/client.js';
import { getSetting } from '../db/migrate.js';

export const healthRouter = Router();

function latestBackupInfo(): { path: string | null; at: string | null; ageHours: number | null } {
  const backupDir = process.env.CLASSROOM_DESK_BACKUP_DIR
    ? path.resolve(process.env.CLASSROOM_DESK_BACKUP_DIR)
    : path.join(getDataDir(), 'backups');
  if (!fs.existsSync(backupDir)) {
    return { path: null, at: null, ageHours: null };
  }
  const files = fs
    .readdirSync(backupDir)
    .filter((name) => /^classroom-.*\.db$/.test(name))
    .map((name) => {
      const full = path.join(backupDir, name);
      const st = fs.statSync(full);
      return { full, mtime: st.mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
  const newest = files[0];
  if (!newest) return { path: null, at: null, ageHours: null };
  const at = new Date(newest.mtime).toISOString();
  const ageHours = Number(((Date.now() - newest.mtime) / 3_600_000).toFixed(2));
  return { path: newest.full, at, ageHours };
}

healthRouter.get('/health', (_req, res) => {
  const db = openDb();
  let dbOk = false;
  let tableCount = 0;

  try {
    const row = db.prepare(`SELECT COUNT(*) AS c FROM sqlite_master WHERE type = 'table'`).get() as {
      c: number;
    };
    tableCount = Number(row.c);
    db.prepare('SELECT 1 AS ok').get();
    dbOk = true;
  } catch {
    dbOk = false;
  }

  const backup = latestBackupInfo();
  const payload = {
    ok: dbOk,
    service: 'classroom-desk-server',
    version: '0.1.0',
    engine: 'node:sqlite',
    time: new Date().toISOString(),
    db: {
      ok: dbOk,
      path: getDbPath(),
      tableCount,
      schemaVersion: getSetting(db, 'schema_version'),
      pointRequestTtlMinutes: Number(getSetting(db, 'point_request_ttl_minutes') ?? 60),
      dailyCleanupTime: getSetting(db, 'point_request_daily_cleanup_time'),
    },
    backup: {
      latestPath: backup.path,
      latestAt: backup.at,
      ageHours: backup.ageHours,
    },
    lastCleanupAt: getSetting(db, 'last_cleanup_at'),
  };

  res.status(dbOk ? 200 : 503).json(payload);
});
