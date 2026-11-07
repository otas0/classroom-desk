import { Router } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { openDb } from '../db/client.js';
import { requireAuth, requireRoles, type AuthedRequest } from '../middleware/auth.js';
import { currentMonth, localMonthRange } from '../utils/csv.js';
import { newId, nowIso } from '../utils/id.js';
import { buildParentReportPdf } from '../utils/cjkPdf.js';

export const reportsRouter = Router();

function tokenHash(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

reportsRouter.post(
  '/api/v1/reports/parent-month',
  requireAuth,
  requireRoles('teacher', 'admin'),
  (req: AuthedRequest, res) => {
    const classId = String(req.body?.classId ?? '').trim();
    const month = String(req.body?.month ?? currentMonth()).trim();
    if (!classId) {
      res.status(400).json({ error: 'class_id_required' });
      return;
    }
    try {
      localMonthRange(month);
    } catch {
      res.status(400).json({ error: 'invalid_month' });
      return;
    }
    const raw = randomBytes(18).toString('base64url');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const id = newId();
    openDb()
      .prepare(
        `INSERT INTO parent_report_tokens (id, class_id, month, token, created_by, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, classId, month, tokenHash(raw), req.user!.id, expiresAt, nowIso());
    const host = req.get('host') || '127.0.0.1:8787';
    const proto = req.protocol || 'http';
    const url = `${proto}://${host}/r/${raw}`;
    res.status(201).json({
      id,
      month,
      classId,
      expiresAt,
      token: raw,
      url,
      note: '分享码 7 天有效；无需登录。请只发给本班家长/教务。',
    });
  },
);

/** Public HTML/JSON/PDF parent monthly summary — no auth. */
reportsRouter.get('/api/v1/reports/parent/:token', async (req, res) => {
  const raw = String(req.params.token ?? '').trim();
  if (!raw) {
    res.status(400).json({ error: 'token_required' });
    return;
  }
  const db = openDb();
  const row = db
    .prepare(
      `SELECT t.class_id AS classId, t.month, t.expires_at AS expiresAt, c.name AS className
       FROM parent_report_tokens t
       JOIN classes c ON c.id = t.class_id
       WHERE t.token = ?`,
    )
    .get(tokenHash(raw)) as
    | { classId: string; month: string; expiresAt: string; className: string }
    | undefined;
  if (!row) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  if (Date.parse(row.expiresAt) < Date.now()) {
    res.status(410).json({ error: 'expired', message: '分享码已过期（7 天）' });
    return;
  }
  let range: { start: string; end: string };
  try {
    range = localMonthRange(row.month);
  } catch {
    res.status(400).json({ error: 'invalid_month' });
    return;
  }

  const points = db
    .prepare(
      `SELECT u.display_name AS displayName, u.student_no AS studentNo,
              COALESCE(SUM(pl.points), 0) AS monthPoints, u.total_points AS totalPoints
       FROM users u
       LEFT JOIN points_log pl
         ON pl.student_id = u.id AND pl.class_id = u.class_id
        AND pl.created_at >= ? AND pl.created_at < ?
       WHERE u.role = 'student' AND u.class_id = ?
         AND (u.deleted_at IS NULL OR u.deleted_at = '')
       GROUP BY u.id
       ORDER BY monthPoints DESC, u.student_no`,
    )
    .all(range.start, range.end, row.classId) as Array<{
    displayName: string;
    studentNo: string | null;
    monthPoints: number;
    totalPoints: number;
  }>;

  const sessions = db
    .prepare(
      `SELECT COUNT(*) AS n FROM attendance_sessions
       WHERE class_id = ? AND start_at >= ? AND start_at < ?`,
    )
    .get(row.classId, range.start, range.end) as { n: number };

  const attendance = db
    .prepare(
      `SELECT u.display_name AS displayName, u.student_no AS studentNo,
              COUNT(CASE WHEN ar.status IN ('present','late') THEN 1 END) AS presentCount
       FROM users u
       LEFT JOIN attendance_records ar ON ar.student_id = u.id
       LEFT JOIN attendance_sessions s ON s.id = ar.session_id AND s.class_id = u.class_id
         AND s.start_at >= ? AND s.start_at < ?
       WHERE u.role = 'student' AND u.class_id = ?
         AND (u.deleted_at IS NULL OR u.deleted_at = '')
       GROUP BY u.id
       ORDER BY u.student_no`,
    )
    .all(range.start, range.end, row.classId) as Array<{
    displayName: string;
    studentNo: string | null;
    presentCount: number;
  }>;

  const payload = {
    className: row.className,
    month: row.month,
    expiresAt: row.expiresAt,
    sessionCount: sessions.n,
    points,
    attendance,
  };

  if (String(req.query.format ?? '') === 'json') {
    res.json(payload);
    return;
  }

  if (String(req.query.format ?? '') === 'pdf') {
    const pdf = await buildParentReportPdf({
      title: `${row.className} ${row.month} 月报`,
      subtitle: `场次 ${sessions.n} · 过期 ${row.expiresAt}`,
      headers: ['学号', '姓名', '本月', '累计', '出勤'],
      rows: points.map((p) => {
        const att = attendance.find(
          (a) => a.displayName === p.displayName && a.studentNo === p.studentNo,
        );
        return [
          p.studentNo ?? '',
          p.displayName,
          String(p.monthPoints),
          String(p.totalPoints),
          att ? `${att.presentCount}/${sessions.n}` : '',
        ];
      }),
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="parent-report-${row.month}.pdf"`,
    );
    res.send(pdf);
    return;
  }

  const rowsPts = points
    .map(
      (p) =>
        `<tr><td>${escapeHtml(p.studentNo ?? '')}</td><td>${escapeHtml(p.displayName)}</td><td>${p.monthPoints}</td><td>${p.totalPoints}</td></tr>`,
    )
    .join('');
  const rowsAtt = attendance
    .map((a) => {
      const rate = sessions.n > 0 ? ((a.presentCount / sessions.n) * 100).toFixed(0) : '—';
      return `<tr><td>${escapeHtml(a.studentNo ?? '')}</td><td>${escapeHtml(a.displayName)}</td><td>${a.presentCount}/${sessions.n}</td><td>${rate}%</td></tr>`;
    })
    .join('');

  res.type('html').send(`<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"/><title>${escapeHtml(row.className)} · ${escapeHtml(row.month)} 月报</title>
<style>body{font-family:system-ui,sans-serif;max-width:820px;margin:24px auto;padding:0 16px;color:#1a2332}table{border-collapse:collapse;width:100%;margin:12px 0}th,td{border-bottom:1px solid #ccc;padding:8px;text-align:left}h1{font-size:1.4rem}.meta{color:#5a6575;font-size:.9rem}</style></head>
<body>
<h1>${escapeHtml(row.className)} · ${escapeHtml(row.month)} 月报</h1>
<p class="meta">只读分享 · 过期 ${escapeHtml(row.expiresAt)} · 场次 ${sessions.n}</p>
<h2>积分</h2>
<table><thead><tr><th>学号</th><th>姓名</th><th>本月</th><th>累计</th></tr></thead><tbody>${rowsPts}</tbody></table>
<h2>出勤</h2>
<table><thead><tr><th>学号</th><th>姓名</th><th>出勤</th><th>出勤率</th></tr></thead><tbody>${rowsAtt}</tbody></table>
<p class="meta">Classroom Desk · 请勿转发到公网无关渠道</p>
</body></html>`);
});

/** Pretty URL alias used in share links. */
reportsRouter.get('/r/:token', (req, res) => {
  res.redirect(302, `/api/v1/reports/parent/${encodeURIComponent(String(req.params.token))}?format=html`);
});

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
