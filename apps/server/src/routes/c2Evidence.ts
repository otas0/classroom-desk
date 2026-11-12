/**
 * Teacher-facing C2 evidence folder status (server machine local 证据/).
 * Does not invent recordings — reports missing/stub files only.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { fileURLToPath } from 'node:url';
import { requireAuth, requireRoles, type AuthedRequest } from '../middleware/auth.js';

export const c2EvidenceRouter = Router();

const REQUIRED = [
  'C2-intune-version.txt',
  'C2-alttab-win.mp4',
  'C2-taskmgr-deny.mp4',
  'C2-titlebar.png',
  'C2-intune-policy.png',
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

c2EvidenceRouter.get(
  '/api/v1/c2-evidence/status',
  requireAuth,
  requireRoles('teacher', 'admin', 'assistant'),
  (_req: AuthedRequest, res) => {
    const base = evidenceRoot();
    const dir = latestDayDir(base);
    if (!dir) {
      res.json({
        ok: false,
        base,
        dir: null,
        problems: ['no_evidence_dir', 'run: npm run init:c2-evidence'],
        files: [],
        complete: false,
        runbook: '/docs/C2_OPERATOR_RUNBOOK.md',
        verifyCmd: 'npm run verify:c2-evidence',
      });
      return;
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
    res.json({
      ok: problems.length === 0,
      base,
      dir,
      problems,
      files,
      complete: problems.length === 0,
      runbook: 'docs/C2_OPERATOR_RUNBOOK.md',
      verifyCmd: 'npm run verify:c2-evidence',
    });
  },
);
