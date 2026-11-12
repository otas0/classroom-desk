import { Router } from 'express';
import { openDb } from '../db/client.js';
import { requireAuth, requireRoles, type AuthedRequest } from '../middleware/auth.js';
import { listPresenceClients } from '../services/presenceHub.js';
import { addSeatBindSseClient, broadcastSeatBind } from '../services/seatBindHub.js';
import { newId } from '../utils/id.js';

export const seatsRouter = Router();

/** Student SSE: seat rebind without waiting for /auth/me poll. Optional ?classId=. */
seatsRouter.get('/api/v1/seat-bind/stream', (req, res) => {
  const classId = String(req.query.classId ?? '').trim() || undefined;
  addSeatBindSseClient(res, classId);
});

const ONLINE_MS = 90_000;

seatsRouter.get(
  '/api/v1/classes/:id/seats',
  requireAuth,
  requireRoles('teacher', 'admin', 'assistant'),
  (req: AuthedRequest, res) => {
    const classId = String(req.params.id);
    const db = openDb();
    const seats = db
      .prepare(
        `SELECT s.id, s.row_index AS rowIndex, s.col_index AS colIndex, s.label,
                COALESCE(s.hostname, '') AS hostname,
                s.student_id AS studentId,
                u.display_name AS displayName, u.student_no AS studentNo
         FROM seat_map s
         LEFT JOIN users u ON u.id = s.student_id
         WHERE s.class_id = ?
         ORDER BY s.row_index, s.col_index`,
      )
      .all(classId) as Array<{
      id: string;
      rowIndex: number;
      colIndex: number;
      label: string;
      hostname: string;
      studentId: string | null;
      displayName: string | null;
      studentNo: string | null;
    }>;
    const presence = listPresenceClients(classId, ONLINE_MS);
    const onlineStudents = new Set(presence.map((c) => c.studentId));
    const onlineClients = new Set(
      presence.map((c) => String(c.clientId ?? '').trim().toLowerCase()).filter(Boolean),
    );
    const items = seats.map((s) => {
      const hostKey = String(s.hostname ?? '').trim().toLowerCase();
      const machineOnline = hostKey ? onlineClients.has(hostKey) : false;
      const studentOnline = Boolean(s.studentId && onlineStudents.has(s.studentId));
      return {
        ...s,
        online: studentOnline,
        machineOnline,
        absent: Boolean(s.studentId && !studentOnline),
      };
    });
    const maxRow = items.reduce((m, s) => Math.max(m, s.rowIndex), -1);
    const maxCol = items.reduce((m, s) => Math.max(m, s.colIndex), -1);
    res.json({
      classId,
      rows: maxRow + 1,
      cols: maxCol + 1,
      onlineCount: onlineStudents.size,
      offlineBound: items.filter((s) => s.studentId && !s.online).length,
      items,
    });
  },
);

