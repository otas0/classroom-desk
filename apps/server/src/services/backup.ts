import fs from 'node:fs';
import path from 'node:path';
import { getDataDir, getDbPath } from '../db/client.js';

function backupDirPath(): string {
  return process.env.CLASSROOM_DESK_BACKUP_DIR
    ? path.resolve(process.env.CLASSROOM_DESK_BACKUP_DIR)
    : path.join(getDataDir(), 'backups');
}

function keepCount(): number {
  const raw = Number(process.env.CLASSROOM_DESK_BACKUP_KEEP ?? process.env.CLASSROOM_DESK_BACKUP_KEEP_DAYS ?? 14);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 14;
}

function writeError(dir: string, message: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'last-error.json'),
    JSON.stringify({ at: new Date().toISOString(), message }),
    'utf8',
  );
}

function clearError(dir: string): void {
  const errFile = path.join(dir, 'last-error.json');
  if (fs.existsSync(errFile)) fs.unlinkSync(errFile);
}

function pruneOld(dir: string, keep: number): void {
  const files = fs
    .readdirSync(dir)
    .filter((name) => /^classroom-.*\.db$/.test(name))
    .map((name) => {
      const full = path.join(dir, name);
      return { full, mtime: fs.statSync(full).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
  for (const stale of files.slice(keep)) {
    try {
      fs.unlinkSync(stale.full);
      for (const suffix of ['-wal', '-shm']) {
        const side = `${stale.full}${suffix}`;
        if (fs.existsSync(side)) fs.unlinkSync(side);
      }
    } catch {
      /* ignore prune errors */
    }
  }
}

/** Copy classroom.db (+ WAL companions) into backups/, keep newest N files. */
export function runDbBackup(): { ok: boolean; path?: string; error?: string; kept: number } {
  const dir = backupDirPath();
  const keep = keepCount();
  fs.mkdirSync(dir, { recursive: true });
  const src = getDbPath();
  if (!fs.existsSync(src)) {
    const error = `no database at ${src}`;
    writeError(dir, error);
    return { ok: false, error, kept: keep };
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dest = path.join(dir, `classroom-${stamp}.db`);
  try {
    fs.copyFileSync(src, dest);
    for (const suffix of ['-wal', '-shm']) {
      const side = `${src}${suffix}`;
      if (fs.existsSync(side)) fs.copyFileSync(side, `${dest}${suffix}`);
    }
    pruneOld(dir, keep);
    clearError(dir);
    return { ok: true, path: dest, kept: keep };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    writeError(dir, error);
    return { ok: false, error, kept: keep };
  }
}

export function shouldRunDailyBackup(lastAtIso: string | null): boolean {
  if (!lastAtIso) return true;
  const last = Date.parse(lastAtIso);
  if (!Number.isFinite(last)) return true;
  // Once per local calendar day
  const a = new Date(last);
  const b = new Date();
  return (
    a.getFullYear() !== b.getFullYear() ||
    a.getMonth() !== b.getMonth() ||
    a.getDate() !== b.getDate()
  );
}
