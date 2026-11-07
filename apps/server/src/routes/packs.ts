import { Router } from 'express';
import { openDb, withTransaction } from '../db/client.js';
import { requireAuth, requireRoles, type AuthedRequest } from '../middleware/auth.js';
import { newId, nowIso } from '../utils/id.js';

export const packsRouter = Router();

type PackQuestion = {
  title: string;
  stem: string;
  type: 'single' | 'multi' | 'bool' | 'blank';
  answerKey?: string | null;
  options?: Array<{ label: string; text: string; isCorrect?: boolean }>;
  chapter?: string;
};

/** Export selected or all published questions as chapter pack JSON. */
packsRouter.get(
  '/api/v1/packs/export',
  requireAuth,
  requireRoles('teacher', 'admin', 'assistant'),
  (req: AuthedRequest, res) => {
    const classId = String(req.query.classId ?? '').trim();
    if (!classId) {
      res.status(400).json({ error: 'class_id_required' });
      return;
    }
    const ids = String(req.query.ids ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const db = openDb();
    let questions = db
      .prepare(
        `SELECT id, title, stem, type, answer_key AS answerKey
         FROM questions WHERE class_id = ? AND (deleted_at IS NULL OR deleted_at = '')
         ORDER BY created_at`,
      )
      .all(classId) as Array<{
      id: string;
      title: string;
      stem: string;
      type: string;
      answerKey: string | null;
    }>;
    if (ids.length) {
      const set = new Set(ids);
      questions = questions.filter((q) => set.has(q.id));
    }
    const items: PackQuestion[] = questions.map((q) => {
      const options = db
        .prepare(
          `SELECT label, content AS text, is_correct AS isCorrect FROM question_options WHERE question_id = ? ORDER BY label`,
        )
        .all(q.id) as Array<{ label: string; text: string; isCorrect: number }>;
      return {
        title: q.title,
        stem: q.stem,
        type: q.type as PackQuestion['type'],
        answerKey: q.answerKey,
        options: options.map((o) => ({
          label: o.label,
          text: o.text,
          isCorrect: Boolean(o.isCorrect),
        })),
        chapter: '',
      };
    });
    const pack = {
      format: 'classroom-desk-question-pack',
      version: 1,
      exportedAt: nowIso(),
      sourceClassId: classId,
      items,
    };
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="question-pack-${classId.slice(0, 8)}.json"`,
    );
    res.send(JSON.stringify(pack, null, 2));
  },
);

/** Import pack JSON into a class (unpublished draft → published optional). */
packsRouter.post(
  '/api/v1/packs/import',
  requireAuth,
  requireRoles('teacher', 'admin'),
  (req: AuthedRequest, res) => {
    const classId = String(req.body?.classId ?? '').trim();
    const publish = req.body?.publish !== false;
    const pack = req.body?.pack ?? req.body;
    if (!classId) {
      res.status(400).json({ error: 'class_id_required' });
      return;
    }
    const items = (pack?.items ?? []) as PackQuestion[];
    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: 'empty_pack' });
      return;
    }
    const db = openDb();
    if (!db.prepare(`SELECT id FROM classes WHERE id = ?`).get(classId)) {
      res.status(404).json({ error: 'class_not_found' });
      return;
    }
    const created: string[] = [];
    const now = nowIso();
    withTransaction(db, () => {
      for (const item of items.slice(0, 200)) {
        const title = String(item.title ?? '').trim();
        const stem = String(item.stem ?? '').trim();
        const type = String(item.type ?? 'bool');
        if (!title || !stem) continue;
        if (!['single', 'multi', 'bool', 'blank'].includes(type)) continue;
        const qid = newId();
        db.prepare(
          `INSERT INTO questions
            (id, class_id, title, stem, type, answer_key, points, attachments, created_by, created_at, published, closed_at, closes_at, archived)
           VALUES (?, ?, ?, ?, ?, ?, 1, '[]', ?, ?, ?, NULL, NULL, 0)`,
        ).run(
          qid,
          classId,
          title.slice(0, 200),
          stem.slice(0, 4000),
          type,
          item.answerKey != null ? String(item.answerKey) : null,
          req.user!.id,
          now,
          publish ? 1 : 0,
        );
        const opts = item.options ?? [];
        if (type === 'bool' && opts.length === 0) {
          db.prepare(
            `INSERT INTO question_options (id, question_id, label, content, is_correct) VALUES (?, ?, 'A', '正确', ?)`,
          ).run(newId(), qid, 1);
          db.prepare(
            `INSERT INTO question_options (id, question_id, label, content, is_correct) VALUES (?, ?, 'B', '错误', ?)`,
          ).run(newId(), qid, 0);
        } else {
          for (const o of opts.slice(0, 12)) {
            db.prepare(
              `INSERT INTO question_options (id, question_id, label, content, is_correct) VALUES (?, ?, ?, ?, ?)`,
            ).run(
              newId(),
              qid,
              String(o.label || 'A').slice(0, 8),
              String(o.text || '').slice(0, 500),
              o.isCorrect ? 1 : 0,
            );
          }
        }
        created.push(qid);
      }
    });
    res.status(201).json({ ok: true, created: created.length, ids: created });
  },
);

/** Build a retry pack from high-error questions and publish as new copies. */
packsRouter.post(
  '/api/v1/packs/from-errors',
  requireAuth,
  requireRoles('teacher', 'admin'),
  (req: AuthedRequest, res) => {
    const classId = String(req.body?.classId ?? '').trim();
    const limit = Math.min(40, Math.max(1, Number(req.body?.limit ?? 10) || 10));
    if (!classId) {
      res.status(400).json({ error: 'class_id_required' });
      return;
    }
    const db = openDb();
    const rows = db
      .prepare(
        `SELECT q.id, q.title, q.stem, q.type, q.answer_key AS answerKey
         FROM questions q
         JOIN error_stats e ON e.question_id = q.id
         WHERE q.class_id = ? AND (q.deleted_at IS NULL OR q.deleted_at = '')
           AND e.answered_count > 0
         ORDER BY (1.0 * e.wrong_count / e.answered_count) DESC
         LIMIT ?`,
      )
      .all(classId, limit) as Array<{
      id: string;
      title: string;
      stem: string;
      type: string;
      answerKey: string | null;
    }>;
    const items: PackQuestion[] = rows.map((q) => {
      const options = db
        .prepare(
          `SELECT label, content AS text, is_correct AS isCorrect FROM question_options WHERE question_id = ?`,
        )
        .all(q.id) as Array<{ label: string; text: string; isCorrect: number }>;
      return {
        title: `[错题再练] ${q.title}`,
        stem: q.stem,
        type: q.type as PackQuestion['type'],
        answerKey: q.answerKey,
        options: options.map((o) => ({
          label: o.label,
          text: o.text,
          isCorrect: Boolean(o.isCorrect),
        })),
        chapter: 'error-retry',
      };
    });
    res.json({ pack: { format: 'classroom-desk-question-pack', version: 1, items } });
  },
);
