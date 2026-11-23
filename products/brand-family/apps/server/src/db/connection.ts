import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { migrate } from './migrate.js';

let db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (!db) throw new Error('database_not_open');
  return db;
}

export function openDb(dataDir: string): DatabaseSync {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'brand-family.db');
  db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  migrate(db);
  return db;
}
