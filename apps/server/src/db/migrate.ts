import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DatabaseSync } from 'node:sqlite';
import { RECYCLE_RETENTION_DAYS, RECYCLE_URGENT_DAYS } from '@classroom-desk/shared';
import { newId, nowIso } from '../utils/id.js';
import { openDb, withTransaction } from './client.js';

const DEFAULT_SETTINGS: Record<string, string> = {
  point_request_ttl_minutes: '60',
  point_request_daily_cleanup_time: '02:00',
  notice_text: '本工具由学校部署，用于答题、积分与留言。',
  attendance_notice_text: '签到仅记录本工具内的登录和在线状态。',
  messages_enabled: '1',
  /** Student single/bool: require separate「确认提交」before answer (1=on). */
  quiz_confirm_submit: '1',
  /** Minutes after class session startAt before projection auto read-only (0=off). */
  liveboard_readonly_after_minutes: '5',
  /** JSON string array of extra weak teacher passwords (merged with shared list). */
  weak_teacher_passwords_extra: '[]',
  teacher_password_ok: '0',
  last_auto_backup_at: '',
  server_bind: '0.0.0.0',
  schema_version: '1',
  /** Recycle retention days for soft-deleted students/questions (aligned with shared default). */
  recycle_retention_days: String(RECYCLE_RETENTION_DAYS),
  /** Highlight recycle rows when daysLeft ≤ this (inclusive). */
  recycle_urgent_days: String(RECYCLE_URGENT_DAYS),
  /** Optional AES passphrase for encrypted backup copies (empty = plain copy only). */
  backup_encrypt_passphrase: '',
  /** Public base for LAN upgrade cache (empty = derive from request host). */
  lan_upgrade_base: '',
  /** Projection high-contrast default for new projection sessions (0/1). */
  projection_high_contrast: '0',
  /** Minutes between fleet.drift_snapshot audit rows (0=off). Default 5. */
  fleet_drift_snapshot_minutes: '5',
  /** How many Setup*.exe to keep under /upgrades (1–20). */
  upgrades_keep_count: '3',
  /**
   * Teacher-controlled force same-version (0=off, 1=on). Default on for new installs.
   * When on + version drift: students cannot cancel; download LAN Setup and silent-install.
   * Uploading a new Setup.exe also turns this on. Teacher may turn off (teacher authority > student).
   * Never pulls public GitHub on lab PCs.
   */
  student_auto_update: '1',
  /**
   * Foolproof lab join: when 1, LAN students can GET /api/v1/classroom/join and
   * receive apiBase + classId for the teacher-selected class (no QR/USB).
   */
  student_easy_join: '0',
  /** classId published by easy join (empty = off even if student_easy_join=1). */
  student_easy_join_class_id: '',
  /**
   * BYOD / browser must use /portal; lab-agent (X-Cd-Client: lab-agent) still reads public roster.
   * Setup wizard recommends on; default seeded to 1.
   */
  private_device_portal_only: '1',
  /** Reject unsigned portal SSID (setup wizard / NetworkZones can flip). Env can still force on. */
  portal_ssid_require_sig: '0',
};

