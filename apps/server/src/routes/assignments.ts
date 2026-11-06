import { Router } from 'express';
import { openDb, withTransaction } from '../db/client.js';
import { requireAuth, requireRoles, type AuthedRequest } from '../middleware/auth.js';
import { addPoints } from '../services/points.js';
import { newId, nowIso } from '../utils/id.js';
import { paramId } from '../utils/params.js';

export const assignmentsRouter = Router();

assignmentsRouter.get('/api/v1/assignments', requireAuth, (req: AuthedRequest, res) => {
  const db = openDb();
  const classId = String(req.query.classId ?? req.user?.classId ?? '');
  if (!classId) {
    res.status(400).json({ error: 'class_id_required' });
    return;
  }
  if (req.user?.role === 'student' && req.user.classId !== classId) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }

  const items = db
    .prepare(
      `SELECT id, class_id AS classId, title, description, due_at AS dueAt, attachment_url AS attachmentUrl,
              max_points AS maxPoints, created_by AS createdBy, created_at AS createdAt, status
       FROM assignments WHERE class_id = ? ORDER BY created_at DESC`,
    )
    .all(classId);

  if (req.user?.role === 'student') {
    const withMine = items.map((item) => {
      const row = item as { id: string };
      const submission = db
        .prepare(
          `SELECT id, status, note, submitted_at AS submittedAt
           FROM assignment_submissions WHERE assignment_id = ? AND student_id = ?`,
        )
        .get(row.id, req.user!.id);
      return { ...item, mySubmission: submission ?? null };
    });
    res.json({ items: withMine });
    return;
  }

  const withPending = items.map((item) => {
    const row = item as { id: string };
    const pending = db
      .prepare(
        `SELECT COUNT(*) AS c FROM assignment_submissions
         WHERE assignment_id = ? AND status = 'submitted'`,
      )
      .get(row.id) as { c: number };
    return { ...item, pendingReviewCount: Number(pending.c) };
  });
  res.json({ items: withPending });
});

assignmentsRouter.post(
  '/api/v1/assignments',
  requireAuth,
  requireRoles('teacher', 'admin'),
  (req: AuthedRequest, res) => {
    const classId = String(req.body?.classId ?? '').trim();
    const title = String(req.body?.title ?? '').trim();
    if (!classId || !title) {
      res.status(400).json({ error: 'class_id_and_title_required' });
      return;
    }
    const id = newId();
    const createdAt = nowIso();
    openDb()
      .prepare(
        `INSERT INTO assignments
          (id, class_id, title, description, due_at, attachment_url, max_points, created_by, created_at, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open')`,
      )
      .run(
        id,
        classId,
        title,
        String(req.body?.description ?? ''),
        req.body?.dueAt ?? null,
        req.body?.attachmentUrl ?? null,
        Number(req.body?.maxPoints ?? 0),
        req.user!.id,
        createdAt,
      );
    res.status(201).json({ id, createdAt });
  },
);

assignmentsRouter.post('/api/v1/assignments/:id/submit', requireAuth, requireRoles('student'), (req: AuthedRequest, res) => {
  const db = openDb();
  const assignment = db.prepare(`SELECT * FROM assignments WHERE id = ?`).get(paramId(req.params.id)) as
    | { id: string; class_id: string; status: string }
    | undefined;
  if (!assignment || assignment.status !== 'open') {
    res.status(404).json({ error: 'assignment_not_found' });
    return;
  }
  if (req.user?.classId !== assignment.class_id) {
    res.status(403).json({ error: 'forbidden' });
    return;
  }

  const note = String(req.body?.note ?? '');
  const now = nowIso();
  const existing = db
    .prepare(`SELECT id FROM assignment_submissions WHERE assignment_id = ? AND student_id = ?`)
    .get(assignment.id, req.user.id) as { id: string } | undefined;

  if (existing) {
    db.prepare(
      `UPDATE assignment_submissions
       SET status = 'submitted', note = ?, submitted_at = ?, reviewed_at = NULL, reviewed_by = NULL
       WHERE id = ?`,
    ).run(note, now, existing.id);
    res.json({ id: existing.id, status: 'submitted' });
    return;
  }

  const id = newId();
  db.prepare(
    `INSERT INTO assignment_submissions
      (id, assignment_id, student_id, status, note, submitted_at, reviewed_at, reviewed_by)
     VALUES (?, ?, ?, 'submitted', ?, ?, NULL, NULL)`,
  ).run(id, assignment.id, req.user.id, note, now);
  res.status(201).json({ id, status: 'submitted' });
});

assignmentsRouter.post(
  '/api/v1/assignments/:id/review',
  requireAuth,
  requireRoles('teacher', 'admin'),
  (req: AuthedRequest, res) => {
    const studentId = String(req.body?.studentId ?? '');
    const status = String(req.body?.status ?? '');
    const pointsDelta = Number(req.body?.pointsDelta ?? 0);
    const reason = String(req.body?.reason ?? '作业审核加分');

    if (!studentId || !['approved', 'rejected'].includes(status)) {
      res.status(400).json({ error: 'invalid_review' });
      return;
    }

    const db = openDb();
    const assignment = db.prepare(`SELECT * FROM assignments WHERE id = ?`).get(paramId(req.params.id)) as
      | { id: string; class_id: string }
      | undefined;
    if (!assignment) {
      res.status(404).json({ error: 'assignment_not_found' });
      return;
    }

    try {
      withTransaction(db, () => {
        const submission = db
          .prepare(
            `SELECT * FROM assignment_submissions WHERE assignment_id = ? AND student_id = ?`,
          )
          .get(assignment.id, studentId) as { id: string; status: string } | undefined;
        if (!submission) throw new Error('submission_not_found');

        db.prepare(
          `UPDATE assignment_submissions
           SET status = ?, reviewed_at = ?, reviewed_by = ? WHERE id = ?`,
        ).run(status, nowIso(), req.user!.id, submission.id);

        if (status === 'approved' && pointsDelta !== 0) {
          const result = addPoints(db, {
            studentId,
            classId: assignment.class_id,
            points: pointsDelta,
            reasonSummary: reason,
            source: 'manual',
            mode: 'manual',
            createdBy: req.user!.id,
            idempotencyKey: `assignment-review:${assignment.id}:${studentId}:${status}`,
          });
          if (!result.ok) {
            // already awarded for this review key — still ok
          }
        }
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'submission_not_found') {
        res.status(404).json({ error: 'submission_not_found' });
        return;
      }
      throw error;
    }

    res.json({ ok: true });
  },
);

assignmentsRouter.get(
  '/api/v1/assignments/:id/submissions',
  requireAuth,
  requireRoles('teacher', 'admin'),
  (req, res) => {
    const items = openDb()
      .prepare(
        `SELECT s.id, s.student_id AS studentId, u.display_name AS studentName, s.status, s.note,
                s.submitted_at AS submittedAt, s.reviewed_at AS reviewedAt
         FROM assignment_submissions s
         JOIN users u ON u.id = s.student_id
         WHERE s.assignment_id = ?
         ORDER BY s.submitted_at DESC`,
      )
      .all(paramId(req.params.id));
    res.json({ items });
  },
);
