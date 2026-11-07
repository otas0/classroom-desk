import { Router } from 'express';
import { openDb, withTransaction } from '../db/client.js';
import { requireAuth, requireRoles, type AuthedRequest } from '../middleware/auth.js';
import { RECYCLE_RETENTION_DAYS, writeAudit } from '../services/audit.js';
import { computeErrorRate, gradeAnswer, type QuestionType } from '../services/grading.js';
import { chunkIds, parseIdList, sqlInPlaceholders } from '../utils/bulkIds.js';
import { newId, nowIso } from '../utils/id.js';
import { toCsv } from '../utils/csv.js';
import { paramId } from '../utils/params.js';
import { recycleTiming } from '../utils/recycleRetention.js';

export const questionsRouter = Router();

type QuestionAttachment = { url: string; originalName: string; size?: number; mime?: string };

function parseAttachments(raw: unknown): QuestionAttachment[] {
  if (raw == null || raw === '') return [];
  if (Array.isArray(raw)) {
    return raw
      .map((a) => ({
        url: String((a as QuestionAttachment).url ?? ''),
        originalName: String((a as QuestionAttachment).originalName ?? '附件'),
        size: (a as QuestionAttachment).size,
        mime: (a as QuestionAttachment).mime,
      }))
      .filter((a) => a.url.startsWith('/uploads/'));
  }
  if (typeof raw === 'string') {
    try {
      return parseAttachments(JSON.parse(raw));
    } catch {
      return [];
    }
  }
  return [];
}

function isClosed(row: { closed_at?: string | null; closes_at?: string | null }, now = nowIso()): boolean {
  if (row.closed_at) return true;
  if (row.closes_at && row.closes_at <= now) return true;
  return false;
}

questionsRouter.get('/api/v1/questions', requireAuth, (req: AuthedRequest, res) => {
  const classId = String(req.query.classId ?? req.user?.classId ?? '');
  if (!classId) {
    res.status(400).json({ error: 'class_id_required' });
    return;
  }
  const db = openDb();
  const teacher =
    req.user?.role === 'teacher' ||
    req.user?.role === 'admin' ||
    req.user?.role === 'assistant';
  const includeArchived = teacher && String(req.query.includeArchived ?? '') === '1';
  const includeDeleted =
    (req.user?.role === 'teacher' || req.user?.role === 'admin') &&
    String(req.query.includeDeleted ?? '') === '1';
  const rows = db
    .prepare(
      `SELECT id, class_id AS classId, title, stem, type, answer_key AS answerKey, points,
              attachments, created_by AS createdBy, created_at AS createdAt, published,
              closed_at AS closedAt, closes_at AS closesAt, COALESCE(archived, 0) AS archived,
              COALESCE(retry_wrong, 0) AS retryWrong, deleted_at AS deletedAt
       FROM questions
       WHERE class_id = ?
         ${includeDeleted ? "AND deleted_at IS NOT NULL AND deleted_at != ''" : "AND (deleted_at IS NULL OR deleted_at = '')"}
         ${teacher ? '' : 'AND published = 1 AND COALESCE(archived, 0) = 0'}
         ${teacher && !includeArchived && !includeDeleted ? 'AND COALESCE(archived, 0) = 0' : ''}
       ORDER BY created_at DESC`,
    )
    .all(classId) as Array<{
      id: string;
      type: string;
      answerKey: string | null;
      classId: string;
      title: string;
      stem: string;
      points: number;
      attachments: string | null;
      createdBy: string;
      createdAt: string;
      published: number;
      closedAt: string | null;
      closesAt: string | null;
      archived: number;
      retryWrong: number;
    }>;

  const now = nowIso();
  const items = rows.map((q) => {
    const options = db
      .prepare(
        `SELECT id, label, content, is_correct AS isCorrect
         FROM question_options WHERE question_id = ? ORDER BY label`,
      )
      .all(q.id)
      .map((opt) => {
        const o = opt as { id: string; label: string; content: string; isCorrect: number };
        if (teacher) return o;
        return { id: o.id, label: o.label, content: o.content };
      });
    const mine =
      req.user?.role === 'student'
        ? db
            .prepare(
              `SELECT is_correct AS isCorrect, answered_at AS answeredAt, answer_payload AS answerPayload
               FROM student_answers WHERE question_id = ? AND student_id = ?`,
            )
            .get(q.id, req.user.id)
        : null;
    const { attachments: rawAtt, deletedAt, ...rest } = q as typeof q & {
      deletedAt?: string | null;
    };
    const closed = isClosed({ closed_at: q.closedAt, closes_at: q.closesAt }, now);
    const mineRow = mine as { isCorrect?: number; answeredAt?: string } | null;
    const canRetryWrong =
      Boolean(q.retryWrong) &&
      closed &&
      mineRow != null &&
      Number(mineRow.isCorrect) === 0;
    const timing = deletedAt ? recycleTiming(deletedAt) : null;
    return {
      ...rest,
      deletedAt: deletedAt ?? null,
      expiresAt: timing?.expiresAt ?? null,
      daysLeft: timing?.daysLeft ?? null,
      retentionDays: timing ? RECYCLE_RETENTION_DAYS : undefined,
      answerKey: teacher ? q.answerKey : undefined,
      attachments: parseAttachments(rawAtt),
      options,
      myAnswer: mine,
      closed,
      retryWrong: Boolean(q.retryWrong),
      canRetryWrong,
      acceptingAnswers:
        Boolean(q.published) && !q.archived && (!closed || canRetryWrong),
    };
  });

  res.json({ items, retentionDays: includeDeleted ? RECYCLE_RETENTION_DAYS : undefined });
});

