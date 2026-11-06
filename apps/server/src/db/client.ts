import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

let db: DatabaseSync | null = null;

export function getDataDir(): string {
  const configured = process.env.CLASSROOM_DESK_DATA_DIR;
  if (configured) return path.resolve(configured);
  // Monorepo root (`npm run start:server` / node from repo root) → apps/server/data
  const fromRepoRoot = path.resolve(process.cwd(), 'apps/server/data');
  if (
    fs.existsSync(path.join(fromRepoRoot, 'classroom.db')) ||
    fs.existsSync(path.resolve(process.cwd(), 'apps/server/package.json'))
  ) {
    return fromRepoRoot;
  }
  // Started inside apps/server
  return path.resolve(process.cwd(), 'data');
}

export function getDbPath(): string {
  return path.join(getDataDir(), 'classroom.db');
}

export function openDb(): DatabaseSync {
  if (db) return db;

  const dataDir = getDataDir();
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(path.join(dataDir, 'uploads'), { recursive: true });

  db = new DatabaseSync(getDbPath());
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

export function withTransaction<T>(conn: DatabaseSync, fn: () => T): T {
  conn.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    conn.exec('COMMIT');
    return result;
  } catch (error) {
    conn.exec('ROLLBACK');
    throw error;
  }
}