/** Replace / expand grid. Body: { rows, cols } or { seats: [{rowIndex,colIndex,label?,studentId?}] } */
seatsRouter.put(
  '/api/v1/classes/:id/seats',
  requireAuth,
  requireRoles('teacher', 'admin'),
  (req: AuthedRequest, res) => {
    const classId = String(req.params.id);
    const db = openDb();
    if (!db.prepare(`SELECT id FROM classes WHERE id = ?`).get(classId)) {
      res.status(404).json({ error: 'class_not_found' });
      return;
    }

    if (Array.isArray(req.body?.seats)) {
      const seats = req.body.seats as Array<{
        rowIndex: number;
        colIndex: number;
        label?: string;
        hostname?: string;
        studentId?: string | null;
      }>;
      db.prepare(`DELETE FROM seat_map WHERE class_id = ?`).run(classId);
      const ins = db.prepare(
        `INSERT INTO seat_map (id, class_id, row_index, col_index, label, hostname, student_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const s of seats) {
        const r = Math.trunc(Number(s.rowIndex));
        const c = Math.trunc(Number(s.colIndex));
        if (!Number.isFinite(r) || !Number.isFinite(c) || r < 0 || c < 0 || r > 40 || c > 40) continue;
        ins.run(
          newId(),
          classId,
          r,
          c,
          String(s.label ?? `${r + 1}-${c + 1}`).slice(0, 32),
          String(s.hostname ?? '').trim().slice(0, 64),
          s.studentId ? String(s.studentId) : null,
        );
      }
    } else {
      const rows = Math.min(40, Math.max(1, Math.trunc(Number(req.body?.rows ?? 5))));
      const cols = Math.min(40, Math.max(1, Math.trunc(Number(req.body?.cols ?? 6))));
      const existing = db
        .prepare(
          `SELECT row_index AS r, col_index AS c, student_id AS studentId, label,
                  COALESCE(hostname, '') AS hostname
           FROM seat_map WHERE class_id = ?`,
        )
        .all(classId) as Array<{
        r: number;
        c: number;
        studentId: string | null;
        label: string;
        hostname: string;
      }>;
      const keep = new Map(existing.map((e) => [`${e.r},${e.c}`, e]));
      db.prepare(`DELETE FROM seat_map WHERE class_id = ?`).run(classId);
      const ins = db.prepare(
        `INSERT INTO seat_map (id, class_id, row_index, col_index, label, hostname, student_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const prev = keep.get(`${r},${c}`);
          ins.run(
            newId(),
            classId,
            r,
            c,
            prev?.label || `${r + 1}-${c + 1}`,
            prev?.hostname ?? '',
            prev?.studentId ?? null,
          );
        }
      }
    }
    try {
      broadcastSeatBind({ classId, changes: [], reloadAll: true });
    } catch {
      /* ignore */
    }
    res.json({ ok: true });
  },
);

/** Swap two seats' student bindings. */
seatsRouter.post(
  '/api/v1/classes/:id/seats/swap',
  requireAuth,
  requireRoles('teacher', 'admin'),
  (req: AuthedRequest, res) => {
    const classId = String(req.params.id);
    const a = String(req.body?.seatIdA ?? '').trim();
    const b = String(req.body?.seatIdB ?? '').trim();
    if (!a || !b || a === b) {
      res.status(400).json({ error: 'two_seat_ids_required' });
      return;
    }
    const db = openDb();
    const sa = db
      .prepare(`SELECT id, student_id AS studentId FROM seat_map WHERE id = ? AND class_id = ?`)
      .get(a, classId) as { id: string; studentId: string | null } | undefined;
    const sb = db
      .prepare(`SELECT id, student_id AS studentId FROM seat_map WHERE id = ? AND class_id = ?`)
      .get(b, classId) as { id: string; studentId: string | null } | undefined;
    if (!sa || !sb) {
      res.status(404).json({ error: 'seat_not_found' });
      return;
    }
    db.prepare(`UPDATE seat_map SET student_id = ? WHERE id = ?`).run(sb.studentId, sa.id);
    db.prepare(`UPDATE seat_map SET student_id = ? WHERE id = ?`).run(sa.studentId, sb.id);
    const changes: Array<{ studentId: string; seat: { id: string; label: string } | null }> = [];
    for (const row of [
      db.prepare(`SELECT id, label, student_id AS studentId FROM seat_map WHERE id = ?`).get(sa.id) as
        | { id: string; label: string; studentId: string | null }
        | undefined,
      db.prepare(`SELECT id, label, student_id AS studentId FROM seat_map WHERE id = ?`).get(sb.id) as
        | { id: string; label: string; studentId: string | null }
        | undefined,
    ]) {
      if (row?.studentId) {
        changes.push({ studentId: row.studentId, seat: { id: row.id, label: row.label } });
      }
    }
    try {
      broadcastSeatBind({ classId, changes, reloadAll: true });
    } catch {
      /* ignore */
    }
    res.json({ ok: true });
  },
);

