import { Router } from 'express';
import { openDb, withTransaction } from '../db/client.js';
import { requireAuth, requireRoles, type AuthedRequest } from '../middleware/auth.js';
import { computeErrorRate, gradeAnswer, type QuestionType } from '../services/grading.js';
import { newId, nowIso } from '../utils/id.js';
import { toCsv } from '../utils/csv.js';
import { paramId } from '../utils/params.js';

export const questionsRouter = Router();

questionsRouter.get('/api/v1/questions', requireAuth, (req: AuthedRequest, res) => {
  const classId = String(req.query.classId ?? req.user?.classId ?? '');
  if (!classId) {
    res.status(400).json({ error: 'class_id_required' });
    return;
  }
  const db = openDb();
  const teacher = req.user?.role === 'teacher' || req.user?.role === 'admin';
  const rows = db
    .prepare(
      `SELECT id, class_id AS classId, title, stem, type, answer_key AS answerKey, points,
              created_by AS createdBy, created_at AS createdAt, published
       FROM questions
       WHERE class_id = ? ${teacher ? '' : 'AND published = 1'}
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
      createdBy: string;
      createdAt: string;
      published: number;
    }>;

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
    return {
      ...q,
      answerKey: teacher ? q.answerKey : undefined,
      options,
      myAnswer: mine,
    };
  });

  res.json({ items });
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

    const id = newId();
    const createdAt = nowIso();
    const db = openDb();
    withTransaction(db, () => {
      db.prepare(
        `INSERT INTO questions
          (id, class_id, title, stem, type, answer_key, points, created_by, created_at, published)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        classId,
        title,
        stem,
        type,
        req.body?.answerKey ?? null,
        Number(req.body?.points ?? 1),
        req.user!.id,
        createdAt,
        req.body?.published === false ? 0 : 1,
      );

      const options = Array.isArray(req.body?.options) ? req.body.options : [];
      for (const opt of options) {
        db.prepare(
          `INSERT INTO question_options (id, question_id, label, content, is_correct)
           VALUES (?, ?, ?, ?, ?)`,
        ).run(newId(), id, String(opt.label ?? ''), String(opt.content ?? ''), opt.isCorrect ? 1 : 0);
      }
    });

    res.status(201).json({ id, createdAt });
  },
);

questionsRouter.post('/api/v1/questions/:id/answer', requireAuth, requireRoles('student'), (req: AuthedRequest, res) => {
  const db = openDb();
  const question = db.prepare(`SELECT * FROM questions WHERE id = ? AND published = 1`).get(paramId(req.params.id)) as
    | {
        id: string;
        class_id: string;
        type: QuestionType;
        answer_key: string | null;
      }
    | undefined;
  if (!question || question.class_id !== req.user?.classId) {
    res.status(404).json({ error: 'not_found' });
    return;
  }

  const existing = db
    .prepare(`SELECT id FROM student_answers WHERE question_id = ? AND student_id = ?`)
    .get(question.id, req.user.id);
  if (existing) {
    res.status(409).json({ error: 'already_answered' });
    return;
  }

  const options = db
    .prepare(`SELECT id, is_correct FROM question_options WHERE question_id = ?`)
    .all(question.id) as Array<{ id: string; is_correct: number }>;

  const isCorrect = gradeAnswer({
    type: question.type,
    answerKey: question.answer_key,
    options,
    answerPayload: req.body?.answer,
  });

  const id = newId();
  const answeredAt = nowIso();
  withTransaction(db, () => {
    db.prepare(
      `INSERT INTO student_answers (id, question_id, student_id, answer_payload, is_correct, answered_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(id, question.id, req.user!.id, JSON.stringify(req.body?.answer ?? null), isCorrect ? 1 : 0, answeredAt);

    const stats = db
      .prepare(
        `SELECT COUNT(*) AS answered, SUM(CASE WHEN is_correct = 0 THEN 1 ELSE 0 END) AS wrong
         FROM student_answers WHERE question_id = ?`,
      )
      .get(question.id) as { answered: number; wrong: number };
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
    ).run(question.id, answered, wrong, errorRate, answeredAt);
  });

  res.status(201).json({ id, isCorrect, answeredAt });
});

questionsRouter.get(
  '/api/v1/questions/:id/stats',
  requireAuth,
  requireRoles('teacher', 'admin'),
  (req, res) => {
    const db = openDb();
    const stats = db.prepare(`SELECT * FROM error_stats WHERE question_id = ?`).get(paramId(req.params.id)) as
      | {
          answered_count: number;
          wrong_count: number;
          error_rate: number;
          updated_at: string;
        }
      | undefined;

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
      .all(paramId(req.params.id));

    res.json({
      answeredCount: stats?.answered_count ?? 0,
      wrongCount: stats?.wrong_count ?? 0,
      errorRate: stats?.error_rate ?? 0,
      updatedAt: stats?.updated_at ?? null,
      optionDistribution: optionDist,
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
          'optionChosenCount', // 该选项被选次数（选项分布）
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