export function migrate(database?: DatabaseSync): DatabaseSync {
  const conn = database ?? openDb();
  const schemaPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  conn.exec(sql);
  ensureColumn(conn, 'users', 'student_no', 'TEXT');
  ensureColumn(conn, 'users', 'deleted_at', 'TEXT');
  ensureColumn(conn, 'users', 'disabled_at', 'TEXT');
  /** Per-user password-ok flag (assistants: first-login change); teachers also use settings.teacher_password_ok. */
  ensureColumn(conn, 'users', 'password_ok', 'INTEGER DEFAULT 0');
  ensureColumn(conn, 'users', 'net_ever_student_zone', 'INTEGER NOT NULL DEFAULT 0');
  /** Roster OTP delivery targets (portal challenge). */
  ensureColumn(conn, 'users', 'contact_email', 'TEXT');
  ensureColumn(conn, 'users', 'contact_phone', 'TEXT');
  ensureColumn(conn, 'questions', 'attachments', 'TEXT');
  ensureColumn(conn, 'questions', 'closed_at', 'TEXT');
  ensureColumn(conn, 'questions', 'closes_at', 'TEXT');
  ensureColumn(conn, 'questions', 'archived', 'INTEGER DEFAULT 0');
  ensureColumn(conn, 'questions', 'retry_wrong', 'INTEGER DEFAULT 0');
  ensureColumn(conn, 'questions', 'deleted_at', 'TEXT');
  ensureColumn(conn, 'messages', 'to_student_id', 'TEXT');
  ensureColumn(conn, 'messages', 'read_at', 'TEXT');
  ensureColumn(conn, 'presence_heartbeats', 'client_version', `TEXT NOT NULL DEFAULT ''`);
  ensureColumn(conn, 'presence_heartbeats', 'client_platform', `TEXT NOT NULL DEFAULT ''`);
  /** Stable per-machine id from student desktop (localStorage); used for seat-scoped input lock. */
  ensureColumn(conn, 'presence_heartbeats', 'client_id', `TEXT NOT NULL DEFAULT ''`);
  /** 1 when student reports Assigned Access / MDM hardening signal (see getKioskHardening). */
  ensureColumn(conn, 'presence_heartbeats', 'hardened', `INTEGER NOT NULL DEFAULT 0`);
  /** Optional Wi-Fi / LAN hint from lab-agent for school-defined network zones. */
  ensureColumn(conn, 'presence_heartbeats', 'net_ssid', `TEXT NOT NULL DEFAULT ''`);
  ensureColumn(conn, 'presence_heartbeats', 'net_ipv4', `TEXT NOT NULL DEFAULT ''`);
  ensureColumn(conn, 'presence_heartbeats', 'net_gateway', `TEXT NOT NULL DEFAULT ''`);
  ensureColumn(conn, 'presence_heartbeats', 'net_zone_id', `TEXT NOT NULL DEFAULT ''`);
  ensureColumn(conn, 'presence_heartbeats', 'net_zone_unauthorized', `INTEGER NOT NULL DEFAULT 0`);
  ensureColumn(conn, 'student_answers', 'is_makeup', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(conn, 'student_answers', 'queued_offline', 'INTEGER NOT NULL DEFAULT 0');
  conn.exec(`CREATE TABLE IF NOT EXISTS seat_map (
    id TEXT PRIMARY KEY,
    class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    row_index INTEGER NOT NULL,
    col_index INTEGER NOT NULL,
    label TEXT NOT NULL DEFAULT '',
    student_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    UNIQUE(class_id, row_index, col_index)
  )`);
  conn.exec(`CREATE INDEX IF NOT EXISTS idx_seat_map_class ON seat_map(class_id)`);
  // One student → at most one seat per class (NULLs allowed multiple times).
  conn.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_seat_map_class_student
     ON seat_map(class_id, student_id) WHERE student_id IS NOT NULL`,
  );
  conn.exec(`CREATE TABLE IF NOT EXISTS parent_report_tokens (
    id TEXT PRIMARY KEY,
    class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    month TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    created_by TEXT,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`);
  conn.exec(`CREATE INDEX IF NOT EXISTS idx_parent_report_token ON parent_report_tokens(token)`);
  conn.exec(`CREATE TABLE IF NOT EXISTS assistant_class_grants (
    assistant_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    can_export INTEGER NOT NULL DEFAULT 1,
    can_award_points INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (assistant_id, class_id)
  )`);
  conn.exec(`CREATE TABLE IF NOT EXISTS buzz_rounds (
    id TEXT PRIMARY KEY,
    class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'open',
    opened_at TEXT NOT NULL,
    closed_at TEXT,
    winner_student_id TEXT,
    reason TEXT NOT NULL DEFAULT '抢答'
  )`);
  conn.exec(`CREATE TABLE IF NOT EXISTS buzz_hits (
    id TEXT PRIMARY KEY,
    round_id TEXT NOT NULL REFERENCES buzz_rounds(id) ON DELETE CASCADE,
    student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    hit_at TEXT NOT NULL,
    UNIQUE(round_id, student_id)
  )`);
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
  conn.exec(`CREATE INDEX IF NOT EXISTS idx_teacher_audit_action ON teacher_audit_log(action, created_at DESC)`);
  conn.exec(`CREATE TABLE IF NOT EXISTS session_kicks (
    student_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    reason TEXT NOT NULL DEFAULT 'soft_deleted',
    created_at TEXT NOT NULL
  )`);
  ensureAssistantRoleAllowed(conn);
  seedSettings(conn);
  backfillAssistantPasswordOk(conn);
  enableForceStudentVersionDefaultOnce(conn);
  alignLegacyRecycleRetention30to7(conn);
  return conn;
}

/** One-shot: turn on forced same-version for existing classrooms (teacher may still disable). */
function enableForceStudentVersionDefaultOnce(conn: DatabaseSync): void {
  if (getSetting(conn, 'student_force_version_default_v1') === '1') return;
  conn
    .prepare(
      `INSERT INTO settings (key, value) VALUES ('student_auto_update', '1')
       ON CONFLICT(key) DO UPDATE SET value = '1'`,
    )
    .run();
  conn
    .prepare(
      `INSERT INTO settings (key, value) VALUES ('student_force_version_default_v1', '1')
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run();
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

/**
 * One-shot: existing assistants are treated as already past first-login gate.
 * New assistants still INSERT with password_ok=0 after this flag is set.
 */
function backfillAssistantPasswordOk(conn: DatabaseSync): void {
  if (getSetting(conn, 'assistant_password_ok_backfill_v1') === '1') return;
  withTransaction(conn, () => {
    conn.prepare(`UPDATE users SET password_ok = 1 WHERE role = 'assistant'`).run();
    conn
      .prepare(
        `INSERT INTO settings (key, value) VALUES ('assistant_password_ok_backfill_v1', '1')
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run();
  });
}

/**
 * One-shot: early installs shipped recycle_retention_days=30; align to shared default 7.
 * Only rewrites exactly "30" (legacy default). Custom values (e.g. 14) are left alone.
 * Flag set even when current ≠ 30 so we never re-prompt or re-touch later.
 */
function alignLegacyRecycleRetention30to7(conn: DatabaseSync): void {
  if (getSetting(conn, 'recycle_retention_align_shared_v1') === '1') return;
  let migratedFrom: string | null = null;
  withTransaction(conn, () => {
    const cur = getSetting(conn, 'recycle_retention_days');
    if (cur === '30') {
      migratedFrom = '30';
      conn
        .prepare(
          `INSERT INTO settings (key, value) VALUES ('recycle_retention_days', ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        )
        .run(String(RECYCLE_RETENTION_DAYS));
    }
    conn
      .prepare(
        `INSERT INTO settings (key, value) VALUES ('recycle_retention_align_shared_v1', '1')
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run();
  });
  if (migratedFrom) {
    try {
      conn
        .prepare(
          `INSERT INTO teacher_audit_log
             (id, actor_user_id, actor_role, action, class_id, detail, client_ip, created_at)
           VALUES (?, NULL, 'system', 'ops.settings_migrate', NULL, ?, NULL, ?)`,
        )
        .run(
          newId(),
          JSON.stringify({
            key: 'recycle_retention_days',
            from: migratedFrom,
            to: String(RECYCLE_RETENTION_DAYS),
            flag: 'recycle_retention_align_shared_v1',
          }),
          nowIso(),
        );
    } catch {
      /* audit table may be mid-migrate; non-fatal */
    }
  }
}

export function getSetting(conn: DatabaseSync, key: string): string | null {
  const row = conn.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}