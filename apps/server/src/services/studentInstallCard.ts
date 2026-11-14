import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getDataDir, openDb } from '../db/client.js';
import { config } from '../config.js';
import { joinPinRequired } from './joinAuth.js';
import { orderedLanIpsForAdvertise } from './lanNetwork.js';

function upgradesDir(): string {
  return process.env.CLASSROOM_DESK_UPGRADES_DIR
    ? path.resolve(process.env.CLASSROOM_DESK_UPGRADES_DIR)
    : path.join(getDataDir(), 'upgrades');
}

function listSetupNames(): string[] {
  const dir = upgradesDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((n) => /^ClassroomDesk-Setup-.*\.exe$/i.test(n) || /^Student-Setup\.exe$/i.test(n))
    .sort();
}

/** Prefer canonical versioned x64 Setup for the one-line install card. */
function preferredSetupName(names: string[]): string | null {
  if (!names.length) return null;
  const x64 = names.find((n) => /-x64\.exe$/i.test(n));
  if (x64) return x64;
  const canon = names.find((n) => /^ClassroomDesk-Setup-/i.test(n));
  return canon || names[0] || null;
}

function publicDesktopDirs(): string[] {
  const dirs: string[] = [];
  if (process.platform === 'win32') {
    const pub = process.env.PUBLIC || 'C:\\Users\\Public';
    dirs.push(path.join(pub, 'Desktop'));
  }
  const home = os.homedir();
  if (home) dirs.push(path.join(home, 'Desktop'));
  return [...new Set(dirs.filter((d) => d && fs.existsSync(d)))];
}

/** Non-secret student install tips — one preferred URL; safe for Public Desktop. */
export function buildStudentInstallCardText(): string {
  const db = openDb();
  const ips = orderedLanIpsForAdvertise(db);
  const setups = listSetupNames();
  const setup = preferredSetupName(setups);
  const ip = ips[0] ?? '';
  const port = config.port;
  const lines = ['Classroom Desk — student install', ''];
  if (setup && ip) {
    lines.push('Open this link on the student PC (same LAN as teacher):');
    lines.push(`  http://${ip}:${port}/upgrades/${setup}`);
    if (ips.length > 1) {
      lines.push('');
      lines.push('If that fails, try:');
      for (const alt of ips.slice(1, 4)) {
        lines.push(`  http://${alt}:${port}/upgrades/${setup}`);
      }
    }
  } else if (setup) {
    lines.push('Teacher LAN IP unknown — check cable.');
    lines.push(`File on teacher: ${path.join(upgradesDir(), setup)}`);
  } else {
    lines.push('No student Setup on teacher yet.');
    lines.push('Admin → 学生机升级包 → sync/upload, or re-run Teacher-Setup.');
  }
  lines.push('');
  lines.push('SmartScreen? More info → Run anyway');
  lines.push('Then: Find classroom');
  if (joinPinRequired(db)) {
    lines.push('(Join PIN required — ask teacher)');
  }
  lines.push(`Refreshed: ${new Date().toISOString()}`);
  return lines.join('\r\n');
}

export function refreshStudentInstallCardFiles(): { wrote: string[] } {
  const text = buildStudentInstallCardText();
  const wrote: string[] = [];
  for (const d of publicDesktopDirs()) {
    try {
      const p = path.join(d, 'ClassroomDesk-Student-Install.txt');
      fs.writeFileSync(p, text, 'utf8');
      wrote.push(p);
    } catch {
      /* SYSTEM may lack some desktops */
    }
  }
  return { wrote };
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startStudentInstallCardRefresh(intervalMs = 60_000): void {
  try {
    refreshStudentInstallCardFiles();
  } catch (e) {
    console.warn('[student-install-card] initial refresh failed', e);
  }
  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    try {
      refreshStudentInstallCardFiles();
    } catch {
      /* ignore */
    }
  }, intervalMs);
  if (typeof timer === 'object' && 'unref' in timer) timer.unref();
}

export function stopStudentInstallCardRefresh(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

export type LessonPack = {
  format: 'classroom-desk-lesson-pack';
  version: 1;
  exportedAt: string;
  classId: string;
  className: string | null;
  classCode: string | null;
  advertiseLanIp: string | null;
  lanIps: string[];
  apiBases: string[];
  studentSetupNames: string[];
  studentSetupUrls: string[];
  healthUrl: string;
  adminUrl: string;
  joinPinRequired: boolean;
  text: string;
};

export function buildLessonPack(classId: string): LessonPack {
  const db = openDb();
  const cls = db
    .prepare(`SELECT id, name, class_code AS classCode FROM classes WHERE id = ?`)
    .get(classId) as { id: string; name: string; classCode: string } | undefined;
  const ips = orderedLanIpsForAdvertise(db);
  const setups = listSetupNames();
  const setup = preferredSetupName(setups);
  const port = config.port;
  const apiBases = ips.map((ip) => `http://${ip}:${port}`);
  const preferredUrls =
    setup && ips.length
      ? ips.slice(0, 3).map((ip) => `http://${ip}:${port}/upgrades/${setup}`)
      : [];
  const pinNeeded = joinPinRequired(db);
  const lines = [
    'Classroom Desk — lesson pack',
    '',
    `Class: ${cls?.name ?? classId}`,
    cls?.classCode ? `Class code: ${cls.classCode}` : '',
    pinNeeded ? 'Join PIN: required (Admin — not printed)' : '',
    '',
    'Student install (open one):',
    ...(preferredUrls.length ? preferredUrls.map((u) => `  ${u}`) : ['  (no Setup / LAN IP yet)']),
    '',
    'Then: Find classroom',
    `Exported: ${new Date().toISOString()}`,
  ].filter(Boolean);

  return {
    format: 'classroom-desk-lesson-pack',
    version: 1,
    exportedAt: new Date().toISOString(),
    classId,
    className: cls?.name ?? null,
    classCode: cls?.classCode ?? null,
    advertiseLanIp: ips[0] ?? null,
    lanIps: ips,
    apiBases,
    studentSetupNames: setups,
    studentSetupUrls: preferredUrls,
    healthUrl: 'http://127.0.0.1:8787/health',
    adminUrl: 'http://127.0.0.1:8787/admin/',
    joinPinRequired: pinNeeded,
    text: lines.join('\r\n'),
  };
}
