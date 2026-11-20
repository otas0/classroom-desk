import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { encodeRoomCode } from '@classroom-desk/shared';
import { getDataDir, openDb } from '../db/client.js';
import { getSetting } from '../db/migrate.js';
import { config } from '../config.js';
import { joinAttachGateActive, joinPinRequired } from './joinAuth.js';
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
  return [...new Set(dirs.filter((d) => d && fs.existsSync(path.dirname(d))))];
}

export type StudentClassroomConfigFile = {
  format: 'classroom-desk-config';
  version: 1;
  apiBase: string;
  classId: string;
  className: string | null;
  displayName: string | null;
  roomCode: string | null;
  easyJoin: true;
  writtenAt: string;
};

/**
 * Non-secret LAN join config (Public Desktop + /upgrades/ for students on campus net).
 * Omitted when PIN/device-approval would hide classId.
 */
export function buildStudentClassroomConfig(): StudentClassroomConfigFile | null {
  const db = openDb();
  const enabled = (getSetting(db, 'student_easy_join') ?? '0') === '1';
  const classId = String(getSetting(db, 'student_easy_join_class_id') ?? '').trim();
  if (!enabled || !classId) return null;
  if (joinAttachGateActive(db)) return null;
  const ips = orderedLanIpsForAdvertise(db);
  const ip = ips[0];
  if (!ip) return null;
  const apiBase = `http://${ip}:${config.port}`;
  const row = db.prepare(`SELECT name FROM classes WHERE id = ?`).get(classId) as
    | { name?: string }
    | undefined;
  const displayName = String(getSetting(db, 'classroom_display_name') ?? '').trim();
  return {
    format: 'classroom-desk-config',
    version: 1,
    apiBase,
    classId,
    className: String(row?.name ?? '').trim() || null,
    displayName: displayName || null,
    roomCode: encodeRoomCode(ip),
    easyJoin: true,
    writtenAt: new Date().toISOString(),
  };
}

/** Non-secret student install tips — campus-net first: room code + primary IP. */
export function buildStudentInstallCardText(): string {
  const db = openDb();
  const ips = orderedLanIpsForAdvertise(db);
  const setups = listSetupNames();
  const setup = preferredSetupName(setups);
  const ip = ips[0] ?? '';
  const port = config.port;
  const room = ip ? encodeRoomCode(ip) : null;
  const lines = ['Classroom Desk — student install (campus net)', ''];

  if (ip) {
    lines.push(`Teacher LAN IP (primary):  ${ip}`);
    if (room) lines.push(`Room code (if Find fails):  ${room}`);
    lines.push('');
  }

  if (setup && ip) {
    lines.push('1) Install (same LAN as teacher — not guest Wi-Fi isolation):');
    lines.push(`  http://${ip}:${port}/upgrades/${setup}`);
    lines.push(`  Config (auto-join): http://${ip}:${port}/upgrades/classroom-desk-config.json`);
    if (ips.length > 1) {
      lines.push('');
      lines.push('If that IP fails (wrong NIC), try:');
      for (const alt of ips.slice(1, 4)) {
        const altRoom = encodeRoomCode(alt);
        lines.push(`  http://${alt}:${port}/upgrades/${setup}`);
        if (altRoom) lines.push(`  room ${altRoom}`);
      }
    }
  } else if (setup) {
    lines.push('Teacher LAN IP unknown — plug Ethernet, set 广播 IP in Admin.');
    lines.push(`File on teacher: ${path.join(upgradesDir(), setup)}`);
  } else {
    lines.push('No student Setup on teacher yet.');
    lines.push('Admin → 学生机升级包 → sync/upload, or re-run Teacher-Setup.');
  }

  lines.push('');
  lines.push('2) Open the app → it auto-joins, or paste room code / teacher IP.');
  lines.push('3) Tap your name.');
  lines.push('');
  lines.push('Campus Wi-Fi cannot reach teacher?');
  lines.push('  - Use lab Ethernet / non-guest SSID (not 访客网)');
  lines.push('  - IT must allow student → teacher TCP 8787 (AP isolation OFF)');
  lines.push('  - Teacher: Admin → 广播 IP = the IP students can ping');
  if (joinPinRequired(db)) {
    lines.push('(Join PIN required — ask teacher)');
  }
  lines.push(`Refreshed: ${new Date().toISOString()}`);
  return lines.join('\r\n');
}

function writeConfigEverywhere(cfg: StudentClassroomConfigFile | null): string[] {
  const wrote: string[] = [];
  const body = cfg ? JSON.stringify(cfg, null, 2) : '';
  const targets: string[] = [];
  for (const d of publicDesktopDirs()) {
    targets.push(path.join(d, 'classroom-desk-config.json'));
  }
  // Students download Setup from /upgrades/ — same folder must carry join config.
  try {
    fs.mkdirSync(upgradesDir(), { recursive: true });
    targets.push(path.join(upgradesDir(), 'classroom-desk-config.json'));
  } catch {
    /* ignore */
  }
  for (const p of targets) {
    try {
      if (cfg) {
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, body, 'utf8');
        wrote.push(p);
      } else if (fs.existsSync(p)) {
        fs.rmSync(p);
      }
    } catch {
      /* SYSTEM may lack some desktops */
    }
  }
  return wrote;
}

export function refreshStudentInstallCardFiles(): { wrote: string[] } {
  const text = buildStudentInstallCardText();
  const cfg = buildStudentClassroomConfig();
  const wrote: string[] = writeConfigEverywhere(cfg);
  for (const d of publicDesktopDirs()) {
    try {
      fs.mkdirSync(d, { recursive: true });
      const p = path.join(d, 'ClassroomDesk-Student-Install.txt');
      fs.writeFileSync(p, text, 'utf8');
      wrote.push(p);
    } catch {
      /* ignore */
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
  roomCode: string | null;
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
  const room = ips[0] ? encodeRoomCode(ips[0]) : null;
  const lines = [
    'Classroom Desk — lesson pack',
    '',
    `Class: ${cls?.name ?? classId}`,
    cls?.classCode ? `Class code: ${cls.classCode}` : '',
    ips[0] ? `Teacher IP: ${ips[0]}` : '',
    room ? `Room code: ${room}` : '',
    pinNeeded ? 'Join PIN: required (Admin — not printed)' : '',
    '',
    'Student install (open one):',
    ...(preferredUrls.length ? preferredUrls.map((u) => `  ${u}`) : ['  (no Setup / LAN IP yet)']),
    '',
    'Then: open app → tap your name (or paste room code / IP)',
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
    roomCode: room,
    healthUrl: 'http://127.0.0.1:8787/health',
    adminUrl: 'http://127.0.0.1:8787/admin/',
    joinPinRequired: pinNeeded,
    text: lines.join('\r\n'),
  };
}
