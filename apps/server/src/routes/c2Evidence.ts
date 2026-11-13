/**
 * Teacher-facing C2 evidence folder status (server machine local 证据/).
 * Does not invent recordings — reports missing/stub files only.
 * Acceptance PDF: SCHOOL_ACCEPTANCE slots + live C2 folder status (#16 doc slot; PDF here).
 */
import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { fileURLToPath } from 'node:url';
import { requireAuth, requireRoles, type AuthedRequest } from '../middleware/auth.js';
import { buildParentReportPdf } from '../utils/cjkPdf.js';
import { writeAudit } from '../services/audit.js';
import { productCapabilities } from '../services/portalAuth.js';
import { nowIso } from '../utils/id.js';

export const c2EvidenceRouter = Router();

const REQUIRED = [
  'C2-intune-version.txt',
  'C2-alttab-win.mp4',
  'C2-taskmgr-deny.mp4',
  'C2-titlebar.png',
  'C2-intune-policy.png',
];

/** Pilot SCHOOL_ACCEPTANCE.md slots (status filled live; gateway rows stay SKIPPED without creds). */
const ACCEPTANCE_SLOTS: Array<{ evidence: string; sku: string; needsCreds?: boolean }> = [
  { evidence: '教师 Web + labAgent 深锁演示（冻结/仅试卷/下课）', sku: '机房包' },
  { evidence: '门户 admit + 花名册', sku: '校园网包' },
  { evidence: 'DeskDNS 绑定与课策略回落', sku: '单网校包' },
  { evidence: 'OPNsense 或 UniFi live-shield 脱敏包', sku: '校园网包', needsCreds: true },
  { evidence: 'openNDS allow / deny / FAS 三张图', sku: '考场 compose / 开放网关', needsCreds: true },
  { evidence: 'Exam Box compose api-ready 宕机退出', sku: '考场 compose' },
  { evidence: 'Cosign 验签（digest 见 EXAM_BOX.md）', sku: '考场 compose' },
  { evidence: 'C2 / Intune 证据槽（若学校机考试锁）', sku: '机房包' },
];

function evidenceRoot(): string {
  return (
    process.env.CD_EVIDENCE_DIR ||
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../证据')
  );
}

function latestDayDir(base: string): string | null {
  if (!fs.existsSync(base)) return null;
  const days = fs
    .readdirSync(base)
    .filter((n) => /^C2-\d{8}$/.test(n))
    .sort();
  return days.length ? path.join(base, days[days.length - 1]!) : null;
}

function collectEvidenceStatus() {
  const base = evidenceRoot();
  const dir = latestDayDir(base);
  if (!dir) {
    return {
      ok: false,
      base,
      dir: null as string | null,
      problems: ['no_evidence_dir', 'run: npm run init:c2-evidence'],
      files: [] as Array<{ name: string; exists: boolean; size: number }>,
      complete: false,
      runbook: '/docs/C2_OPERATOR_RUNBOOK.md',
      verifyCmd: 'npm run verify:c2-evidence',
    };
  }
  const problems: string[] = [];
  if (fs.existsSync(path.join(dir, 'C2-alttab-win.mp4.PLACEHOLDER'))) {
    problems.push('C2-alttab-win.mp4.PLACEHOLDER still present');
  }
  const files = REQUIRED.map((name) => {
    const p = path.join(dir, name);
    const exists = fs.existsSync(p);
    const size = exists ? fs.statSync(p).size : 0;
    if (!exists) problems.push(`missing ${name}`);
    else if (size < 32) problems.push(`${name} too small`);
    else if (name.endsWith('.mp4') && size < 50_000) problems.push(`${name} looks like stub`);
    return { name, exists, size };
  });
  return {
    ok: problems.length === 0,
    base,
    dir,
    problems,
    files,
    complete: problems.length === 0,
    runbook: 'docs/C2_OPERATOR_RUNBOOK.md',
    verifyCmd: 'npm run verify:c2-evidence',
  };
}

c2EvidenceRouter.get(
  '/api/v1/c2-evidence/status',
  requireAuth,
  requireRoles('teacher', 'admin', 'assistant'),
  (_req: AuthedRequest, res) => {
    res.json(collectEvidenceStatus());
  },
);

c2EvidenceRouter.get(
  '/api/v1/c2-evidence/acceptance.pdf',
  requireAuth,
  requireRoles('teacher', 'admin'),
  async (req: AuthedRequest, res) => {
    const status = collectEvidenceStatus();
    const caps = productCapabilities();
    const rows: string[][] = ACCEPTANCE_SLOTS.map((slot) => {
      let mark = '□ 待勾';
      if (slot.needsCreds) mark = '⊘ SKIPPED（需学校凭据）';
      else if (slot.evidence.startsWith('C2') && status.complete) mark = '☑ 证据夹已齐';
      else if (slot.evidence.startsWith('C2') && !status.complete) mark = '□ C2 未齐';
      else if (slot.evidence.includes('Exam Box') && caps.examBoxHardware === false) {
        mark = '⊘ 非硬件 SKU（examBoxHardware=false）';
      }
      return [mark, slot.evidence, slot.sku];
    });

    for (const f of status.files) {
      rows.push([
        f.exists && f.size >= 32 ? '☑' : '□',
        f.name,
        f.exists ? `${f.size} B` : 'missing',
      ]);
    }
    for (const p of status.problems.slice(0, 12)) {
      rows.push(['!', p, '']);
    }

    const pdf = await buildParentReportPdf({
      title: '学校验收证据清单（Pilot）',
      subtitle: `导出 ${nowIso()} · C2 目录 ${status.dir ?? '（无）'} · complete=${status.complete}`,
      headers: ['状态', '证据项', '适用包 / 备注'],
      rows,
    });

    writeAudit({
      actorUserId: req.user?.id ?? null,
      actorRole: req.user?.role ?? 'teacher',
      action: 'c2.acceptance_pdf',
      detail: {
        complete: status.complete,
        dir: status.dir,
        problemCount: status.problems.length,
        bytes: pdf.length,
      },
    });

    const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="school-acceptance-C2-${day}.pdf"`,
    );
    res.send(pdf);
  },
);
