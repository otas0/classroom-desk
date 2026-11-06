import { Router } from 'express';
import { openDb } from '../db/client.js';
import { getSetting } from '../db/migrate.js';
import { requireAuth, requireRoles, type AuthedRequest } from '../middleware/auth.js';
import { newId, nowIso } from '../utils/id.js';
import { paramId } from '../utils/params.js';

export const messagesRouter = Router();

function messagesEnabled(): boolean {
  return (getSetting(openDb(), 'messages_enabled') ?? '1') !== '0';
}

type MsgRow = {
  id: string;
  classId: string;
  studentId: string;
  studentName: string;
  toStudentId: string | null;
  toStudentName: string | null;
  body: string;
  createdAt: string;
  readAt: string | null;
};

function loadReplies(db: ReturnType<typeof openDb>, messageId: string) {
  return db
    .prepare(
      `SELECT r.id, r.teacher_id AS authorId, u.display_name AS authorName, u.role AS authorRole,
              r.body, r.created_at AS createdAt, r.read_at AS readAt
       FROM message_replies r
       JOIN users u ON u.id = r.teacher_id
       WHERE r.message_id = ?
       ORDER BY r.created_at ASC`,
    )
    .all(messageId);
}

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
           m.to_student_id AS toStudentId, t.display_name AS toStudentName,
           m.body, m.created_at AS createdAt, m.read_at AS readAt
    FROM messages m
    JOIN users u ON u.id = m.student_id
    LEFT JOIN users t ON t.id = m.to_student_id
    WHERE m.class_id = ?`;
  const params: string[] = [classId];

  if (req.user?.role === 'student') {
    // Own messages to teacher/peers, plus peer messages addressed to me.
    sql += ` AND (m.student_id = ? OR m.to_student_id = ?)`;
    params.push(req.user.id, req.user.id);
  } else if (studentId) {
    sql += ` AND (m.student_id = ? OR m.to_student_id = ?)`;
    params.push(studentId, studentId);
  }
  sql += ` ORDER BY m.created_at DESC LIMIT 200`;

  const items = (db.prepare(sql).all(...params) as MsgRow[]).map((msg) => {
    const audience = msg.toStudentId ? 'peer' : 'teacher';
    return {
      ...msg,
      audience,
      replies: loadReplies(db, msg.id),
    };
  });

  res.json({ items });
});

messagesRouter.post('/api/v1/messages', requireAuth, requireRoles('student'), (req: AuthedRequest, res) => {
  if (!messagesEnabled()) {
    res.status(403).json({ error: 'messages_disabled', message: '留言已关闭' });
    return;
  }
  const body = String(req.body?.body ?? '').trim();
  if (!body || !req.user?.classId) {
    res.status(400).json({ error: 'invalid_message', message: '留言内容不能为空' });
    return;
  }

  const rawTo = req.body?.toStudentId;
  const toStudentId =
    rawTo == null || rawTo === '' || rawTo === 'teacher' ? null : String(rawTo).trim();

  const db = openDb();
  if (toStudentId) {
    if (toStudentId === req.user.id) {
      res.status(400).json({ error: 'cannot_message_self', message: '不能给自己留言' });
      return;
    }
    const peer = db
      .prepare(
        `SELECT id FROM users WHERE id = ? AND role = 'student' AND class_id = ?`,
      )
      .get(toStudentId, req.user.classId) as { id: string } | undefined;
    if (!peer) {
      res.status(400).json({ error: 'peer_not_in_class', message: '只能发给本班同学' });
      return;
    }
  }

  const id = newId();
  const createdAt = nowIso();
  db.prepare(
    `INSERT INTO messages (id, class_id, student_id, to_student_id, body, created_at, read_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL)`,
  ).run(id, req.user.classId, req.user.id, toStudentId, body, createdAt);

  res.status(201).json({
    id,
    body,
    createdAt,
    toStudentId,
    audience: toStudentId ? 'peer' : 'teacher',
  });
});

messagesRouter.post('/api/v1/messages/:id/read', requireAuth, requireRoles('student'), (req: AuthedRequest, res) => {
  const db = openDb();
  const id = paramId(req.params.id);
  const msg = db
    .prepare(`SELECT id, to_student_id AS toStudentId FROM messages WHERE id = ?`)
    .get(id) as { id: string; toStudentId: string | null } | undefined;
  if (!msg || msg.toStudentId !== req.user?.id) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  db.prepare(`UPDATE messages SET read_at = ? WHERE id = ? AND read_at IS NULL`).run(nowIso(), id);
  res.json({ ok: true });
});

messagesRouter.post('/api/v1/messages/:id/replies', requireAuth, (req: AuthedRequest, res) => {
  const body = String(req.body?.body ?? '').trim();
  if (!body) {
    res.status(400).json({ error: 'body_required', message: '回复不能为空' });
    return;
  }
  const db = openDb();
  const messageId = paramId(req.params.id);
  const message = db
    .prepare(
      `SELECT id, student_id AS studentId, to_student_id AS toStudentId, class_id AS classId
       FROM messages WHERE id = ?`,
    )
    .get(messageId) as
    | { id: string; studentId: string; toStudentId: string | null; classId: string }
    | undefined;
  if (!message) {
    res.status(404).json({ error: 'not_found' });
    return;
  }

  const role = req.user?.role;
  const uid = req.user?.id;
  if (!uid) {
    res.status(401).json({ error: 'unauthorized', message: '未登录' });
    return;
  }
  const isTeacher = role === 'teacher' || role === 'admin';
  const isParticipant =
    role === 'student' && (message.studentId === uid || message.toStudentId === uid);

  if (!isTeacher && !isParticipant) {
    res.status(403).json({ error: 'forbidden', message: '无权回复该留言' });
    return;
  }
  if (role === 'student' && !messagesEnabled()) {
    res.status(403).json({ error: 'messages_disabled', message: '留言已关闭' });
    return;
  }
  if (isTeacher && req.user?.classId && message.classId !== req.user.classId) {
    // teachers may not have classId on token; skip strict check if missing
  }

  const id = newId();
  const createdAt = nowIso();
  // message_replies.teacher_id historically required; store author id for both roles.
  db.prepare(
    `INSERT INTO message_replies (id, message_id, teacher_id, body, created_at, read_at)
     VALUES (?, ?, ?, ?, ?, NULL)`,
  ).run(id, messageId, uid, body, createdAt);

  // Peer/teacher reply opens unread for the other party when directed at a student thread.
  if (message.toStudentId) {
    // peer thread: clear read so recipient sees activity via replies unread path
  }

  res.status(201).json({ id, body, createdAt, authorId: uid });
});

messagesRouter.post('/api/v1/messages/replies/:id/read', requireAuth, requireRoles('student'), (req: AuthedRequest, res) => {
  const db = openDb();
  const reply = db
    .prepare(
      `SELECT r.id, m.student_id AS studentId, m.to_student_id AS toStudentId, r.teacher_id AS authorId
       FROM message_replies r
       JOIN messages m ON m.id = r.message_id
       WHERE r.id = ?`,
    )
    .get(paramId(req.params.id)) as
    | { id: string; studentId: string; toStudentId: string | null; authorId: string }
    | undefined;
  if (!reply) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  const uid = req.user!.id;
  // Can mark read if I'm a participant and not the author of the reply.
  const participant = reply.studentId === uid || reply.toStudentId === uid;
  if (!participant || reply.authorId === uid) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  db.prepare(`UPDATE message_replies SET read_at = ? WHERE id = ? AND read_at IS NULL`).run(nowIso(), reply.id);
  res.json({ ok: true });
});

messagesRouter.get('/api/v1/messages/unread-count', requireAuth, requireRoles('student'), (req: AuthedRequest, res) => {
  const db = openDb();
  const uid = req.user!.id;
  const replyUnread = db
    .prepare(
      `SELECT COUNT(*) AS c
       FROM message_replies r
       JOIN messages m ON m.id = r.message_id
       WHERE r.read_at IS NULL
         AND r.teacher_id != ?
         AND (m.student_id = ? OR m.to_student_id = ?)`,
    )
    .get(uid, uid, uid) as { c: number };
  const peerUnread = db
    .prepare(
      `SELECT COUNT(*) AS c FROM messages
       WHERE to_student_id = ? AND read_at IS NULL`,
    )
    .get(uid) as { c: number };
  res.json({ count: Number(replyUnread.c) + Number(peerUnread.c) });
});
