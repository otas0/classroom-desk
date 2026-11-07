import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getDataDir, getDbPath, openDb } from '../db/client.js';
import { getSetting } from '../db/migrate.js';

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
export function runDbBackup(): {
  ok: boolean;
  path?: string;
  encryptedPath?: string;
  error?: string;
  kept: number;
} {
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
    const passphrase = (getSetting(openDb(), 'backup_encrypt_passphrase') ?? '').trim();
    let encryptedPath: string | undefined;
    if (passphrase) {
      encryptedPath = encryptFileAesGcm(dest, `${dest}.enc`, passphrase);
    }
    pruneOld(dir, keep);
    clearError(dir);
    return { ok: true, path: dest, encryptedPath, kept: keep };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    writeError(dir, error);
    return { ok: false, error, kept: keep };
  }
}

/** AES-256-GCM file: magic CDENC1 | iv(12) | tag(16) | ciphertext */
export function encryptFileAesGcm(src: string, dest: string, passphrase: string): string {
  const key = createHash('sha256').update(passphrase, 'utf8').digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plain = fs.readFileSync(src);
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  fs.writeFileSync(dest, Buffer.concat([Buffer.from('CDENC1'), iv, tag, enc]));
  return dest;
}

export function decryptFileAesGcm(src: string, dest: string, passphrase: string): string {
  const buf = fs.readFileSync(src);
  if (buf.subarray(0, 6).toString('utf8') !== 'CDENC1') {
    throw new Error('not_an_encrypted_backup');
  }
  const iv = buf.subarray(6, 18);
  const tag = buf.subarray(18, 34);
  const data = buf.subarray(34);
  const key = createHash('sha256').update(passphrase, 'utf8').digest();
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(data), decipher.final()]);
  fs.writeFileSync(dest, plain);
  return dest;
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

export type BackupStatus = {
  dir: string;
  keep: number;
  latestPath: string | null;
  latestAt: string | null;
  ageHours: number | null;
  lastError: { at?: string; message?: string } | null;
  lastAutoBackupAt: string | null;
};

/** Snapshot for teacher settings /health (no side effects). */
export function getBackupStatus(lastAutoBackupAt: string | null = null): BackupStatus {
  const dir = backupDirPath();
  const keep = keepCount();
  const errFile = path.join(dir, 'last-error.json');
  let lastError: BackupStatus['lastError'] = null;
  if (fs.existsSync(errFile)) {
    try {
      lastError = JSON.parse(fs.readFileSync(errFile, 'utf8')) as BackupStatus['lastError'];
    } catch {
      lastError = { message: 'unreadable last-error.json' };
    }
  }
  if (!fs.existsSync(dir)) {
    return {
      dir,
      keep,
      latestPath: null,
      latestAt: null,
      ageHours: null,
      lastError,
      lastAutoBackupAt,
    };
  }
  const files = fs
    .readdirSync(dir)
    .filter((name) => /^classroom-.*\.db$/.test(name))
    .map((name) => {
      const full = path.join(dir, name);
      return { full, mtime: fs.statSync(full).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
  const latest = files[0];
  if (!latest) {
    return {
      dir,
      keep,
      latestPath: null,
      latestAt: null,
      ageHours: null,
      lastError,
      lastAutoBackupAt,
    };
  }
  const latestAt = new Date(latest.mtime).toISOString();
  const ageHours = Math.round(((Date.now() - latest.mtime) / 3_600_000) * 10) / 10;
  return {
    dir,
    keep,
    latestPath: latest.full,
    latestAt,
    ageHours,
    lastError,
    lastAutoBackupAt,
  };
}