questionsRouter.post(
  '/api/v1/questions',
  requireAuth,
  requireRoles('teacher', 'admin'),
  (req: AuthedRequest, res) => {
    const classId = String(req.body?.classId ?? '');
    const title = String(req.body?.title ?? '').trim();
    const stem = String(req.body?.stem ?? '').trim();
    const type = String(req.body?.type ?? '') as QuestionType;
    if (!classId || !title || !stem || !['single', 'multi', 'bool', 'blank'].includes(type)) {
      res.status(400).json({ error: 'invalid_question' });
      return;
    }

    const options = Array.isArray(req.body?.options) ? req.body.options : [];
    if (type === 'blank') {
      if (!String(req.body?.answerKey ?? '').trim()) {
        res.status(400).json({ error: 'blank_answer_required', message: '填空题须填写参考答案' });
        return;
      }
    } else {
      if (options.length < 2) {
        res.status(400).json({ error: 'options_required', message: '选择题至少两个选项' });
        return;
      }
      const correctCount = options.filter((opt: { isCorrect?: boolean }) => Boolean(opt?.isCorrect)).length;
      if (correctCount < 1) {
        res.status(400).json({
          error: 'correct_option_required',
          message: type === 'multi' ? '多选题请至少勾选一个正确答案' : '请选择正确答案',
        });
        return;
      }
      if ((type === 'single' || type === 'bool') && correctCount !== 1) {
        res.status(400).json({ error: 'single_correct_required', message: '单选/判断只能有一个正确答案' });
        return;
      }
    }

    const attachmentsJson = JSON.stringify(parseAttachments(req.body?.attachments));
    const closesAt =
      req.body?.closesAt != null && String(req.body.closesAt).trim()
        ? String(req.body.closesAt).trim()
        : null;
    const id = newId();
    const createdAt = nowIso();
    const db = openDb();
    withTransaction(db, () => {
      db.prepare(
        `INSERT INTO questions
          (id, class_id, title, stem, type, answer_key, points, attachments, created_by, created_at, published, closed_at, closes_at, archived)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 0)`,
      ).run(
        id,
        classId,
        title,
        stem,
        type,
        req.body?.answerKey ?? null,
        Number(req.body?.points ?? 1),
        attachmentsJson,
        req.user!.id,
        createdAt,
        req.body?.published === false ? 0 : 1,
        closesAt,
      );

      for (const opt of options) {
        db.prepare(
          `INSERT INTO question_options (id, question_id, label, content, is_correct)
           VALUES (?, ?, ?, ?, ?)`,
        ).run(newId(), id, String(opt.label ?? ''), String(opt.content ?? ''), opt.isCorrect ? 1 : 0);
      }
    });

    res.status(201).json({ id, createdAt, closesAt });
  },
);

