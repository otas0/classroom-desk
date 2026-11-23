import type { DatabaseSync } from 'node:sqlite';

export function migrate(db: DatabaseSync): void {
  db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      role TEXT NOT NULL CHECK (role IN ('parent')),
      display_name TEXT NOT NULL,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      disabled_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS children (
      id TEXT PRIMARY KEY,
      parent_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      display_name TEXT NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_children_parent ON children(parent_id);

    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      child_id TEXT NOT NULL REFERENCES children(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      platform TEXT NOT NULL CHECK (platform IN ('ios', 'android', 'windows', 'macos', 'other')),
      last_seen_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_devices_child ON devices(child_id);

    CREATE TABLE IF NOT EXISTS web_rules (
      id TEXT PRIMARY KEY,
      child_id TEXT NOT NULL REFERENCES children(id) ON DELETE CASCADE,
      domain TEXT NOT NULL,
      action TEXT NOT NULL CHECK (action IN ('allow', 'block')),
      created_at TEXT NOT NULL,
      UNIQUE(child_id, domain)
    );
    CREATE INDEX IF NOT EXISTS idx_web_rules_child ON web_rules(child_id);

    CREATE TABLE IF NOT EXISTS app_rules (
      id TEXT PRIMARY KEY,
      child_id TEXT NOT NULL REFERENCES children(id) ON DELETE CASCADE,
      app_id TEXT NOT NULL,
      app_label TEXT,
      action TEXT NOT NULL CHECK (action IN ('allow', 'block')),
      created_at TEXT NOT NULL,
      UNIQUE(child_id, app_id)
    );
    CREATE INDEX IF NOT EXISTS idx_app_rules_child ON app_rules(child_id);

    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      actor_user_id TEXT,
      actor_role TEXT,
      action TEXT NOT NULL,
      detail TEXT,
      created_at TEXT NOT NULL
    );
  `);
}
