/**
 * Apply GitHub Release tag to the teacher host checkout, then schedule process restart.
 * Preserves apps/server/data and .env. Opt-out: CLASSROOM_DESK_TEACHER_SELF_UPDATE=0
 */
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDataDir } from '../db/client.js';

function findRepoRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    if (
      fs.existsSync(path.join(dir, 'package.json')) &&
      fs.existsSync(path.join(dir, 'apps', 'server'))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
}

const repoRoot = findRepoRoot();

export function teacherSelfUpdateEnabled(): boolean {
  const v = String(process.env.CLASSROOM_DESK_TEACHER_SELF_UPDATE ?? '1').trim().toLowerCase();
  return v !== '0' && v !== 'false' && v !== 'off';
}

function run(cmd: string, args: string[], cwd = repoRoot): { ok: boolean; out: string } {
  const r = spawnSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    env: process.env,
    timeout: 15 * 60 * 1000,
  });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.slice(0, 4000);
  return { ok: r.status === 0, out };
}

function isGitCheckout(): boolean {
  return fs.existsSync(path.join(repoRoot, '.git'));
}

function normalizeTag(tag: string): string {
  const t = String(tag ?? '').trim();
  if (!t) return '';
  return t.startsWith('v') ? t : `v${t}`;
}

/** Exclude live data / secrets when overlaying a zipball. */
const OVERLAY_SKIP = new Set([
  'node_modules',
  '.git',
  '证据',
  'artifacts',
  'playwright-report',
  'test-results',
]);

function shouldSkipOverlayRel(rel: string): boolean {
  const parts = rel.split(/[/\\]/);
  if (parts.some((p) => OVERLAY_SKIP.has(p))) return true;
  if (rel === '.env' || rel.endsWith(`${path.sep}.env`)) return true;
  if (rel.includes(`${path.sep}apps${path.sep}server${path.sep}data${path.sep}`)) return true;
  if (rel.startsWith(`apps${path.sep}server${path.sep}data${path.sep}`)) return true;
  return false;
}

async function downloadZipball(tag: string, destZip: string): Promise<void> {
  const repo = process.env.CLASSROOM_DESK_GITHUB_REPO || 'otas0/classroom-desk';
  const url = `https://github.com/${repo}/archive/refs/tags/${encodeURIComponent(tag)}.zip`;
  const headers: Record<string, string> = {
    'User-Agent': 'classroom-desk-teacher-host',
    Accept: 'application/octet-stream',
  };
  const token = String(process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '').trim();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { headers, redirect: 'follow' });
  if (!res.ok) throw new Error(`zipball_http_${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(destZip), { recursive: true });
  fs.writeFileSync(destZip, buf);
}

function extractZipballOverlay(zipPath: string): void {
  const tmp = path.join(getDataDir(), `host-update-${Date.now()}`);
  fs.mkdirSync(tmp, { recursive: true });
  try {
    if (process.platform === 'win32') {
      const ps = spawnSync(
        'powershell',
        [
          '-NoProfile',
          '-Command',
          `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${tmp.replace(/'/g, "''")}' -Force`,
        ],
        { encoding: 'utf8', timeout: 120_000 },
      );
      if (ps.status !== 0) throw new Error(`expand_archive_failed:${ps.stderr || ps.stdout}`);
    } else {
      const u = spawnSync('unzip', ['-q', '-o', zipPath, '-d', tmp], { encoding: 'utf8' });
      if (u.status !== 0) throw new Error(`unzip_failed:${u.stderr || u.stdout}`);
    }
    const entries = fs.readdirSync(tmp);
    const top = entries.map((e) => path.join(tmp, e)).find((p) => fs.statSync(p).isDirectory());
    if (!top) throw new Error('zipball_empty');
    const walk = (dir: string, base: string) => {
      for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        const rel = path.relative(base, full);
        if (shouldSkipOverlayRel(rel)) continue;
        const dest = path.join(repoRoot, rel);
        if (fs.statSync(full).isDirectory()) {
          fs.mkdirSync(dest, { recursive: true });
          walk(full, base);
        } else {
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.copyFileSync(full, dest);
        }
      }
    };
    walk(top, top);
  } finally {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

export type TeacherHostUpdateResult = {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  tag?: string;
  method?: 'git' | 'zipball';
  steps?: string[];
  restartScheduled?: boolean;
  detail?: string;
};

/**
 * Checkout/overlay release tag + rebuild teacher UI. Does not exit the process.
 */
export async function applyTeacherHostCodeUpdate(tagRaw: string): Promise<TeacherHostUpdateResult> {
  if (!teacherSelfUpdateEnabled()) {
    return { ok: true, skipped: true, reason: 'self_update_disabled' };
  }
  const tag = normalizeTag(tagRaw);
  if (!tag) return { ok: false, reason: 'missing_tag' };

  const steps: string[] = [];
  let method: 'git' | 'zipball' = 'git';

  if (isGitCheckout()) {
    steps.push('git_fetch');
    let r = run('git', ['fetch', '--tags', '--force', 'origin']);
    if (!r.ok) {
      // local-only tags / no origin — try fetch all
      r = run('git', ['fetch', '--tags', '--force']);
    }
    steps.push('git_checkout');
    r = run('git', ['checkout', '--force', tag]);
    if (!r.ok) {
      // fallback zipball
      method = 'zipball';
      steps.push('git_checkout_failed_fallback_zip');
    }
  } else {
    method = 'zipball';
  }

  if (method === 'zipball') {
    const zip = path.join(getDataDir(), `classroom-desk-${tag}.zip`);
    steps.push('download_zipball');
    await downloadZipball(tag, zip);
    steps.push('overlay_zipball');
    extractZipballOverlay(zip);
    try {
      fs.unlinkSync(zip);
    } catch {
      /* ignore */
    }
  }

  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  steps.push('npm_ci');
  let r = run(npm, ['ci']);
  if (!r.ok) {
    steps.push('npm_install_fallback');
    r = run(npm, ['install']);
    if (!r.ok) {
      return { ok: false, tag, method, steps, detail: r.out.slice(0, 1500) };
    }
  }

  const font = path.join(repoRoot, 'apps/server/assets/fonts/NotoSansSC-VF.ttf');
  if (!fs.existsSync(font)) {
    steps.push('fonts_cjk');
    run(npm, ['run', 'fonts:cjk']);
  }

  steps.push('build_teacher');
  r = run(npm, ['run', 'build:teacher']);
  if (!r.ok) {
    return { ok: false, tag, method, steps, detail: r.out.slice(0, 1500) };
  }

  return { ok: true, tag, method, steps };
}

/**
 * Spawn detached restart helper and exit this process shortly after HTTP responds.
 */
export function scheduleTeacherHostRestart(opts?: { delayMs?: number }): {
  restartScheduled: boolean;
  pid: number;
  helper?: number;
} {
  if (!teacherSelfUpdateEnabled()) {
    return { restartScheduled: false, pid: process.pid };
  }
  const delayMs = Math.max(800, opts?.delayMs ?? 2000);
  const helper = path.join(repoRoot, 'scripts/teacher-host-restart.mjs');
  const child = spawn(
    process.execPath,
    [helper, '--pid', String(process.pid), '--port', String(process.env.PORT || 8787), '--delay-ms', String(delayMs)],
    {
      cwd: repoRoot,
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, HOST: process.env.HOST || '0.0.0.0' },
      windowsHide: true,
    },
  );
  child.unref();
  return { restartScheduled: true, pid: process.pid, helper: child.pid ?? undefined };
}
