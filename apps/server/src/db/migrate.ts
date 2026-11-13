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
  /** Optional friendly label for join list, e.g. 高一3班讲台. */
  classroom_display_name: '',
  /** When 1: ending deep-lock / switching class clears student_easy_join. */
  student_easy_join_auto_off: '1',
  /** ISO time when easy-join was last turned on (TTL countdown). */
  student_easy_join_opened_at: '',
  /** Auto-off minutes after open; 0 = disabled. */
  student_easy_join_ttl_minutes: '0',
  /** When 1: open/close easy-join from attendance_schedules windows. */
  student_easy_join_follow_schedule: '0',
  /** When 1: attendance_schedules deep_lock_profile applies quiz/self-study patches. */
  deep_lock_follow_schedule: '0',
  /** JSON map profile name → partial DeepLockState (quiz, self-study, …). */
  deep_lock_schedule_profiles: JSON.stringify({
    quiz: {
      frozen: true,
      netMode: 'deny',
      killForeignBrowsers: true,
      killDistractions: true,
      focusFreeze: true,
    },
    'self-study': {
      frozen: false,
      netMode: 'allow',
      killForeignBrowsers: false,
      killDistractions: false,
      focusFreeze: false,
    },
  }),
  /** Hostname IT points at DeskDNS for DHCP clients (resolve probe). */
  deskdns_probe_hostname: '',
  /** Physical room id for room-mode join, e.g. 302. */
  classroom_room_id: '',
  /** IPv4 to encode in room code / mDNS / beacon when set; empty = auto. */
  advertise_lan_ip: '',
  /** Optional SIS CSV URL for roster sync. */
  sis_roster_url: '',
  sis_roster_class_id: '',
  sis_roster_last_sync_at: '',
  /** JSON snapshot for undo after last non–dry-run SIS apply. */
  sis_roster_last_apply: '',
  /** Minutes between SIS pulls; 0 = manual only. */
  sis_roster_interval_minutes: '0',
  /** Hint only: IT requires 802.1X on student SSID. */
  enterprise_8021x_required: '0',
  /** School IdP name (NPS / FreeRADIUS / …) — registry only, not a live RADIUS probe. */
  enterprise_8021x_idp: '',
  enterprise_8021x_staff_ssid: '',
  enterprise_8021x_staff_vlan: '',
  enterprise_8021x_student_ssid: '',
  enterprise_8021x_student_vlan: '',
  /** Exam Box first-unit acceptance (empty = not shipped). */
  exam_box_serial: '',
  exam_box_image_tag: '',
  exam_box_hardware_accepted: '0',
  exam_box_accepted_at: '',
  /**
   * Shield adapter: empty = follow env / off.
   * Values: off | http | opnsense | unifi
   */
  shield_adapter: '',
  shield_http_url: '',
  shield_http_token: '',
  /** DeskDNS: 1 = enable (or CLASSROOM_DESK_DNS=1). Port default 5353. */
  desk_dns_enabled: '0',
  desk_dns_port: '5353',
  /** Optional campus federation hub ingest URL (overrides env when set). */
  federation_hub_url: '',
  /** Bearer token for hub ingest (write-only in API GET). */
  federation_hub_token: '',
  /** Bcrypt hash of optional classroom join PIN (empty = off). */
  student_join_pin_hash: '',
  /** When 1: unknown deviceId must be teacher-approved before join attach. */
  student_join_require_approval: '0',
  /** When 1: roster students poll pull-join to auto-attach without LAN scan. */
  class_list_pull_enabled: '0',
  class_list_pull_class_id: '',
  /**
   * BYOD / browser must use /portal; lab-agent (X-Cd-Client: lab-agent) still reads public roster.
   * Setup wizard recommends on; default seeded to 1.
   */
  private_device_portal_only: '1',
  /** Reject unsigned portal SSID (setup wizard / NetworkZones can flip). Env can still force on. */
  portal_ssid_require_sig: '0',
  /** Recent portal admit blocks for teacher banner (JSON array). */
  portal_block_alerts: '[]',
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
  ensureColumn(conn, 'presence_heartbeats', 'client_arch', `TEXT NOT NULL DEFAULT ''`);
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
  ensureColumn(conn, 'seat_map', 'hostname', `TEXT NOT NULL DEFAULT ''`);
  ensureColumn(conn, 'attendance_schedules', 'deep_lock_profile', `TEXT NOT NULL DEFAULT ''`);
  ensureColumn(conn, 'presence_heartbeats', 'net_dns_servers', `TEXT NOT NULL DEFAULT ''`);
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
  conn.exec(`CREATE TABLE IF NOT EXISTS join_device_approvals (
    id TEXT PRIMARY KEY,
    device_id TEXT NOT NULL UNIQUE,
    hostname TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'denied')) DEFAULT 'pending',
    client_ip TEXT,
    created_at TEXT NOT NULL,
    decided_at TEXT,
    decided_by TEXT
  )`);
  conn.exec(
    `CREATE INDEX IF NOT EXISTS idx_join_device_approvals_status ON join_device_approvals(status, created_at)`,
  );
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