/** Snake-fill seats by student_no ascending (row-major, alternate direction). */
seatsRouter.post(
  '/api/v1/classes/:id/seats/snake-fill',
  requireAuth,
  requireRoles('teacher', 'admin'),
  (req: AuthedRequest, res) => {
    const classId = String(req.params.id);
    const db = openDb();
    const seats = db
      .prepare(
        `SELECT id, row_index AS rowIndex, col_index AS colIndex FROM seat_map
         WHERE class_id = ? ORDER BY row_index, col_index`,
      )
      .all(classId) as Array<{ id: string; rowIndex: number; colIndex: number }>;
    if (!seats.length) {
      res.status(400).json({ error: 'no_seats', message: '请先生成座位网格' });
      return;
    }
    const students = db
      .prepare(
        `SELECT id FROM users WHERE role = 'student' AND class_id = ?
           AND (deleted_at IS NULL OR deleted_at = '')
         ORDER BY student_no COLLATE NOCASE, display_name COLLATE NOCASE`,
      )
      .all(classId) as Array<{ id: string }>;
    const maxRow = Math.max(...seats.map((s) => s.rowIndex));
    const ordered: typeof seats = [];
    for (let r = 0; r <= maxRow; r++) {
      const rowSeats = seats.filter((s) => s.rowIndex === r).sort((a, b) => a.colIndex - b.colIndex);
      if (r % 2 === 1) rowSeats.reverse();
      ordered.push(...rowSeats);
    }
    db.prepare(`UPDATE seat_map SET student_id = NULL WHERE class_id = ?`).run(classId);
    const upd = db.prepare(`UPDATE seat_map SET student_id = ? WHERE id = ?`);
    let n = 0;
    for (let i = 0; i < ordered.length && i < students.length; i++) {
      upd.run(students[i].id, ordered[i].id);
      n++;
    }
    try {
      broadcastSeatBind({ classId, changes: [], reloadAll: true });
    } catch {
      /* ignore */
    }
    res.json({ ok: true, seated: n, seats: ordered.length, roster: students.length });
  },
);

/** CSV body (text): header hostname,seatLabel — upserts seats by hostname; no student names. */
seatsRouter.post(
  '/api/v1/classes/:id/seats/import-csv',
  requireAuth,
  requireRoles('teacher', 'admin'),
  (req: AuthedRequest, res) => {
    const classId = String(req.params.id);
    const db = openDb();
    if (!db.prepare(`SELECT id FROM classes WHERE id = ?`).get(classId)) {
      res.status(404).json({ error: 'class_not_found' });
      return;
    }
    const raw = String(req.body?.csv ?? req.body?.text ?? (typeof req.body === 'string' ? req.body : '')).trim();
    if (!raw) {
      res.status(400).json({ error: 'csv_required' });
      return;
    }
    const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length) {
      res.status(400).json({ error: 'csv_empty' });
      return;
    }
  const startIdx = /^hostname/i.test(lines[0] ?? '') ? 1 : 0;
    const byHost = new Map(
      (
        db
          .prepare(`SELECT id, hostname FROM seat_map WHERE class_id = ? AND hostname != ''`)
          .all(classId) as Array<{ id: string; hostname: string }>
      ).map((r) => [r.hostname.toLowerCase(), r.id]),
    );
    const maxRow = db
      .prepare(`SELECT COALESCE(MAX(row_index), -1) AS m FROM seat_map WHERE class_id = ?`)
      .get(classId) as { m: number };
    let row = Math.max(0, Number(maxRow.m) + 1);
    let col = 0;
    let imported = 0;
    const ins = db.prepare(
      `INSERT INTO seat_map (id, class_id, row_index, col_index, label, hostname, student_id)
       VALUES (?, ?, ?, ?, ?, ?, NULL)`,
    );
    const upd = db.prepare(`UPDATE seat_map SET label = ? WHERE id = ?`);
    for (let i = startIdx; i < lines.length; i++) {
      const parts = lines[i]!.split(/,/).map((p) => p.trim());
      if (parts.length < 2) continue;
      const hostname = parts[0]!.slice(0, 64);
      const label = parts[1]!.slice(0, 32);
      if (!hostname || !label) continue;
      const key = hostname.toLowerCase();
      const existingId = byHost.get(key);
      if (existingId) {
        upd.run(label, existingId);
      } else {
        const id = newId();
        ins.run(id, classId, row, col, label, hostname);
        byHost.set(key, id);
        col += 1;
        if (col > 15) {
          col = 0;
          row += 1;
        }
      }
      imported += 1;
    }
    try {
      broadcastSeatBind({ classId, changes: [], reloadAll: true });
    } catch {
      /* ignore */
    }
    res.json({ ok: true, imported });
  },
);