questionsRouter.patch(
  '/api/v1/questions/:id',
  requireAuth,
  requireRoles('teacher', 'admin'),
  (req: AuthedRequest, res) => {
    const id = paramId(req.params.id);
    const db = openDb();
    const existing = db.prepare(`SELECT id, class_id FROM questions WHERE id = ?`).get(id) as
      | { id: string; class_id: string }
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const title = req.body?.title != null ? String(req.body.title).trim() : null;
    const stem = req.body?.stem != null ? String(req.body.stem).trim() : null;
    const type = req.body?.type != null ? String(req.body.type) : null;
    if (type && !['single', 'multi', 'bool', 'blank'].includes(type)) {
      res.status(400).json({ error: 'invalid_type' });
      return;
    }
    withTransaction(db, () => {
      if (
        title != null ||
        stem != null ||
        type != null ||
        req.body?.answerKey !== undefined ||
        req.body?.points != null ||
        req.body?.published != null ||
        req.body?.attachments !== undefined ||
        req.body?.closesAt !== undefined ||
        req.body?.closed !== undefined ||
        req.body?.archived !== undefined ||
        req.body?.retryWrong !== undefined
      ) {
        const row = db.prepare(`SELECT * FROM questions WHERE id = ?`).get(id) as {
          title: string;
          stem: string;
          type: string;
          answer_key: string | null;
          points: number;
          published: number;
          attachments: string | null;
          closed_at: string | null;
          closes_at: string | null;
          archived: number | null;
          retry_wrong: number | null;
        };
        const nextAtt =
          req.body?.attachments !== undefined
            ? JSON.stringify(parseAttachments(req.body.attachments))
            : row.attachments;
        let nextClosed = row.closed_at;
        if (req.body?.closed === true) nextClosed = nowIso();
        if (req.body?.closed === false) nextClosed = null;
        const nextCloses =
          req.body?.closesAt !== undefined
            ? String(req.body.closesAt ?? '').trim() || null
            : row.closes_at;
        const nextArchived =
          req.body?.archived === true ? 1 : req.body?.archived === false ? 0 : Number(row.archived ?? 0);
        const nextRetry =
          req.body?.retryWrong === true
            ? 1
            : req.body?.retryWrong === false
              ? 0
              : Number(row.retry_wrong ?? 0);
        db.prepare(
          `UPDATE questions SET title = ?, stem = ?, type = ?, answer_key = ?, points = ?, attachments = ?,
            published = ?, closed_at = ?, closes_at = ?, archived = ?, retry_wrong = ? WHERE id = ?`,
        ).run(
          title ?? row.title,
          stem ?? row.stem,
          type ?? row.type,
          req.body?.answerKey !== undefined ? (req.body.answerKey as string | null) : row.answer_key,
          req.body?.points != null ? Number(req.body.points) : row.points,
          nextAtt,
          req.body?.published === false ? 0 : req.body?.published === true ? 1 : row.published,
          nextClosed,
          nextCloses,
          nextArchived,
          nextRetry,
          id,
        );
      }
      if (Array.isArray(req.body?.options)) {
        db.prepare(`DELETE FROM question_options WHERE question_id = ?`).run(id);
        for (const opt of req.body.options) {
          db.prepare(
            `INSERT INTO question_options (id, question_id, label, content, is_correct)
             VALUES (?, ?, ?, ?, ?)`,
          ).run(newId(), id, String(opt.label ?? ''), String(opt.content ?? ''), opt.isCorrect ? 1 : 0);
        }
      }
    });
    res.json({ ok: true, id });
  },
);

questionsRouter.post(
  '/api/v1/questions/:id/close',
  requireAuth,
  requireRoles('teacher', 'admin'),
  (req: AuthedRequest, res) => {
    const id = paramId(req.params.id);
    const db = openDb();
    const closedAt = nowIso();
    const info = db.prepare(`UPDATE questions SET closed_at = ? WHERE id = ?`).run(closedAt, id);
    if (!info.changes) {
      res.status(404).json({ error: 'not_found', message: '题目不存在' });
      return;
    }
    res.json({ ok: true, id, closedAt });
  },
);

questionsRouter.post(
  '/api/v1/questions/:id/reopen',
  requireAuth,
  requireRoles('teacher', 'admin'),
  (req: AuthedRequest, res) => {
    const id = paramId(req.params.id);
    const db = openDb();
    const info = db
      .prepare(`UPDATE questions SET closed_at = NULL, published = 1, archived = 0 WHERE id = ?`)
      .run(id);
    if (!info.changes) {
      res.status(404).json({ error: 'not_found', message: '题目不存在' });
      return;
    }
    res.json({ ok: true, id });
  },
);

questionsRouter.delete(
  '/api/v1/questions/:id',
  requireAuth,
  requireRoles('teacher', 'admin'),
  (req: AuthedRequest, res) => {
    const id = paramId(req.params.id);
    const db = openDb();
    const at = nowIso();
    const existing = db
      .prepare(
        `SELECT id, class_id AS classId FROM questions
         WHERE id = ? AND (deleted_at IS NULL OR deleted_at = '')`,
      )
      .get(id) as { id: string; classId: string } | undefined;
    if (!existing) {
      res.status(404).json({ error: 'not_found', message: '题目不存在' });
      return;
    }
    db.prepare(`UPDATE questions SET deleted_at = ? WHERE id = ?`).run(at, id);
    writeAudit({
      actorUserId: req.user?.id,
      actorRole: req.user?.role,
      action: 'questions.soft_delete',
      classId: existing.classId,
      detail: { ids: [id] },
      clientIp: req.ip,
    });
    res.json({ ok: true, id, softDeleted: true, deletedAt: at });
  },
);

