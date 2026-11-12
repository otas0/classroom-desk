/**
 * Pull roster CSV/TSV from a configured HTTPS/HTTP URL and upsert students.
 * No fake names — empty URL = no-op. Failures are audited.
 */
import type { DatabaseSync } from 'node:sqlite';
import { getSetting } from '../db/migrate.js';
import { parseCsvToRows, type ImportRow } from './rosterParse.js';
import { writeAudit } from './audit.js';
import { newId, nowIso } from '../utils/id.js';

export type SisRosterDiffRow = {
  userId?: string;
  name: string;
  studentNo: string | null;
  prevName?: string;
  prevStudentNo?: string | null;
};

export type SisRosterDiff = {
  wouldAdd: SisRosterDiffRow[];
  wouldUpdate: SisRosterDiffRow[];
  wouldRemove: SisRosterDiffRow[];
};

export type SisSyncResult = {
  ok: boolean;
  dryRun?: boolean;
  classId?: string;
  fetched?: number;
  upserted?: number;
  removed?: number;
  skipped?: number;
  error?: string;
  diff?: SisRosterDiff;
};

export type SisRosterLastApplySnapshot = {
  at: string;
  classId: string;
  softDeleted: Array<{ id: string; displayName: string; studentNo: string | null }>;
  revertedUpdates: Array<{ id: string; displayName: string; studentNo: string | null }>;
  insertedIds: string[];
};

const SIS_LAST_APPLY_KEY = 'sis_roster_last_apply';

type ExistingStudent = {
  id: string;
  display_name: string;
  student_no: string | null;
};

function findExistingStudent(
  db: DatabaseSync,
  classId: string,
  row: ImportRow,
): ExistingStudent | undefined {
  const displayName = String(row.name ?? '').trim();
  const studentNo = row.studentNo ? String(row.studentNo).trim() : null;
  if (studentNo) {
    return db
      .prepare(
        `SELECT id, display_name, student_no FROM users WHERE class_id = ? AND student_no = ? AND role = 'student'
         AND (deleted_at IS NULL OR deleted_at = '')`,
      )
      .get(classId, studentNo) as ExistingStudent | undefined;
  }
  if (displayName) {
    return db
      .prepare(
        `SELECT id, display_name, student_no FROM users WHERE class_id = ? AND display_name = ? AND role = 'student'
         AND (deleted_at IS NULL OR deleted_at = '')`,
      )
      .get(classId, displayName) as ExistingStudent | undefined;
  }
  return undefined;
}

function listActiveClassStudents(db: DatabaseSync, classId: string): ExistingStudent[] {
  return db
    .prepare(
      `SELECT id, display_name, student_no FROM users
       WHERE class_id = ? AND role = 'student'
         AND (deleted_at IS NULL OR deleted_at = '')`,
    )
    .all(classId) as ExistingStudent[];
}

async function fetchSisCsv(url: string): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 20_000);
    const res = await fetch(url, { signal: ac.signal });
    clearTimeout(t);
    if (!res.ok) return { ok: false, error: `http_${res.status}` };
    const text = await res.text();
    return { ok: true, text };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'fetch_failed' };
  }
}

function computeSisDiff(db: DatabaseSync, classId: string, rows: ImportRow[]): SisRosterDiff {
  const wouldAdd: SisRosterDiffRow[] = [];
  const wouldUpdate: SisRosterDiffRow[] = [];
  const matchedIds = new Set<string>();

  for (const row of rows) {
    const displayName = String(row.name ?? '').trim();
    const studentNo = row.studentNo ? String(row.studentNo).trim() : null;
    if (!displayName) continue;
    const existing = findExistingStudent(db, classId, row);
    if (existing?.id) {
      matchedIds.add(existing.id);
      const nameChanged = existing.display_name !== displayName;
      const noChanged =
        (existing.student_no ?? null) !== studentNo && Boolean(studentNo || existing.student_no);
      if (nameChanged || noChanged) {
        wouldUpdate.push({
          userId: existing.id,
          name: displayName,
          studentNo,
          prevName: existing.display_name,
          prevStudentNo: existing.student_no,
        });
      }
    } else {
      wouldAdd.push({ name: displayName, studentNo });
    }
  }

  const wouldRemove: SisRosterDiffRow[] = [];
  for (const s of listActiveClassStudents(db, classId)) {
    if (!matchedIds.has(s.id)) {
      wouldRemove.push({
        userId: s.id,
        name: s.display_name,
        studentNo: s.student_no,
      });
    }
  }

  return { wouldAdd, wouldUpdate, wouldRemove };
}