seatsRouter.patch(
  '/api/v1/classes/:id/seats/:seatId',
  requireAuth,
  requireRoles('teacher', 'admin'),
  (req: AuthedRequest, res) => {
    const classId = String(req.params.id);
    const seatId = String(req.params.seatId);
    const db = openDb();
    const seat = db
      .prepare(`SELECT id FROM seat_map WHERE id = ? AND class_id = ?`)
      .get(seatId, classId);
    if (!seat) {
      res.status(404).json({ error: 'seat_not_found' });
      return;
    }
    if (req.body?.label != null) {
      db.prepare(`UPDATE seat_map SET label = ? WHERE id = ?`).run(String(req.body.label).slice(0, 32), seatId);
    }
    if (req.body?.hostname !== undefined) {
      db.prepare(`UPDATE seat_map SET hostname = ? WHERE id = ?`).run(
        String(req.body.hostname ?? '').trim().slice(0, 64),
        seatId,
      );
    }
    if (req.body?.studentId !== undefined) {
      const sid = req.body.studentId ? String(req.body.studentId) : null;
      let clearedFrom: { id: string; label: string } | null = null;
      const prevOccupant = db
        .prepare(`SELECT student_id AS studentId FROM seat_map WHERE id = ?`)
        .get(seatId) as { studentId: string | null } | undefined;
      const previousStudentId = prevOccupant?.studentId ? String(prevOccupant.studentId) : null;
      if (sid) {
        const stu = db
          .prepare(
            `SELECT id FROM users WHERE id = ? AND class_id = ? AND role = 'student'
               AND (deleted_at IS NULL OR deleted_at = '')`,
          )
          .get(sid, classId);
        if (!stu) {
          res.status(400).json({ error: 'invalid_student' });
          return;
        }
        const prev = db
          .prepare(
            `SELECT id, label FROM seat_map
             WHERE class_id = ? AND student_id = ? AND id != ?`,
          )
          .get(classId, sid, seatId) as { id: string; label: string } | undefined;
        if (prev) clearedFrom = prev;
        // One seat per student (also enforced by unique partial index)
        db.prepare(`UPDATE seat_map SET student_id = NULL WHERE class_id = ? AND student_id = ?`).run(
          classId,
          sid,
        );
      }
      try {
        db.prepare(`UPDATE seat_map SET student_id = ? WHERE id = ?`).run(sid, seatId);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/UNIQUE|unique/i.test(msg)) {
          res.status(409).json({
            error: 'student_already_seated',
            message: '该学生已绑定其它座位，请先清空或拖拽换座',
          });
          return;
        }
        throw e;
      }
      const seatRow = db
        .prepare(`SELECT id, label FROM seat_map WHERE id = ?`)
        .get(seatId) as { id: string; label: string };
      const changes: Array<{ studentId: string; seat: { id: string; label: string } | null }> = [];
      if (previousStudentId && previousStudentId !== sid) {
        changes.push({ studentId: previousStudentId, seat: null });
      }
      if (sid) {
        changes.push({
          studentId: sid,
          seat: { id: seatRow.id, label: seatRow.label },
        });
      }
      try {
        broadcastSeatBind({ classId, changes });
      } catch {
        /* ignore */
      }
      res.json({
        ok: true,
        clearedFromSeatId: clearedFrom?.id ?? null,
        clearedFromLabel: clearedFrom?.label ?? null,
        message: clearedFrom
          ? `已从座位 ${clearedFrom.label} 移开并绑到当前座（同班一人一座）`
          : undefined,
      });
      return;
    }
    res.json({ ok: true });
  },
);