/**
 * Bulk question actions:
 * delete (soft) | purge | restore | close | reopen | archive | unarchive | set_closes_at
 */
questionsRouter.post(
  '/api/v1/questions/bulk',
  requireAuth,
  requireRoles('teacher', 'admin', 'assistant'),
  (req: AuthedRequest, res) => {
    const classId = String(req.body?.classId ?? '').trim();
    const action = String(req.body?.action ?? '').trim();
    const ids = parseIdList(req.body?.ids, 200);
    const closesAtRaw = req.body?.closesAt;
    const closesAt =
      closesAtRaw == null || String(closesAtRaw).trim() === ''
        ? null
        : String(closesAtRaw).trim();

    if (!classId) {
      res.status(400).json({ error: 'class_id_required', message: '缺少班级' });
      return;
    }
    if (ids.length === 0) {
      res.status(400).json({ error: 'ids_required', message: '请选择题目' });
      return;
    }
    const allowed = [
      'delete',
      'purge',
      'restore',
      'close',
      'reopen',
      'archive',
      'unarchive',
      'set_closes_at',
    ];
    if (!allowed.includes(action)) {
      res.status(400).json({
        error: 'invalid_action',
        message: `action 须为 ${allowed.join(' / ')}`,
      });
      return;
    }
    if (
      req.user?.role === 'assistant' &&
      (action === 'delete' || action === 'purge' || action === 'set_closes_at')
    ) {
      res.status(403).json({ error: 'forbidden', message: '助教不可删除题目或改截止时间' });
      return;
    }
    if (action === 'set_closes_at' && closesAt != null && Number.isNaN(Date.parse(closesAt))) {
      res.status(400).json({ error: 'invalid_closes_at', message: '截止时间格式无效' });
      return;
    }

    const db = openDb();
    const at = nowIso();
    let affected = 0;
    const found = new Set<string>();

    const activeIn = (chunk: string[]) => {
      const ph = sqlInPlaceholders(chunk.length);
      return db
        .prepare(
          `SELECT id FROM questions
           WHERE class_id = ? AND id IN (${ph})
             AND (deleted_at IS NULL OR deleted_at = '')`,
        )
        .all(classId, ...chunk) as Array<{ id: string }>;
    };
    const deletedIn = (chunk: string[]) => {
      const ph = sqlInPlaceholders(chunk.length);
      return db
        .prepare(
          `SELECT id FROM questions
           WHERE class_id = ? AND id IN (${ph})
             AND deleted_at IS NOT NULL AND deleted_at != ''`,
        )
        .all(classId, ...chunk) as Array<{ id: string }>;
    };

    db.exec('BEGIN');
    try {
      for (const chunk of chunkIds(ids)) {
        if (action === 'restore') {
          const rows = deletedIn(chunk);
          for (const r of rows) found.add(r.id);
          if (rows.length) {
            const ph = sqlInPlaceholders(rows.length);
            const info = db
              .prepare(
                `UPDATE questions SET deleted_at = NULL
                 WHERE class_id = ? AND id IN (${ph})`,
              )
              .run(classId, ...rows.map((r) => r.id));
            affected += Number(info.changes ?? 0);
          }
          continue;
        }
        if (action === 'purge') {
          const rows = deletedIn(chunk);
          for (const r of rows) found.add(r.id);
          if (rows.length) {
            const ph = sqlInPlaceholders(rows.length);
            const info = db
              .prepare(`DELETE FROM questions WHERE class_id = ? AND id IN (${ph})`)
              .run(classId, ...rows.map((r) => r.id));
            affected += Number(info.changes ?? 0);
          }
          continue;
        }

        const rows = activeIn(chunk);
        for (const r of rows) found.add(r.id);
        if (!rows.length) continue;
        const rowIds = rows.map((r) => r.id);
        const ph = sqlInPlaceholders(rowIds.length);

        if (action === 'delete') {
          const info = db
            .prepare(
              `UPDATE questions SET deleted_at = ?
               WHERE class_id = ? AND id IN (${ph})
                 AND (deleted_at IS NULL OR deleted_at = '')`,
            )
            .run(at, classId, ...rowIds);
          affected += Number(info.changes ?? 0);
        } else if (action === 'close') {
          const info = db
            .prepare(
              `UPDATE questions SET closed_at = ?
               WHERE class_id = ? AND id IN (${ph})
                 AND (deleted_at IS NULL OR deleted_at = '')`,
            )
            .run(at, classId, ...rowIds);
          affected += Number(info.changes ?? 0);
        } else if (action === 'reopen') {
          const info = db
            .prepare(
              `UPDATE questions
               SET closed_at = NULL, published = 1, archived = 0
               WHERE class_id = ? AND id IN (${ph})
                 AND (deleted_at IS NULL OR deleted_at = '')`,
            )
            .run(classId, ...rowIds);
          affected += Number(info.changes ?? 0);
        } else if (action === 'archive') {
          const info = db
            .prepare(
              `UPDATE questions SET archived = 1
               WHERE class_id = ? AND id IN (${ph})
                 AND (deleted_at IS NULL OR deleted_at = '')`,
            )
            .run(classId, ...rowIds);
          affected += Number(info.changes ?? 0);
        } else if (action === 'unarchive') {
          const info = db
            .prepare(
              `UPDATE questions SET archived = 0, published = 1
               WHERE class_id = ? AND id IN (${ph})
                 AND (deleted_at IS NULL OR deleted_at = '')`,
            )
            .run(classId, ...rowIds);
          affected += Number(info.changes ?? 0);
        } else if (action === 'set_closes_at') {
          const info = db
            .prepare(
              `UPDATE questions SET closes_at = ?
               WHERE class_id = ? AND id IN (${ph})
                 AND (deleted_at IS NULL OR deleted_at = '')`,
            )
            .run(closesAt, classId, ...rowIds);
          affected += Number(info.changes ?? 0);
        }
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }

    const missing = ids.filter((id) => !found.has(id));
    const labels: Record<string, string> = {
      delete: '移入回收站',
      purge: '永久删除',
      restore: '恢复',
      close: '收卷',
      reopen: '重开',
      archive: '下线',
      unarchive: '恢复上线',
      set_closes_at: closesAt ? '设置截止' : '清空截止',
    };
    writeAudit({
      actorUserId: req.user?.id,
      actorRole: req.user?.role,
      action: 'questions.bulk',
      classId,
      detail: { action, ids, affected, closesAt },
      clientIp: req.ip,
    });
    res.json({
      ok: true,
      action,
      affected,
      requested: ids.length,
      missing,
      retentionDays: action === 'delete' ? RECYCLE_RETENTION_DAYS : undefined,
      message: missing.length
        ? `已${labels[action]} ${affected} 题，${missing.length} 题不可用`
        : action === 'delete'
          ? `已移入回收站 ${affected} 题（${RECYCLE_RETENTION_DAYS} 日内可恢复）`
          : action === 'set_closes_at' && !closesAt
            ? `已清空 ${affected} 题截止时间`
            : `已${labels[action]} ${affected} 题`,
    });
  },
);

questionsRouter.post(
  '/api/v1/questions/recycle/restore-all',
  requireAuth,
  requireRoles('teacher', 'admin'),
  (req: AuthedRequest, res) => {
    const classId = String(req.body?.classId ?? '').trim();
    if (!classId) {
      res.status(400).json({ error: 'class_id_required', message: '缺少班级' });
      return;
    }
    const db = openDb();
    const info = db
      .prepare(
        `UPDATE questions SET deleted_at = NULL
         WHERE class_id = ? AND deleted_at IS NOT NULL AND deleted_at != ''`,
      )
      .run(classId);
    const restored = Number(info.changes ?? 0);
    writeAudit({
      actorUserId: req.user?.id,
      actorRole: req.user?.role,
      action: 'questions.recycle_restore_all',
      classId,
      detail: { restored },
      clientIp: req.ip,
    });
    res.json({ ok: true, restored, message: `已恢复全部 ${restored} 题` });
  },
);

questionsRouter.post(
  '/api/v1/questions/recycle/purge-all',
  requireAuth,
  requireRoles('teacher', 'admin'),
  (req: AuthedRequest, res) => {
    const classId = String(req.body?.classId ?? '').trim();
    if (!classId) {
      res.status(400).json({ error: 'class_id_required', message: '缺少班级' });
      return;
    }
    const db = openDb();
    const info = db
      .prepare(
        `DELETE FROM questions
         WHERE class_id = ? AND deleted_at IS NOT NULL AND deleted_at != ''`,
      )
      .run(classId);
    const purged = Number(info.changes ?? 0);
    writeAudit({
      actorUserId: req.user?.id,
      actorRole: req.user?.role,
      action: 'questions.recycle_purge_all',
      classId,
      detail: { purged },
      clientIp: req.ip,
    });
    res.json({ ok: true, purged, message: `已永久清空题目回收站 ${purged} 题` });
  },
);

function refreshErrorStats(db: ReturnType<typeof openDb>, questionId: string, at: string): void {
  const stats = db
    .prepare(
      `SELECT COUNT(*) AS answered, SUM(CASE WHEN is_correct = 0 THEN 1 ELSE 0 END) AS wrong
       FROM student_answers WHERE question_id = ?`,
    )
    .get(questionId) as { answered: number; wrong: number };
  const answered = Number(stats.answered);
  const wrong = Number(stats.wrong ?? 0);
  const errorRate = computeErrorRate(answered, wrong);
  db.prepare(
    `INSERT INTO error_stats (question_id, answered_count, wrong_count, error_rate, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(question_id) DO UPDATE SET
       answered_count = excluded.answered_count,
       wrong_count = excluded.wrong_count,
       error_rate = excluded.error_rate,
       updated_at = excluded.updated_at`,
  ).run(questionId, answered, wrong, errorRate, at);
}

questionsRouter.post('/api/v1/questions/:id/answer', requireAuth, requireRoles('student'), (req: AuthedRequest, res) => {
  const db = openDb();
  const question = db
    .prepare(`SELECT * FROM questions WHERE id = ? AND published = 1 AND COALESCE(archived, 0) = 0`)
    .get(paramId(req.params.id)) as
    | {
        id: string;
        class_id: string;
        type: QuestionType;
        answer_key: string | null;
        closed_at: string | null;
        closes_at: string | null;
        retry_wrong: number | null;
      }
    | undefined;
  if (!question || question.class_id !== req.user?.classId) {
    res.status(404).json({ error: 'not_found' });
    return;
  }

  const existing = db
    .prepare(
      `SELECT id, is_correct AS isCorrect FROM student_answers WHERE question_id = ? AND student_id = ?`,
    )
    .get(question.id, req.user.id) as { id: string; isCorrect: number } | undefined;

  const closed = isClosed(question);
  const retryWrong = Boolean(question.retry_wrong);
  const isWrongRetry = Boolean(existing && Number(existing.isCorrect) === 0 && retryWrong && closed);

  if (closed && !isWrongRetry) {
    res.status(403).json({ error: 'question_closed', message: '题目已截止，不能再交' });
    return;
  }
  if (existing && !isWrongRetry) {
    res.status(409).json({ error: 'already_answered' });
    return;
  }

  const options = db
    .prepare(`SELECT id, is_correct FROM question_options WHERE question_id = ?`)
    .all(question.id) as Array<{ id: string; is_correct: number }>;

  let answerPayload = req.body?.answerPayload ?? req.body?.answer ?? null;
  if (answerPayload == null && (req.body?.optionIds != null || req.body?.optionId != null)) {
    answerPayload = {
      optionIds: req.body.optionIds,
      optionId: req.body.optionId,
    };
  }
  const isCorrect = gradeAnswer({
    type: question.type,
    answerKey: question.answer_key,
    options,
    answerPayload,
  });

  const answeredAt = nowIso();
  let id = existing?.id ?? newId();
  withTransaction(db, () => {
    if (isWrongRetry && existing) {
      db.prepare(
        `UPDATE student_answers
         SET answer_payload = ?, is_correct = ?, answered_at = ?
         WHERE id = ?`,
      ).run(JSON.stringify(answerPayload), isCorrect ? 1 : 0, answeredAt, existing.id);
      id = existing.id;
    } else {
      db.prepare(
        `INSERT INTO student_answers (id, question_id, student_id, answer_payload, is_correct, answered_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(id, question.id, req.user!.id, JSON.stringify(answerPayload), isCorrect ? 1 : 0, answeredAt);
    }
    refreshErrorStats(db, question.id, answeredAt);
  });

  res.status(isWrongRetry ? 200 : 201).json({ id, isCorrect, answeredAt, retry: isWrongRetry });
});

questionsRouter.get(
  '/api/v1/questions/live-board',
  requireAuth,
  requireRoles('teacher', 'admin'),
  (req, res) => {
    const classId = String(req.query.classId ?? '');
    if (!classId) {
      res.status(400).json({ error: 'class_id_required' });
      return;
    }
    const db = openDb();
    const rosterTotal = Number(
      (
        db
          .prepare(`SELECT COUNT(*) AS c FROM users WHERE role = 'student' AND class_id = ? AND (deleted_at IS NULL OR deleted_at = '')`)
          .get(classId) as { c: number }
      ).c,
    );
    const now = nowIso();
    const rows = db
      .prepare(
        `SELECT q.id, q.title, q.type, q.published, q.closed_at AS closedAt, q.closes_at AS closesAt,
                COALESCE(q.retry_wrong, 0) AS retryWrong,
                COALESCE(e.answered_count, 0) AS answeredCount,
                COALESCE(e.wrong_count, 0) AS wrongCount
         FROM questions q
         LEFT JOIN error_stats e ON e.question_id = q.id
         WHERE q.class_id = ? AND COALESCE(q.archived, 0) = 0 AND q.published = 1
           AND (q.deleted_at IS NULL OR q.deleted_at = '')
         ORDER BY q.created_at DESC
         LIMIT 12`,
      )
      .all(classId) as Array<{
      id: string;
      title: string;
      type: string;
      published: number;
      closedAt: string | null;
      closesAt: string | null;
      retryWrong: number;
      answeredCount: number;
      wrongCount: number;
    }>;

    const pendingStmt = db.prepare(
      `SELECT u.display_name AS displayName, u.student_no AS studentNo
       FROM users u
       WHERE u.role = 'student' AND u.class_id = ?
         AND (u.deleted_at IS NULL OR u.deleted_at = '')
         AND NOT EXISTS (
           SELECT 1 FROM student_answers sa WHERE sa.question_id = ? AND sa.student_id = u.id
         )
       ORDER BY u.student_no COLLATE NOCASE, u.display_name COLLATE NOCASE
       LIMIT 120`,
    );

    const items = rows.map((r) => {
      const answered = Number(r.answeredCount);
      const wrong = Number(r.wrongCount);
      const correct = Math.max(0, answered - wrong);
      const pendingStudents = pendingStmt.all(classId, r.id) as Array<{
        displayName: string;
        studentNo: string | null;
      }>;
      return {
        id: r.id,
        title: r.title,
        type: r.type,
        closed: isClosed({ closed_at: r.closedAt, closes_at: r.closesAt }, now),
        closesAt: r.closesAt,
        closedAt: r.closedAt,
        retryWrong: Boolean(r.retryWrong),
        rosterTotal,
        answeredCount: answered,
        pendingCount: Math.max(0, rosterTotal - answered),
        correctCount: correct,
        wrongCount: wrong,
        correctRate: answered > 0 ? correct / answered : 0,
        pendingStudents,
      };
    });
    res.json({ rosterTotal, items });
  },
);

questionsRouter.get(
  '/api/v1/questions/:id/stats',
  requireAuth,
  requireRoles('teacher', 'admin'),
  (req, res) => {
    const qid = paramId(req.params.id);
    const db = openDb();
    const q = db
      .prepare(
        `SELECT id, class_id AS classId, title, closed_at AS closedAt, closes_at AS closesAt,
                COALESCE(archived, 0) AS archived, published
         FROM questions WHERE id = ?`,
      )
      .get(qid) as
      | {
          id: string;
          classId: string;
          title: string;
          closedAt: string | null;
          closesAt: string | null;
          archived: number;
          published: number;
        }
      | undefined;
    if (!q) {
      res.status(404).json({ error: 'not_found' });
      return;
    }

    const stats = db.prepare(`SELECT * FROM error_stats WHERE question_id = ?`).get(qid) as
      | {
          answered_count: number;
          wrong_count: number;
          error_rate: number;
          updated_at: string;
        }
      | undefined;

    const rosterTotal = Number(
      (
        db
          .prepare(`SELECT COUNT(*) AS c FROM users WHERE role = 'student' AND class_id = ? AND (deleted_at IS NULL OR deleted_at = '')`)
          .get(q.classId) as { c: number }
      ).c,
    );
    const answeredCount = Number(stats?.answered_count ?? 0);
    const wrongCount = Number(stats?.wrong_count ?? 0);
    const correctCount = Math.max(0, answeredCount - wrongCount);
    const pendingCount = Math.max(0, rosterTotal - answeredCount);
    const correctRate = answeredCount > 0 ? correctCount / answeredCount : 0;

    const optionDist = db
      .prepare(
        `SELECT qo.id, qo.label, qo.content,
                SUM(CASE WHEN sa.answer_payload LIKE '%' || qo.id || '%' THEN 1 ELSE 0 END) AS chosenCount
         FROM question_options qo
         LEFT JOIN student_answers sa ON sa.question_id = qo.question_id
         WHERE qo.question_id = ?
         GROUP BY qo.id
         ORDER BY qo.label`,
      )
      .all(qid);

    const pendingStudents = db
      .prepare(
        `SELECT u.display_name AS displayName, u.student_no AS studentNo
         FROM users u
         WHERE u.role = 'student' AND u.class_id = ?
           AND NOT EXISTS (
             SELECT 1 FROM student_answers sa WHERE sa.question_id = ? AND sa.student_id = u.id
           )
         ORDER BY u.student_no COLLATE NOCASE, u.display_name COLLATE NOCASE
         LIMIT 80`,
      )
      .all(q.classId, qid);

    res.json({
      title: q.title,
      answeredCount,
      wrongCount,
      correctCount,
      pendingCount,
      rosterTotal,
      correctRate,
      errorRate: stats?.error_rate ?? 0,
      updatedAt: stats?.updated_at ?? null,
      closed: isClosed({ closed_at: q.closedAt, closes_at: q.closesAt }),
      closedAt: q.closedAt,
      closesAt: q.closesAt,
      archived: Boolean(q.archived),
      published: Boolean(q.published),
      optionDistribution: optionDist,
      pendingStudents,
    });
  },
);

questionsRouter.get(
  '/api/v1/questions/export.csv',
  requireAuth,
  requireRoles('teacher', 'admin'),
  (req, res) => {
    const classId = String(req.query.classId ?? '');
    if (!classId) {
      res.status(400).json({ error: 'class_id_required' });
      return;
    }
    const db = openDb();
    const rows = db
      .prepare(
        `SELECT q.id, q.title, q.type, COALESCE(e.answered_count, 0) AS answered,
                COALESCE(e.wrong_count, 0) AS wrong, COALESCE(e.error_rate, 0) AS errorRate
         FROM questions q
         LEFT JOIN error_stats e ON e.question_id = q.id
         WHERE q.class_id = ?
         ORDER BY q.created_at DESC`,
      )
      .all(classId) as Array<{
      id: string;
      title: string;
      type: string;
      answered: number;
      wrong: number;
      errorRate: number;
    }>;

    const includeOptions = String(req.query.includeOptions ?? '1') !== '0';
    const csvRows: Array<Array<string | number>> = [];
    for (const r of rows) {
      if (!includeOptions) {
        csvRows.push([r.title, r.type, r.answered, r.wrong, r.errorRate]);
        continue;
      }
      const options = db
        .prepare(
          `SELECT qo.label, qo.content,
                  SUM(CASE WHEN sa.answer_payload LIKE '%' || qo.id || '%' THEN 1 ELSE 0 END) AS chosenCount
           FROM question_options qo
           LEFT JOIN student_answers sa ON sa.question_id = qo.question_id
           WHERE qo.question_id = ?
           GROUP BY qo.id
           ORDER BY qo.label`,
        )
        .all(r.id) as Array<{ label: string; content: string; chosenCount: number }>;

      if (options.length === 0) {
        csvRows.push([r.title, r.type, r.answered, r.wrong, r.errorRate, '', '', 0]);
      } else {
        for (const opt of options) {
          csvRows.push([
            r.title,
            r.type,
            r.answered,
            r.wrong,
            r.errorRate,
            opt.label,
            opt.content,
            Number(opt.chosenCount ?? 0),
          ]);
        }
      }
    }

    const headers = includeOptions
      ? [
          'title',
          'type',
          'answered',
          'wrong',
          'errorRate',
          'optionLabel',
          'optionContent',
          'optionChosenCount',
        ]
      : ['title', 'type', 'answered', 'wrong', 'errorRate'];
    const csv = toCsv(headers, csvRows);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="question-stats.csv"');
    res.send('\uFEFF' + csv);
  },
);

questionsRouter.get(
  '/api/v1/students/:id/wrong-answers',
  requireAuth,
  requireRoles('teacher', 'admin'),
  (req, res) => {
    const items = openDb()
      .prepare(
        `SELECT sa.id, q.title, q.stem, sa.answer_payload AS answerPayload, sa.answered_at AS answeredAt
         FROM student_answers sa
         JOIN questions q ON q.id = sa.question_id
         WHERE sa.student_id = ? AND sa.is_correct = 0
         ORDER BY sa.answered_at DESC`,
      )
      .all(paramId(req.params.id));
    res.json({ items });
  },
);
