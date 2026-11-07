PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS classes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  class_code TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
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
);

CREATE INDEX IF NOT EXISTS idx_users_class_id ON users(class_id);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

CREATE TABLE IF NOT EXISTS assignments (
  id TEXT PRIMARY KEY,
  class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  due_at TEXT,
  attachment_url TEXT,
  max_points INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed'))
);

CREATE INDEX IF NOT EXISTS idx_assignments_class_due ON assignments(class_id, due_at);

CREATE TABLE IF NOT EXISTS assignment_submissions (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'submitted', 'approved', 'rejected')),
  note TEXT NOT NULL DEFAULT '',
  submitted_at TEXT,
  reviewed_at TEXT,
  reviewed_by TEXT REFERENCES users(id),
  UNIQUE (assignment_id, student_id)
);

CREATE TABLE IF NOT EXISTS points_log (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  points INTEGER NOT NULL,
  reason_summary TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL CHECK (source IN ('request', 'manual', 'auto_rule')),
  request_id TEXT,
  mode TEXT NOT NULL DEFAULT 'manual' CHECK (mode IN ('auto', 'manual')),
  created_by TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE
);

CREATE INDEX IF NOT EXISTS idx_points_log_student_created ON points_log(student_id, created_at);
CREATE INDEX IF NOT EXISTS idx_points_log_class_created ON points_log(class_id, created_at);
CREATE INDEX IF NOT EXISTS idx_points_log_source ON points_log(source, mode, created_at);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_student_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  read_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_messages_class_created ON messages(class_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_student_created ON messages(student_id, created_at);
-- idx_messages_to_student created in migrate.ts after ensureColumn (existing DBs)

CREATE TABLE IF NOT EXISTS message_replies (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  teacher_id TEXT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  read_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_message_replies_message ON message_replies(message_id);

CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY,
  class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  stem TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('single', 'multi', 'bool', 'blank')),
  answer_key TEXT,
  points INTEGER NOT NULL DEFAULT 1,
  attachments TEXT,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  published INTEGER NOT NULL DEFAULT 0,
  closed_at TEXT,
  closes_at TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  retry_wrong INTEGER NOT NULL DEFAULT 0,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_questions_class_created ON questions(class_id, created_at);

CREATE TABLE IF NOT EXISTS question_options (
  id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  content TEXT NOT NULL,
  is_correct INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_question_options_question ON question_options(question_id);

CREATE TABLE IF NOT EXISTS student_answers (
  id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  answer_payload TEXT NOT NULL,
  is_correct INTEGER NOT NULL DEFAULT 0,
  answered_at TEXT NOT NULL,
  is_makeup INTEGER NOT NULL DEFAULT 0,
  queued_offline INTEGER NOT NULL DEFAULT 0,
  UNIQUE (question_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_student_answers_question_correct ON student_answers(question_id, is_correct);
CREATE INDEX IF NOT EXISTS idx_student_answers_student ON student_answers(student_id);

CREATE TABLE IF NOT EXISTS error_stats (
  question_id TEXT PRIMARY KEY REFERENCES questions(id) ON DELETE CASCADE,
  answered_count INTEGER NOT NULL DEFAULT 0,
  wrong_count INTEGER NOT NULL DEFAULT 0,
  error_rate REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attendance_sessions (
  id TEXT PRIMARY KEY,
  class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('auto', 'manual')),
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  late_after_minutes INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_attendance_sessions_class ON attendance_sessions(class_id, start_at);

CREATE TABLE IF NOT EXISTS attendance_records (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('present', 'late', 'absent', 'leave')),
  checked_at TEXT,
  source TEXT NOT NULL CHECK (source IN ('auto', 'manual', 'teacher')),
  remark TEXT NOT NULL DEFAULT '',
  updated_by TEXT REFERENCES users(id),
  updated_at TEXT,
  UNIQUE (session_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_attendance_records_student ON attendance_records(student_id);

CREATE TABLE IF NOT EXISTS point_requests (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  reason TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'rejected', 'expired')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  confirmed_by TEXT REFERENCES users(id),
  confirmed_at TEXT,
  points INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_point_requests_pending ON point_requests(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_point_requests_class ON point_requests(class_id, created_at);

CREATE TABLE IF NOT EXISTS presence_heartbeats (
  student_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  last_seen_at TEXT NOT NULL,
  client_version TEXT NOT NULL DEFAULT '',
  client_platform TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS session_kicks (
  student_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL DEFAULT 'soft_deleted',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cleanup_stats (
  id TEXT PRIMARY KEY,
  cleanup_date TEXT NOT NULL,
  removed_count INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL CHECK (kind IN ('expired', 'daily')),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cleanup_stats_date ON cleanup_stats(cleanup_date);

CREATE TABLE IF NOT EXISTS exit_lock_events (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  actor_user_id TEXT,
  actor_role TEXT,
  detail TEXT NOT NULL DEFAULT '',
  client_ip TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_exit_lock_events_created ON exit_lock_events(created_at DESC);

CREATE TABLE IF NOT EXISTS teacher_audit_log (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT,
  actor_role TEXT,
  action TEXT NOT NULL,
  class_id TEXT,
  detail TEXT NOT NULL DEFAULT '',
  client_ip TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_teacher_audit_created ON teacher_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_teacher_audit_class ON teacher_audit_log(class_id, created_at DESC);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attendance_schedules (
  id TEXT PRIMARY KEY,
  class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  weekdays TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  late_after_minutes INTEGER NOT NULL DEFAULT 5,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_attendance_schedules_class ON attendance_schedules(class_id, enabled);

CREATE TABLE IF NOT EXISTS attendance_holidays (
  id TEXT PRIMARY KEY,
  class_id TEXT REFERENCES classes(id) ON DELETE CASCADE,
  holiday_date TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE (class_id, holiday_date)
);

CREATE INDEX IF NOT EXISTS idx_attendance_holidays_date ON attendance_holidays(holiday_date);

CREATE TABLE IF NOT EXISTS seat_map (
  id TEXT PRIMARY KEY,
  class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  row_index INTEGER NOT NULL,
  col_index INTEGER NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  student_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE(class_id, row_index, col_index)
);
CREATE INDEX IF NOT EXISTS idx_seat_map_class ON seat_map(class_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_seat_map_class_student
  ON seat_map(class_id, student_id) WHERE student_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS parent_report_tokens (
  id TEXT PRIMARY KEY,
  class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  created_by TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_parent_report_token ON parent_report_tokens(token);

CREATE TABLE IF NOT EXISTS assistant_class_grants (
  assistant_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  can_export INTEGER NOT NULL DEFAULT 1,
  can_award_points INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (assistant_id, class_id)
);

CREATE TABLE IF NOT EXISTS buzz_rounds (
  id TEXT PRIMARY KEY,
  class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'open',
  opened_at TEXT NOT NULL,
  closed_at TEXT,
  winner_student_id TEXT,
  reason TEXT NOT NULL DEFAULT '抢答'
);

CREATE TABLE IF NOT EXISTS buzz_hits (
  id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL REFERENCES buzz_rounds(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hit_at TEXT NOT NULL,
  UNIQUE(round_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_teacher_audit_action ON teacher_audit_log(action, created_at DESC);
