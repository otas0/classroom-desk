import { Router } from 'express';
import { openDb } from '../db/client.js';
import { requireAuth, requireRoles, type AuthedRequest } from '../middleware/auth.js';
import { newId, nowIso } from '../utils/id.js';
import { paramId } from '../utils/params.js';

export const messagesRouter = Router();

messagesRouter.get('/api/v1/messages', requireAuth, (req: AuthedRequest, res) => {
  const db = openDb();
  const classId = String(req.query.classId ?? req.user?.classId ?? '');
  const studentId = String(req.query.studentId ?? '');
  if (!classId) {
    res.status(400).json({ error: 'class_id_required' });
    return;
  }

  let sql = `
    SELECT m.id, m.class_id AS classId, m.student_id AS studentId, u.display_name AS studentName,
           m.body, m.created_at AS createdAt
    FROM messages m
    JOIN users u ON u.id = m.student_id
    WHERE m.class_id = ?`;
  const params: string[] = [classId];
  if (req.user?.role === 'student') {
    sql += ` AND m.student_id = ?`;
    params.push(req.user.id);
  } else if (studentId) {
    sql += ` AND m.student_id = ?`;
    params.push(studentId);
  }
  sql += ` ORDER BY m.created_at DESC LIMIT 100`;

  const items = (db.prepare(sql).all(...params) as Array<{ id: string }>).map((msg) => {
    const replies = db
      .prepare(
        `SELECT id, teacher_id AS teacherId, body, created_at AS createdAt, read_at AS readAt
         FROM message_replies WHERE message_id = ? ORDER BY created_at ASC`,
      )
      .all(msg.id);
    return { ...msg, replies };
  });

  res.json({ items });
});

messagesRouter.post('/api/v1/messages', requireAuth, requireRoles('student'), (req: AuthedRequest, res) => {
  const body = String(req.body?.body ?? '').trim();
  if (!body || !req.user?.classId) {
    res.status(400).json({ error: 'invalid_message' });
    return;
  }
  const id = newId();
  const createdAt = nowIso();
  openDb()
    .prepare(`INSERT INTO messages (id, class_id, student_id, body, created_at) VALUES (?, ?, ?, ?, ?)`)
    .run(id, req.user.classId, req.user.id, body, createdAt);
  res.status(201).json({ id, body, createdAt });
});

messagesRouter.post(
  '/api/v1/messages/:id/replies',
  requireAuth,
  requireRoles('teacher', 'admin'),
  (req: AuthedRequest, res) => {
    const body = String(req.body?.body ?? '').trim();
    if (!body) {
      res.status(400).json({ error: 'body_required' });
      return;
    }
    const db = openDb();
    const message = db.prepare(`SELECT id FROM messages WHERE id = ?`).get(paramId(req.params.id));
    if (!message) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const id = newId();
    const createdAt = nowIso();
    db.prepare(
      `INSERT INTO message_replies (id, message_id, teacher_id, body, created_at, read_at)
       VALUES (?, ?, ?, ?, ?, NULL)`,
    ).run(id, paramId(req.params.id), req.user!.id, body, createdAt);
    res.status(201).json({ id, body, createdAt });
  },
);

messagesRouter.post('/api/v1/messages/replies/:id/read', requireAuth, requireRoles('student'), (req: AuthedRequest, res) => {
  const db = openDb();
  const reply = db
    .prepare(
      `SELECT r.id, m.student_id
       FROM message_replies r
       JOIN messages m ON m.id = r.message_id
       WHERE r.id = ?`,
    )
    .get(paramId(req.params.id)) as { id: string; student_id: string } | undefined;
  if (!reply || reply.student_id !== req.user?.id) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  db.prepare(`UPDATE message_replies SET read_at = ? WHERE id = ? AND read_at IS NULL`).run(nowIso(), reply.id);
  res.json({ ok: true });
});

messagesRouter.get('/api/v1/messages/unread-count', requireAuth, requireRoles('student'), (req: AuthedRequest, res) => {
  const row = openDb()
    .prepare(
      `SELECT COUNT(*) AS c
       FROM message_replies r
       JOIN messages m ON m.id = r.message_id
       WHERE m.student_id = ? AND r.read_at IS NULL`,
    )
    .get(req.user!.id) as { c: number };
  res.json({ count: Number(row.c) });
});
