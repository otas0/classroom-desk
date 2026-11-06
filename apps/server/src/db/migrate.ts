import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DatabaseSync } from 'node:sqlite';
import { openDb, withTransaction } from './client.js';

const DEFAULT_SETTINGS: Record<string, string> = {
  point_request_ttl_minutes: '60',
  point_request_daily_cleanup_time: '02:00',
  notice_text: '本工具由学校部署，用于答题、积分与留言。',
  attendance_notice_text: '签到仅记录本工具内的登录和在线状态。',
  messages_enabled: '1',
  server_bind: '0.0.0.0',
  schema_version: '1',
};

export function migrate(database?: DatabaseSync): DatabaseSync {
  const conn = database ?? openDb();
  const schemaPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  conn.exec(sql);
  ensureColumn(conn, 'users', 'student_no', 'TEXT');
  conn.exec(`CREATE INDEX IF NOT EXISTS idx_users_student_no ON users(class_id, student_no)`);
  seedSettings(conn);
  return conn;
}

function ensureColumn(
  conn: DatabaseSync,
  table: string,
  column: string,
  typeSql: string,
): void {
  const cols = conn.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (cols.some((c) => c.name === column)) return;
  conn.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${typeSql}`);
}

function seedSettings(conn: DatabaseSync): void {
  const insert = conn.prepare(
    `INSERT INTO settings (key, value) VALUES ($key, $value)
     ON CONFLICT(key) DO NOTHING`,
  );

  withTransaction(conn, () => {
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      insert.run({ key, value });
    }
  });
}

export function getSetting(conn: DatabaseSync, key: string): string | null {
  const row = conn.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}