export async function syncSisRosterOnce(
  db: DatabaseSync,
  opts?: { dryRun?: boolean },
): Promise<SisSyncResult> {
  const dryRun = opts?.dryRun === true;
  const url = String(getSetting(db, 'sis_roster_url') ?? '').trim();
  const classId = String(getSetting(db, 'sis_roster_class_id') ?? '').trim();
  if (!url) return { ok: true, dryRun, skipped: 0, error: 'sis_url_unset' };
  if (!classId) return { ok: false, dryRun, error: 'sis_class_required' };
  if (!/^https?:\/\//i.test(url)) return { ok: false, dryRun, error: 'sis_url_invalid' };

  const klass = db.prepare(`SELECT id FROM classes WHERE id = ?`).get(classId) as
    | { id?: string }
    | undefined;
  if (!klass?.id) return { ok: false, dryRun, error: 'class_not_found' };

  const fetched = await fetchSisCsv(url);
  if (!fetched.ok) return { ok: false, dryRun, classId, error: fetched.error };

  const rows = parseCsvToRows(fetched.text);
  if (!rows.length) {
    writeAudit({
      actorUserId: null,
      actorRole: 'system',
      action: 'sis.roster_sync',
      detail: { ok: false, classId, fetched: 0, reason: 'empty', dryRun },
    });
    return { ok: false, dryRun, classId, fetched: 0, error: 'empty_roster' };
  }

  const diff = computeSisDiff(db, classId, rows);

  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      classId,
      fetched: rows.length,
      diff,
    };
  }

  let upserted = 0;
  let removed = 0;
  const createdAt = nowIso();

  const snapshot: SisRosterLastApplySnapshot = {
    at: createdAt,
    classId,
    softDeleted: [],
    revertedUpdates: [],
    insertedIds: [],
  };

  for (const row of rows) {
    const displayName = String(row.name ?? '').trim();
    const studentNo = row.studentNo ? String(row.studentNo).trim() : null;
    if (!displayName) continue;
    const existing = findExistingStudent(db, classId, row);
    if (existing?.id) {
      const nameChanged = existing.display_name !== displayName;
      const noChanged =
        (existing.student_no ?? null) !== studentNo && Boolean(studentNo || existing.student_no);
      if (nameChanged || noChanged) {
        snapshot.revertedUpdates.push({
          id: existing.id,
          displayName: existing.display_name,
          studentNo: existing.student_no,
        });
      }
      db.prepare(
        `UPDATE users SET display_name = ?, student_no = COALESCE(?, student_no) WHERE id = ?`,
      ).run(displayName, studentNo, existing.id);
    } else {
      const newIdVal = newId();
      snapshot.insertedIds.push(newIdVal);
      db.prepare(
        `INSERT INTO users (id, display_name, student_no, role, class_id, total_points, created_at)
         VALUES (?, ?, ?, 'student', ?, 0, ?)`,
      ).run(newIdVal, displayName, studentNo, classId, createdAt);
    }
    upserted += 1;
  }

  const matchedIds = new Set<string>();
  for (const row of rows) {
    const existing = findExistingStudent(db, classId, row);
    if (existing?.id) matchedIds.add(existing.id);
  }
  for (const s of listActiveClassStudents(db, classId)) {
    if (!matchedIds.has(s.id)) {
      snapshot.softDeleted.push({
        id: s.id,
        displayName: s.display_name,
        studentNo: s.student_no,
      });
      db.prepare(`UPDATE users SET deleted_at = ? WHERE id = ?`).run(createdAt, s.id);
      removed += 1;
    }
  }

  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(SIS_LAST_APPLY_KEY, JSON.stringify(snapshot));

  db.prepare(
    `INSERT INTO settings (key, value) VALUES ('sis_roster_last_sync_at', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(createdAt);

  writeAudit({
    actorUserId: null,
    actorRole: 'system',
    action: 'sis.roster_sync',
    detail: { ok: true, classId, fetched: rows.length, upserted, removed, dryRun: false },
  });
  return {
    ok: true,
    dryRun: false,
    classId,
    fetched: rows.length,
    upserted,
    removed,
    diff,
  };
}

export function readSisRosterLastApplySnapshot(db: DatabaseSync): SisRosterLastApplySnapshot | null {
  const raw = String(getSetting(db, SIS_LAST_APPLY_KEY) ?? '').trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SisRosterLastApplySnapshot;
    if (!parsed?.classId || !parsed.at) return null;
    parsed.softDeleted = Array.isArray(parsed.softDeleted) ? parsed.softDeleted : [];
    parsed.revertedUpdates = Array.isArray(parsed.revertedUpdates) ? parsed.revertedUpdates : [];
    parsed.insertedIds = Array.isArray(parsed.insertedIds) ? parsed.insertedIds : [];
    return parsed;
  } catch {
    return null;
  }
}

export function undoSisRosterLastApply(
  db: DatabaseSync,
  opts?: { actorUserId?: string | null; actorRole?: string },
): { ok: boolean; error?: string; restored?: number; revertedFields?: number; removedInserts?: number } {
  const snap = readSisRosterLastApplySnapshot(db);
  if (!snap) return { ok: false, error: 'no_snapshot' };

  let restored = 0;
  let revertedFields = 0;
  let removedInserts = 0;

  for (const row of snap.softDeleted) {
    if (!row?.id) continue;
    const r = db
      .prepare(
        `UPDATE users SET deleted_at = NULL
         WHERE id = ? AND class_id = ? AND role = 'student'`,
      )
      .run(row.id, snap.classId);
    restored += Number(r.changes ?? 0);
  }

  for (const row of snap.revertedUpdates) {
    if (!row?.id) continue;
    const r = db
      .prepare(
        `UPDATE users SET display_name = ?, student_no = ?
         WHERE id = ? AND class_id = ? AND role = 'student'
           AND (deleted_at IS NULL OR deleted_at = '')`,
      )
      .run(row.displayName, row.studentNo, row.id, snap.classId);
    revertedFields += Number(r.changes ?? 0);
  }

  for (const id of snap.insertedIds) {
    if (!id) continue;
    const r = db
      .prepare(
        `UPDATE users SET deleted_at = ?
         WHERE id = ? AND class_id = ? AND role = 'student'
           AND (deleted_at IS NULL OR deleted_at = '')`,
      )
      .run(nowIso(), id, snap.classId);
    removedInserts += Number(r.changes ?? 0);
  }

  db.prepare(`DELETE FROM settings WHERE key = ?`).run(SIS_LAST_APPLY_KEY);

  writeAudit({
    actorUserId: opts?.actorUserId ?? null,
    actorRole: opts?.actorRole ?? 'teacher',
    action: 'sis.roster_undo',
    detail: {
      classId: snap.classId,
      snapshotAt: snap.at,
      restored,
      revertedFields,
      removedInserts,
    },
  });

  return { ok: true, restored, revertedFields, removedInserts };
}
