import type { DatabaseSync } from 'node:sqlite';

export function migrate(db: DatabaseSync): void {
  db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS departments (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      standard_minutes INTEGER NOT NULL DEFAULT 480,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL CHECK (role IN ('admin', 'manager', 'employee')),
      display_name TEXT NOT NULL,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      employee_no TEXT,
      department_id TEXT REFERENCES departments(id) ON DELETE SET NULL,
      disabled_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
    CREATE INDEX IF NOT EXISTS idx_users_department ON users(department_id);

    CREATE TABLE IF NOT EXISTS time_punches (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('clock_in', 'clock_out')),
      punched_at TEXT NOT NULL,
      work_date TEXT NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_punches_user_date ON time_punches(user_id, work_date);

    CREATE TABLE IF NOT EXISTS presence_heartbeats (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      work_date TEXT NOT NULL,
      beat_at TEXT NOT NULL,
      client_ip TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_presence_user_date ON presence_heartbeats(user_id, work_date);

    CREATE TABLE IF NOT EXISTS overtime_reviews (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      work_date TEXT NOT NULL,
      overtime_minutes INTEGER NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'rejected')),
      reviewer_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      reviewed_at TEXT,
      note TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(user_id, work_date)
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      actor_user_id TEXT,
      actor_role TEXT,
      action TEXT NOT NULL,
      detail TEXT,
      created_at TEXT NOT NULL
    );
  `);

  const row = db.prepare(`SELECT value FROM settings WHERE key = 'standard_minutes'`).get() as
    | { value: string }
    | undefined;
  if (!row) {
    db.prepare(`INSERT INTO settings (key, value) VALUES ('standard_minutes', '480')`).run();
  }
}
