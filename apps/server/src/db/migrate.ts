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
  /** Student single/bool: require separate「确认提交」before answer (1=on). */
  quiz_confirm_submit: '1',
  teacher_password_ok: '0',
  last_auto_backup_at: '',
  server_bind: '0.0.0.0',
  schema_version: '1',
};

export function migrate(database?: DatabaseSync): DatabaseSync {
  const conn = database ?? openDb();
  const schemaPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  conn.exec(sql);
  ensureColumn(conn, 'users', 'student_no', 'TEXT');
  ensureColumn(conn, 'users', 'deleted_at', 'TEXT');
  ensureColumn(conn, 'users', 'disabled_at', 'TEXT');
  ensureColumn(conn, 'questions', 'attachments', 'TEXT');
  ensureColumn(conn, 'questions', 'closed_at', 'TEXT');
  ensureColumn(conn, 'questions', 'closes_at', 'TEXT');
  ensureColumn(conn, 'questions', 'archived', 'INTEGER DEFAULT 0');
  ensureColumn(conn, 'questions', 'retry_wrong', 'INTEGER DEFAULT 0');
  ensureColumn(conn, 'questions', 'deleted_at', 'TEXT');
  ensureColumn(conn, 'messages', 'to_student_id', 'TEXT');
  ensureColumn(conn, 'messages', 'read_at', 'TEXT');
  conn.exec(`CREATE INDEX IF NOT EXISTS idx_users_student_no ON users(class_id, student_no)`);
  conn.exec(`CREATE INDEX IF NOT EXISTS idx_users_deleted ON users(class_id, deleted_at)`);
  conn.exec(`CREATE INDEX IF NOT EXISTS idx_messages_to_student ON messages(to_student_id, created_at)`);
  conn.exec(`CREATE INDEX IF NOT EXISTS idx_questions_closes ON questions(closes_at)`);
  conn.exec(`CREATE INDEX IF NOT EXISTS idx_questions_deleted ON questions(class_id, deleted_at)`);
  conn.exec(`CREATE TABLE IF NOT EXISTS exit_lock_events (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    actor_user_id TEXT,
    actor_role TEXT,
    detail TEXT NOT NULL DEFAULT '',
    client_ip TEXT,
    created_at TEXT NOT NULL
  )`);
  conn.exec(`CREATE INDEX IF NOT EXISTS idx_exit_lock_events_created ON exit_lock_events(created_at DESC)`);
  conn.exec(`CREATE TABLE IF NOT EXISTS teacher_audit_log (
    id TEXT PRIMARY KEY,
    actor_user_id TEXT,
    actor_role TEXT,
    action TEXT NOT NULL,
    class_id TEXT,
    detail TEXT NOT NULL DEFAULT '',
    client_ip TEXT,
    created_at TEXT NOT NULL
  )`);
  conn.exec(`CREATE INDEX IF NOT EXISTS idx_teacher_audit_created ON teacher_audit_log(created_at DESC)`);
  conn.exec(`CREATE INDEX IF NOT EXISTS idx_teacher_audit_class ON teacher_audit_log(class_id, created_at DESC)`);
  conn.exec(`CREATE TABLE IF NOT EXISTS session_kicks (
    student_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    reason TEXT NOT NULL DEFAULT 'soft_deleted',
    created_at TEXT NOT NULL
  )`);
  ensureAssistantRoleAllowed(conn);
  seedSettings(conn);
  return conn;
}

/** Expand users.role CHECK to include assistant (SQLite requires table rebuild). */
function ensureAssistantRoleAllowed(conn: DatabaseSync): void {
  const row = conn
    .prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'`)
    .get() as { sql: string } | undefined;
  if (!row?.sql || row.sql.includes("'assistant'")) return;

  conn.exec('PRAGMA foreign_keys = OFF');
  conn.exec('BEGIN');
  try {
    conn.exec(`
      CREATE TABLE users__role_mig (
        id TEXT PRIMARY KEY,
        role TEXT NOT NULL CHECK (role IN ('student', 'teacher', 'admin', 'assistant')),
        display_name TEXT NOT NULL,
        username TEXT UNIQUE,
        password_hash TEXT,
        student_no TEXT,
        class_id TEXT REFERENCES classes(id) ON DELETE SET NULL,
        total_points INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        deleted_at TEXT,
        disabled_at TEXT
      )`);
    conn.exec(`
      INSERT INTO users__role_mig
        (id, role, display_name, username, password_hash, student_no, class_id, total_points, created_at, deleted_at, disabled_at)
      SELECT id, role, display_name, username, password_hash, student_no, class_id, total_points, created_at, deleted_at,
             NULL
      FROM users`);
    conn.exec(`DROP TABLE users`);
    conn.exec(`ALTER TABLE users__role_mig RENAME TO users`);
    conn.exec(`CREATE INDEX IF NOT EXISTS idx_users_class_id ON users(class_id)`);
    conn.exec(`CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)`);
    conn.exec(`CREATE INDEX IF NOT EXISTS idx_users_student_no ON users(class_id, student_no)`);
    conn.exec(`CREATE INDEX IF NOT EXISTS idx_users_deleted ON users(class_id, deleted_at)`);
    conn.exec('COMMIT');
  } catch (e) {
    conn.exec('ROLLBACK');
    throw e;
  } finally {
    conn.exec('PRAGMA foreign_keys = ON');
  }
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
