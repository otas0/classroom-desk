import { app, BrowserWindow, globalShortcut, ipcMain, Menu, screen, session } from 'electron';
import bcrypt from 'bcryptjs';
import { execFile, spawn } from 'node:child_process';
import dns from 'node:dns';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';
import { promisify } from 'node:util';
import path from 'node:path';
import { loadConfig, saveConfig } from './configStore';

const execFileAsync = promisify(execFile);

const WINDOW_WIDTH = 380;
const WINDOW_HEIGHT = 560;
const COLLAPSED_HEIGHT = 56;
const MARGIN = 16;

let mainWindow: BrowserWindow | null = null;
let examShellWindow: BrowserWindow | null = null;
let blackoutWindows: BrowserWindow[] = [];
let focusStealTimer: ReturnType<typeof setInterval> | null = null;
let collapsed = false;
/** Teacher settings (via renderer): allow chip collapse / OS minimize. */
let allowCollapse = false;
let allowMinimize = false;
/** Deep-lock armed (freeze / exam allowlist / deny) — visible classroom policy. */
let deepLockAggressiveActive = false;
let deepLockFrozenActive = false;
/** Offline security-custody: full primary cover + persist until unlock code. */
let offlineCustodyActive = false;
/** When true, Chromium cancels navigations except teacher API / localhost. */
let custodyNetworkSeal = false;
let examAllowHosts: string[] = [];
/** Teacher device-control blocked hosts for openExternal. */
let blockedHostsCache: string[] = [];
/** Teacher blocked process names — merged into custody/deep-lock kill loops. */
let blockedAppsCache: string[] = [];
const registeredDeepLockShortcuts: string[] = [];
let custodyNetworkSealInstalled = false;

/**
 * Exit lock: after first successful teacher connect, students cannot close/quit
 * unless the teacher grants a timed unlock or 解除码. First-run / never bonded → exit OK.
 * Dev override: ALLOW_STUDENT_EXIT=1
 *
 * Note: OS Task Manager / kill -9 / Alt+Tab need school Assigned Access + Intune (L3).
 * This app does not hook Task Manager (see docs/SECURITY.md).
 */
let teacherBonded = false;
let exitUnlockGranted = false;
let exitAllowed = process.env.ALLOW_STUDENT_EXIT === '1';

function teacherBondPath(): string {
  return path.join(app.getPath('userData'), 'teacher-bond.json');
}

function offlineCustodyPath(): string {
  return path.join(app.getPath('userData'), 'offline-custody.json');
}

/** Windows ProgramData flag — survives userData wipe; still deletable by local admin without AA. */
function offlineCustodyProgramDataFlag(): string | null {
  if (process.platform !== 'win32') return null;
  const root = process.env.PROGRAMDATA || 'C:\\ProgramData';
  return path.join(root, 'ClassroomDesk', 'offline-custody.flag');
}

function loadOfflineCustodyFlag(): boolean {
  try {
    const raw = JSON.parse(fs.readFileSync(offlineCustodyPath(), 'utf8')) as { active?: boolean };
    if (Boolean(raw?.active)) return true;
  } catch {
    /* fall through */
  }
  try {
    const pd = offlineCustodyProgramDataFlag();
    if (pd && fs.existsSync(pd)) {
      const raw = JSON.parse(fs.readFileSync(pd, 'utf8')) as { active?: boolean };
      return Boolean(raw?.active);
    }
  } catch {
    /* ignore */
  }
  return false;
}

function persistOfflineCustodyFlag(active: boolean): void {
  const payload = JSON.stringify({ active, at: new Date().toISOString() }, null, 2);
  try {
    fs.mkdirSync(path.dirname(offlineCustodyPath()), { recursive: true });
    fs.writeFileSync(offlineCustodyPath(), payload, 'utf8');
  } catch {
    /* ignore */
  }
  const pd = offlineCustodyProgramDataFlag();
  if (!pd) return;
  try {
    fs.mkdirSync(path.dirname(pd), { recursive: true });
    if (active) {
      fs.writeFileSync(pd, payload, 'utf8');
    } else if (fs.existsSync(pd)) {
      fs.unlinkSync(pd);
    }
  } catch {
    /* ProgramData may require elevation — userData flag remains primary */
  }
}

/** Re-cover primary kiosk + secondary blackouts after display hotplug while custody is on. */
function refreshOfflineCustodyDisplays(): void {
  if (!offlineCustodyActive || !mainWindow || mainWindow.isDestroyed()) return;
  try {
    placeFullPrimary(mainWindow);
    openSecondaryBlackouts();
    mainWindow.setAlwaysOnTop(true, 'screen-saver');
    mainWindow.show();
    mainWindow.focus();
  } catch {
    /* ignore */
  }
}

function placeFullPrimary(win: BrowserWindow): void {
  const b = screen.getPrimaryDisplay().bounds;
  win.setBounds({ x: b.x, y: b.y, width: b.width, height: b.height });
}

function teacherApiAllowHosts(): string[] {
  const hosts = new Set<string>(['127.0.0.1', 'localhost']);
  try {
    const { apiBase } = loadConfig();
    const u = new URL(String(apiBase || ''));
    if (u.hostname) hosts.add(u.hostname.toLowerCase());
  } catch {
    /* ignore */
  }
  return [...hosts];
}

function installCustodyNetworkSealOnce(): void {
  if (custodyNetworkSealInstalled) return;
  custodyNetworkSealInstalled = true;
  try {
    session.defaultSession.webRequest.onBeforeRequest(
      { urls: ['http://*/*', 'https://*/*'] },
      (details, callback) => {
        if (!custodyNetworkSeal && !offlineCustodyActive) {
          callback({});
          return;
        }
        try {
          const u = new URL(details.url);
          const host = u.hostname.toLowerCase();
          const allow = teacherApiAllowHosts();
          if (allow.some((h) => host === h || host.endsWith(`.${h}`))) {
            callback({});
            return;
          }
        } catch {
          /* deny */
        }
        callback({ cancel: true });
      },
    );
  } catch {
    /* ignore */
  }
}

function loadTeacherBonded(): boolean {
  try {
    const raw = fs.readFileSync(teacherBondPath(), 'utf8');
    const parsed = JSON.parse(raw) as { bonded?: boolean };
    return Boolean(parsed?.bonded);
  } catch {
    return false;
  }
}

function persistTeacherBonded(): void {
  try {
    fs.mkdirSync(path.dirname(teacherBondPath()), { recursive: true });
    fs.writeFileSync(
      teacherBondPath(),
      JSON.stringify({ bonded: true, bondedAt: new Date().toISOString() }, null, 2),
      'utf8',
    );
  } catch {
    /* ignore */
  }
}

function recomputeExitAllowed(): boolean {
  exitAllowed =
    process.env.ALLOW_STUDENT_EXIT === '1' || !teacherBonded || exitUnlockGranted;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setClosable(exitAllowed);
  }
  return exitAllowed;
}

function placeBottomRight(win: BrowserWindow, height: number) {
  const display = screen.getPrimaryDisplay();
  const { workArea } = display;
  const x = Math.round(workArea.x + workArea.width - WINDOW_WIDTH - MARGIN);
  const y = Math.round(workArea.y + workArea.height - height - MARGIN);
  win.setBounds({ x, y, width: WINDOW_WIDTH, height });
}

/** Keep the widget inside the nearest display work area (cannot drag off-screen). */
function clampWindowToWorkArea(win: BrowserWindow): void {
  if (!win || win.isDestroyed()) return;
  const b = win.getBounds();
  const display = screen.getDisplayMatching(b);
  const { workArea } = display;
  const w = Math.min(b.width, workArea.width);
  const h = Math.min(b.height, workArea.height);
  const maxX = workArea.x + workArea.width - w;
  const maxY = workArea.y + workArea.height - h;
  const x = Math.min(Math.max(b.x, workArea.x), Math.max(workArea.x, maxX));
  const y = Math.min(Math.max(b.y, workArea.y), Math.max(workArea.y, maxY));
  if (x !== b.x || y !== b.y || w !== b.width || h !== b.height) {
    win.setBounds({ x, y, width: w, height: h });
  }
}

function applyProductionCsp() {
  if (!app.isPackaged) return;
  const { apiBase } = loadConfig();
  let connectSrc = "'self' http://127.0.0.1:* http://localhost:*";
  try {
    const u = new URL(apiBase);
    connectSrc += ` ${u.origin}`;
  } catch {
    // keep defaults
  }

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src ${connectSrc};`,
        ],
      },
    });
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    show: false,
    frame: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    closable: exitAllowed,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    transparent: false,
    backgroundColor: '#f4f7fb',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  placeBottomRight(mainWindow, WINDOW_HEIGHT);
  try {
    mainWindow.setFullScreenable(false);
  } catch {
    /* ignore */
  }

  if (process.env.VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      clampWindowToWorkArea(mainWindow);
      mainWindow.show();
    }
  });

  // Frameless drag can leave the widget half off-screen; clamp on move / display change.
  mainWindow.on('will-move', (event, newBounds) => {
    if (!mainWindow || mainWindow.isDestroyed() || deepLockFrozenActive || offlineCustodyActive) {
      if (offlineCustodyActive && mainWindow && !mainWindow.isDestroyed()) {
        event.preventDefault();
        placeFullPrimary(mainWindow);
      }
      return;
    }
    const display = screen.getDisplayMatching(newBounds);
    const { workArea } = display;
    const w = Math.min(newBounds.width, workArea.width);
    const h = Math.min(newBounds.height, workArea.height);
    const maxX = workArea.x + workArea.width - w;
    const maxY = workArea.y + workArea.height - h;
    const x = Math.min(Math.max(newBounds.x, workArea.x), Math.max(workArea.x, maxX));
    const y = Math.min(Math.max(newBounds.y, workArea.y), Math.max(workArea.y, maxY));
    if (x !== newBounds.x || y !== newBounds.y || w !== newBounds.width || h !== newBounds.height) {
      // Windows: prevent then re-apply clamped bounds. Other platforms: mutate suggestion.
      if (process.platform === 'win32') {
        event.preventDefault();
        mainWindow.setBounds({ x, y, width: w, height: h });
      } else {
        newBounds.x = x;
        newBounds.y = y;
        newBounds.width = w;
        newBounds.height = h;
      }
    }
  });
  mainWindow.on('moved', () => {
    if (mainWindow && !mainWindow.isDestroyed() && !deepLockFrozenActive) {
      clampWindowToWorkArea(mainWindow);
    }
  });
  const onDisplayLayoutChange = () => {
    if (offlineCustodyActive) {
      refreshOfflineCustodyDisplays();
      return;
    }
    if (mainWindow && !mainWindow.isDestroyed() && !deepLockFrozenActive) {
      clampWindowToWorkArea(mainWindow);
    }
  };
  screen.on('display-metrics-changed', onDisplayLayoutChange);
  screen.on('display-added', onDisplayLayoutChange);
  screen.on('display-removed', onDisplayLayoutChange);

  // Block DevTools / reload escapes when packaged, or whenever deep-lock is armed.
  mainWindow.webContents.on('before-input-event', (event, input) => {
    const key = String(input.key || '').toLowerCase();
    const openDevtools =
      key === 'f12' ||
      ((input.control || input.meta) && input.shift && (key === 'i' || key === 'j' || key === 'c'));
    const reload = (input.control || input.meta) && (key === 'r' || key === 'f5');
    const hardNav = key === 'f5' || ((input.alt || input.meta) && (key === 'arrowleft' || key === 'arrowright'));
    if (app.isPackaged || deepLockAggressiveActive) {
      if (openDevtools || reload || hardNav) event.preventDefault();
    }
  });

  mainWindow.on('close', (event) => {
    if (exitAllowed) return;
    event.preventDefault();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
      mainWindow.setAlwaysOnTop(true);
      mainWindow.webContents.send('lock:blocked-close');
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function quitIfAllowed() {
  if (!exitAllowed) return false;
  // Temporarily allow OS close path
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setClosable(true);
  }
  app.quit();
  return true;
}

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  mainWindow.show();
  mainWindow.focus();
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    focusMainWindow();
  });

  // FIRST_RUN_GUIDE.html「打开应用」→ classroom-desk://launch
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient('classroom-desk', process.execPath, [
        path.resolve(process.argv[1]),
      ]);
    }
  } else {
    app.setAsDefaultProtocolClient('classroom-desk');
  }

  app.whenReady().then(() => {
    applyProductionCsp();
    loadConfig();
    teacherBonded = loadTeacherBonded();
    exitUnlockGranted = false;
    recomputeExitAllowed();

    Menu.setApplicationMenu(null);

    app.setLoginItemSettings({
      openAtLogin: true,
      path: process.execPath,
    });

    installCustodyNetworkSealOnce();
    createWindow();

    // Restore security-custody after crash/relaunch (bonded students only).
    if (teacherBonded && loadOfflineCustodyFlag()) {
      setTimeout(() => {
        applyOfflineCustody(true);
      }, 400);
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      } else {
        focusMainWindow();
      }
    });

    app.on('open-url', (event, url) => {
      event.preventDefault();
      if (String(url).startsWith('classroom-desk:')) focusMainWindow();
    });
  });
}

app.on('before-quit', (event) => {
  if (exitAllowed) return;
  event.preventDefault();
});

app.on('window-all-closed', () => {
  if (exitAllowed) {
    if (process.platform !== 'darwin') app.quit();
    return;
  }
  // Recreate if somehow closed while locked
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

function applyWindowChromePolicy() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const locked = deepLockAggressiveActive || deepLockFrozenActive || offlineCustodyActive;
  const canMinimize = allowMinimize && !locked;
  try {
    mainWindow.setMinimizable(canMinimize);
  } catch {
    /* ignore */
  }
  if (!canMinimize && mainWindow.isMinimized()) {
    mainWindow.restore();
    mainWindow.show();
  }
  if ((!allowCollapse || locked) && collapsed) {
    collapsed = false;
    if (offlineCustodyActive) placeFullPrimary(mainWindow);
    else placeBottomRight(mainWindow, WINDOW_HEIGHT);
  }
}

ipcMain.handle('window:toggle-collapse', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return collapsed;
  if (
    !allowCollapse ||
    deepLockAggressiveActive ||
    deepLockFrozenActive ||
    offlineCustodyActive
  ) {
    collapsed = false;
    if (offlineCustodyActive) placeFullPrimary(mainWindow);
    else placeBottomRight(mainWindow, WINDOW_HEIGHT);
    return false;
  }
  collapsed = !collapsed;
  placeBottomRight(mainWindow, collapsed ? COLLAPSED_HEIGHT : WINDOW_HEIGHT);
  return collapsed;
});

ipcMain.handle('window:get-collapsed', () => collapsed);

ipcMain.handle('window:snap-bottom-right', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  placeBottomRight(mainWindow, collapsed ? COLLAPSED_HEIGHT : WINDOW_HEIGHT);
});

ipcMain.handle(
  'window:set-chrome-policy',
  (_event, policy: { allowCollapse?: boolean; allowMinimize?: boolean }) => {
    if (policy?.allowCollapse != null) allowCollapse = Boolean(policy.allowCollapse);
    if (policy?.allowMinimize != null) allowMinimize = Boolean(policy.allowMinimize);
    applyWindowChromePolicy();
    return { ok: true, allowCollapse, allowMinimize, collapsed };
  },
);

ipcMain.handle('lock:get-state', () => ({
  exitAllowed,
  teacherBonded,
  allowStudentExitEnv: process.env.ALLOW_STUDENT_EXIT === '1',
}));

ipcMain.handle('lock:mark-teacher-bonded', () => {
  teacherBonded = true;
  persistTeacherBonded();
  recomputeExitAllowed();
  return { ok: true, teacherBonded, exitAllowed };
});

ipcMain.handle('lock:set-exit-allowed', (_event, allowed: boolean) => {
  // Teacher batch unlock / 解除码 (from renderer) or revoke when window expires.
  // Never bonded → still allow exit even if server reports locked.
  exitUnlockGranted = Boolean(allowed);
  recomputeExitAllowed();
  return { exitAllowed };
});

ipcMain.handle('lock:grant-exit-and-quit', () => {
  exitUnlockGranted = true;
  recomputeExitAllowed();
  return quitIfAllowed();
});

ipcMain.handle('admin:quit', () => {
  if (!exitAllowed) {
    return { ok: false, error: 'exit_locked' };
  }
  quitIfAllowed();
  return { ok: true };
});

ipcMain.handle('admin:set-autostart', (_event, enabled: boolean) => {
  app.setLoginItemSettings({
    openAtLogin: Boolean(enabled),
    path: process.execPath,
  });
  return app.getLoginItemSettings().openAtLogin;
});

ipcMain.handle('admin:get-autostart', () => app.getLoginItemSettings().openAtLogin);

ipcMain.handle('admin:open-uninstall-guide', async () => {
  const { shell } = await import('electron');
  if (process.platform === 'win32') {
    await shell.openExternal('ms-settings:appsfeatures');
    return { ok: true, platform: 'win32' };
  }
  if (process.platform === 'darwin') {
    await shell.openPath('/Applications');
    return { ok: true, platform: 'darwin' };
  }
  return { ok: true, platform: process.platform, hint: 'use_system_package_manager' };
});

ipcMain.handle('shell:open-external', async (_event, rawUrl: unknown) => {
  if (offlineCustodyActive) {
    return { ok: false, error: 'custody_blocks_external' };
  }
  const url = String(rawUrl ?? '').trim();
  if (!/^https?:\/\//i.test(url)) {
    return { ok: false, error: 'only_http_https' };
  }
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (
      blockedHostsCache.some(
        (h) => host === h || host.endsWith(`.${h}`) || h.endsWith(`.${host}`),
      )
    ) {
      return { ok: false, error: 'host_blocked' };
    }
  } catch {
    return { ok: false, error: 'invalid_url' };
  }
  const { shell } = await import('electron');
  try {
    await shell.openExternal(url);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'open_failed' };
  }
});

ipcMain.handle('config:get', () => loadConfig());

/**
 * Batch lab setup: look for teacher-exported config on USB / shared drives.
 * Accepts classroom-desk-config.json or config.json with apiBase + classId.
 */
ipcMain.handle('config:find-removable', () => {
  const names = ['classroom-desk-config.json', 'config.json'];
  const roots: string[] = [];
  if (process.platform === 'win32') {
    for (const letter of 'DEFGHIJKLMNOPQRSTUVWXYZ') {
      roots.push(`${letter}:\\`);
    }
  } else {
    roots.push('/Volumes', '/media', path.join(os.homedir(), 'Desktop'));
  }
  const hits: Array<{ path: string; apiBase: string; classId: string }> = [];
  for (const root of roots) {
    try {
      if (!fs.existsSync(root)) continue;
      for (const name of names) {
        const p = path.join(root, name);
        if (!fs.existsSync(p)) continue;
        const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as {
          apiBase?: string;
          serverUrl?: string;
          classId?: string;
        };
        const apiBase = String(raw.apiBase ?? raw.serverUrl ?? '')
          .trim()
          .replace(/\/$/, '');
        const classId = String(raw.classId ?? '').trim();
        if (!apiBase || !classId) continue;
        if (/127\.0\.0\.1|localhost/i.test(apiBase)) continue;
        if (!/^https?:\/\//i.test(apiBase)) continue;
        hits.push({ path: p, apiBase, classId });
      }
    } catch {
      /* skip unreadable drives */
    }
  }
  return { ok: true, hits };
});

/** Scan same /24 for :8787 (TCP first), then /health + /classroom/join. */
ipcMain.handle('config:discover-lan', async (event) => {
  const net = await import('node:net');
  const dgram = await import('node:dgram');
  const hint = (() => {
    try {
      const nets = os.networkInterfaces();
      let ipv4 = '';
      for (const list of Object.values(nets)) {
        for (const n of list ?? []) {
          if (n.family === 'IPv4' && !n.internal) {
            ipv4 = n.address;
            break;
          }
        }
        if (ipv4) break;
      }
      const parts = ipv4.split('.').map(Number);
      const gateway = parts.length === 4 ? `${parts[0]}.${parts[1]}.${parts[2]}.1` : '';
      return { ipv4, gateway };
    } catch {
      return { ipv4: '', gateway: '' };
    }
  })();

  const prefixes: string[] = [];
  if (hint.ipv4) {
    const p = hint.ipv4.split('.');
    if (p.length === 4) prefixes.push(`${p[0]}.${p[1]}.${p[2]}`);
  }
  // Always include common lab/UTM subnets so discovery works even if iface pick is odd.
  for (const pref of ['192.168.64', '192.168.1', '192.168.0', '10.0.0']) {
    if (!prefixes.includes(pref)) prefixes.push(pref);
  }

  const candidates = new Set<string>();
  if (hint.gateway) candidates.add(hint.gateway);
  for (const pref of prefixes.slice(0, 2)) {
    // Cap: two /24s max to keep find under ~few seconds with concurrency.
    for (let i = 1; i <= 254; i++) candidates.add(`${pref}.${i}`);
  }

  function tcpOpen(host: string, port: number, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      let done = false;
      const finish = (ok: boolean) => {
        if (done) return;
        done = true;
        try {
          socket.destroy();
        } catch {
          /* ignore */
        }
        resolve(ok);
      };
      socket.setTimeout(timeoutMs);
      socket.once('connect', () => finish(true));
      socket.once('timeout', () => finish(false));
      socket.once('error', () => finish(false));
      socket.connect(port, host);
    });
  }

  function getJson(url: string, timeoutMs: number): Promise<unknown | null> {
    return new Promise((resolve) => {
      const req = http.get(url, { timeout: timeoutMs }, (res) => {
        let body = '';
        res.on('data', (c) => {
          body += c;
          if (body.length > 8000) req.destroy();
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch {
            resolve(null);
          }
        });
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => {
        req.destroy();
        resolve(null);
      });
    });
  }

  /** Chunked pool with optional pause between waves to reduce Wi-Fi broadcast storms on large /24 scans. */
  async function mapPoolWaves<T, R>(
    items: T[],
    concurrency: number,
    waveDelayMs: number,
    fn: (item: T, index: number) => Promise<R>,
    onChunkDone?: (done: number, total: number) => void,
  ): Promise<R[]> {
    const out: R[] = new Array(items.length);
    const limit = Math.max(1, Math.min(concurrency, 64));
    for (let start = 0; start < items.length; start += limit) {
      if (start > 0 && waveDelayMs > 0) {
        await new Promise((r) => setTimeout(r, waveDelayMs));
      }
      const chunk = items.slice(start, start + limit);
      await Promise.all(
        chunk.map(async (item, j) => {
          const idx = start + j;
          out[idx] = await fn(item, idx);
        }),
      );
      onChunkDone?.(Math.min(start + limit, items.length), items.length);
    }
    return out;
  }

  // mDNS browse `_classroomdesk._tcp.local` (best-effort; may fail without multicast).
  try {
    const multicastDns = (await import('multicast-dns')).default;
    const mdnsHosts = await new Promise<string[]>((resolve) => {
      const found = new Set<string>();
      let mdns: ReturnType<typeof multicastDns> | null = null;
      const finish = () => {
        try {
          mdns?.destroy();
        } catch {
          /* ignore */
        }
        resolve([...found]);
      };
      try {
        mdns = multicastDns();
        mdns.on('response', (res: { answers?: Array<{ type?: string; data?: unknown }> }) => {
          for (const a of res.answers ?? []) {
            if (a.type === 'A' && typeof a.data === 'string') found.add(a.data);
            if (a.type === 'TXT' && Array.isArray(a.data)) {
              for (const line of a.data) {
                const s = String(line);
                const m = s.match(/^apiBase=https?:\/\/([\d.]+)/i);
                if (m?.[1]) found.add(m[1]);
              }
            }
          }
        });
        mdns.query({ questions: [{ name: '_classroomdesk._tcp.local', type: 'PTR' }] });
        setTimeout(finish, 800);
      } catch {
        finish();
      }
    });
    for (const h of mdnsHosts) candidates.add(h);
  } catch {
    /* multicast-dns optional on student pack — still have UDP + /24 */
  }

  // UDP beacon (teacher broadcasts to 8799) — same L2, not AP-isolation.
  const beaconHosts = await new Promise<string[]>((resolve) => {
    const found = new Set<string>();
    let sock: ReturnType<typeof dgram.createSocket> | null = null;
    const finish = () => {
      try {
        sock?.close();
      } catch {
        /* ignore */
      }
      resolve([...found]);
    };
    try {
      sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      sock.on('message', (msg) => {
        try {
          const j = JSON.parse(String(msg)) as { s?: string; p?: number; lanIps?: string[] };
          if (j.s !== 'classroom-desk') return;
          for (const ip of j.lanIps ?? []) {
            if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) found.add(ip);
          }
        } catch {
          /* ignore */
        }
      });
      sock.on('error', () => finish());
      sock.bind(8799, () => {
        setTimeout(finish, 900);
      });
    } catch {
      finish();
    }
  });
  for (const h of beaconHosts) candidates.add(h);

  const hostList = [...candidates];
  const total = hostList.length;
  let scanned = 0;
  const emitProgress = (phase: string) => {
    try {
      event.sender.send('config:discover-progress', { done: scanned, total, phase });
    } catch {
      /* window gone */
    }
  };
  emitProgress('tcp');
  const tcpConcurrency = hostList.length > 200 ? 16 : hostList.length > 128 ? 24 : 32;
  const waveDelayMs = hostList.length > 128 ? 45 : hostList.length > 64 ? 25 : 0;
  const openHosts = (
    await mapPoolWaves(
      hostList,
      tcpConcurrency,
      waveDelayMs,
      async (host) => {
        const ok = await tcpOpen(host, 8787, 280);
        return ok ? host : null;
      },
      (done) => {
        scanned = done;
        emitProgress('tcp');
      },
    )
  ).filter((h): h is string => Boolean(h));

  const found: Array<{
    apiBase: string;
    version?: string;
    classId?: string;
    className?: string;
    hostName?: string;
    displayName?: string;
    lanIp?: string;
    label?: string;
    easyJoin?: boolean;
  }> = [];

  const probeConcurrency = openHosts.length > 32 ? 12 : 16;
  await mapPoolWaves(openHosts, probeConcurrency, openHosts.length > 24 ? 30 : 0, async (host) => {
    const base = `http://${host}:8787`;
    const health = (await getJson(`${base}/health`, 700)) as {
      ok?: boolean;
      version?: string;
      hostName?: string;
      lanIps?: string[];
      service?: string;
    } | null;
    if (!health || health.service !== 'classroom-desk-server') {
      if (!health || !(health.ok === true || health.version)) return;
    }
    const join = (await getJson(`${base}/api/v1/classroom/join`, 700)) as {
      ok?: boolean;
      enabled?: boolean;
      apiBase?: string;
      classId?: string;
      className?: string;
      hostName?: string;
      displayName?: string;
      lanIp?: string;
      label?: string;
    } | null;
    const hostName = String(join?.hostName ?? health.hostName ?? '').trim() || undefined;
    const displayName = String(join?.displayName ?? '').trim() || undefined;
    const lanIp =
      String(join?.lanIp ?? '').trim() ||
      (Array.isArray(health.lanIps) && health.lanIps[0] ? String(health.lanIps[0]) : host);
    const className = join?.className ? String(join.className) : undefined;
    const classId = join?.classId ? String(join.classId) : undefined;
    const easyJoin = Boolean(
      join?.ok && join?.enabled && (classId || (join as { easyJoinOpen?: boolean }).easyJoinOpen),
    );
    const label =
      String(join?.label ?? '').trim() ||
      [displayName, className, hostName, lanIp].filter(Boolean).join(' · ') ||
      base;
    found.push({
      apiBase:
        join?.apiBase && !/127\.0\.0\.1|localhost/i.test(join.apiBase)
          ? String(join.apiBase).replace(/\/$/, '')
          : base,
      version: health.version,
      easyJoin,
      classId,
      className,
      hostName,
      displayName,
      lanIp,
      label,
    });
  });

  found.sort((a, b) => {
    if (Number(b.easyJoin) !== Number(a.easyJoin)) return Number(b.easyJoin) - Number(a.easyJoin);
    const an = (a.displayName || a.className || a.hostName || a.apiBase).toLowerCase();
    const bn = (b.displayName || b.className || b.hostName || b.apiBase).toLowerCase();
    return an.localeCompare(bn);
  });
  return {
    ok: true,
    found,
    hint,
    scannedHosts: hostList.length,
    openPorts: openHosts.length,
  };
});

ipcMain.handle(
  'config:set',
  (
    _event,
    patch: { apiBase?: string; classId?: string; displayName?: string; className?: string },
  ) => {
    return saveConfig({
      apiBase: patch?.apiBase != null ? String(patch.apiBase) : undefined,
      classId: patch?.classId != null ? String(patch.classId) : undefined,
      displayName: patch?.displayName != null ? String(patch.displayName) : undefined,
      className: patch?.className != null ? String(patch.className) : undefined,
    });
  },
);

/**
 * Soft Assigned Access / kiosk signal (ethical, visible tip only).
 * - CD_ASSIGNED_ACCESS=1 → hardened
 * - marker file (IT drops after AA) → hardened
 * - non-Windows → no nag (hardened=true)
 * - Windows → hardened=false until env or marker (AA itself is not auto-detectable)
 */
ipcMain.handle('kiosk:get-hardening', () => {
  if (process.env.CD_ASSIGNED_ACCESS === '1') {
    return { hardened: true, reason: 'env_assigned_access' as const };
  }
  const markers = [
    path.join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'ClassroomDesk', 'assigned-access.ready'),
    path.join(app.getPath('userData'), 'assigned-access.ready'),
  ];
  for (const m of markers) {
    try {
      if (fs.existsSync(m)) {
        return { hardened: true, reason: 'marker_file' as const, marker: m };
      }
    } catch {
      /* ignore */
    }
  }
  if (process.platform !== 'win32') {
    return { hardened: true, reason: 'non_windows' as const };
  }
  return { hardened: false, reason: 'windows_no_assigned_access_signal' as const };
});

/**
 * Align with renderer mouse input-lock overlay:
 * never click-through; keep always-on-top so the lock surface receives events.
 */
ipcMain.handle('lock:set-input-mouse-locked', (_event, locked: boolean) => {
  if (!mainWindow || mainWindow.isDestroyed()) return { ok: false };
  try {
    // Never click-through while app is open; lock overlay must receive events.
    mainWindow.setIgnoreMouseEvents(false);
    mainWindow.setAlwaysOnTop(true);
    if (locked) {
      mainWindow.show();
      mainWindow.focus();
    }
    return { ok: true, mouseLocked: Boolean(locked) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'set_failed' };
  }
});

function closeExamShell() {
  if (examShellWindow && !examShellWindow.isDestroyed()) {
    examShellWindow.destroy();
  }
  examShellWindow = null;
}

function closeBlackouts() {
  for (const w of blackoutWindows) {
    try {
      if (!w.isDestroyed()) w.destroy();
    } catch {
      /* ignore */
    }
  }
  blackoutWindows = [];
}

/** Cover every non-primary display with a visible black fullscreen window. */
function openSecondaryBlackouts() {
  closeBlackouts();
  const primaryId = screen.getPrimaryDisplay().id;
  for (const d of screen.getAllDisplays()) {
    if (d.id === primaryId) continue;
    const w = new BrowserWindow({
      x: d.bounds.x,
      y: d.bounds.y,
      width: d.bounds.width,
      height: d.bounds.height,
      frame: false,
      show: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      closable: false,
      fullscreen: true,
      alwaysOnTop: true,
      backgroundColor: '#000000',
      focusable: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    w.setAlwaysOnTop(true, 'screen-saver');
    w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    void w.loadURL('data:text/html,<body style="margin:0;background:#000"></body>');
    blackoutWindows.push(w);
  }
}

function stopFocusSteal() {
  if (focusStealTimer) {
    clearInterval(focusStealTimer);
    focusStealTimer = null;
  }
}

function startFocusSteal(intervalMs = 600) {
  stopFocusSteal();
  focusStealTimer = setInterval(() => {
    if (
      (!deepLockFrozenActive && !offlineCustodyActive) ||
      !mainWindow ||
      mainWindow.isDestroyed()
    ) {
      return;
    }
    try {
      if (offlineCustodyActive) placeFullPrimary(mainWindow);
      mainWindow.setAlwaysOnTop(true, 'screen-saver');
      mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      mainWindow.show();
      mainWindow.focus();
    } catch {
      /* ignore */
    }
  }, intervalMs);
}

/** Apply offline security-custody (kiosk cover; survives restart via userData). */
function applyOfflineCustody(on: boolean): { ok: boolean; error?: string } {
  if (!mainWindow || mainWindow.isDestroyed()) return { ok: false, error: 'no_window' };
  try {
    installCustodyNetworkSealOnce();
    offlineCustodyActive = Boolean(on);
    persistOfflineCustodyFlag(offlineCustodyActive);
    custodyNetworkSeal = offlineCustodyActive;
    mainWindow.setIgnoreMouseEvents(false);
    collapsed = false;
    if (offlineCustodyActive) {
      deepLockAggressiveActive = true;
      deepLockFrozenActive = true;
      closeExamShell();
      openSecondaryBlackouts();
      registerDeepLockShortcuts();
      applyDeepLockSessionGuards(true);
      try {
        mainWindow.setFullScreenable(true);
      } catch {
        /* ignore */
      }
      try {
        // App-layer maximum: OS kiosk flag (still bypassable via Task Manager without AA).
        mainWindow.setKiosk(true);
      } catch {
        placeFullPrimary(mainWindow);
      }
      placeFullPrimary(mainWindow);
      try {
        mainWindow.setContentProtection(true);
      } catch {
        /* optional */
      }
      mainWindow.setAlwaysOnTop(true, 'screen-saver');
      mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      mainWindow.setClosable(false);
      mainWindow.setMinimizable(false);
      mainWindow.show();
      mainWindow.focus();
      mainWindow.moveTop();
      startFocusSteal(200);
    } else {
      stopFocusSteal();
      closeBlackouts();
      unregisterDeepLockShortcuts();
      applyDeepLockSessionGuards(false);
      deepLockFrozenActive = false;
      try {
        mainWindow.setKiosk(false);
      } catch {
        /* ignore */
      }
      try {
        mainWindow.setFullScreenable(false);
        if (mainWindow.isFullScreen()) mainWindow.setFullScreen(false);
      } catch {
        /* ignore */
      }
      try {
        mainWindow.setContentProtection(false);
      } catch {
        /* optional */
      }
      mainWindow.setVisibleOnAllWorkspaces(false);
      mainWindow.setAlwaysOnTop(true);
      placeBottomRight(mainWindow, WINDOW_HEIGHT);
      recomputeExitAllowed();
    }
    applyWindowChromePolicy();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'custody_failed' };
  }
}

function hostAllowedForExam(rawUrl: string): boolean {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    if (!examAllowHosts.length) return true;
    return examAllowHosts.some(
      (h) => host === h || host.endsWith(`.${h}`) || h.endsWith(`.${host}`),
    );
  } catch {
    return false;
  }
}

/** Register visible escape-key consumers (Task Manager / Alt+Tab → school L3 AA/Intune, not app hooks). */
function registerDeepLockShortcuts() {
  unregisterDeepLockShortcuts();
  const combos = [
    'F12',
    'F5',
    'CommandOrControl+R',
    'CommandOrControl+Shift+R',
    'CommandOrControl+W',
    'CommandOrControl+Shift+I',
    'CommandOrControl+Shift+J',
    'CommandOrControl+Shift+C',
    'Alt+F4',
  ];
  for (const accel of combos) {
    try {
      const ok = globalShortcut.register(accel, () => {
        if (!deepLockAggressiveActive) return;
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.show();
          mainWindow.focus();
        }
      });
      if (ok) registeredDeepLockShortcuts.push(accel);
    } catch {
      /* platform may refuse some accelerators */
    }
  }
}

function unregisterDeepLockShortcuts() {
  for (const accel of registeredDeepLockShortcuts) {
    try {
      globalShortcut.unregister(accel);
    } catch {
      /* ignore */
    }
  }
  registeredDeepLockShortcuts.length = 0;
}

function applyDeepLockSessionGuards(on: boolean) {
  try {
    session.defaultSession.setPermissionRequestHandler((_wc, _perm, callback) => {
      callback(!on);
    });
  } catch {
    /* ignore */
  }
}

/** Freeze stays a bottom-right widget unless offline custody is active. */
ipcMain.handle('deep-lock:set-frozen', (_event, frozen: boolean) => {
  if (!mainWindow || mainWindow.isDestroyed()) return { ok: false };
  try {
    // Custody owns the window layout — don't shrink back to widget while custody is on.
    if (offlineCustodyActive && !frozen) {
      return { ok: true, deferred: true };
    }
    if (offlineCustodyActive && frozen) {
      return applyOfflineCustody(true);
    }
    deepLockFrozenActive = Boolean(frozen);
    if (frozen) deepLockAggressiveActive = true;
    mainWindow.setIgnoreMouseEvents(false);
    try {
      mainWindow.setFullScreenable(false);
      if (mainWindow.isFullScreen()) mainWindow.setFullScreen(false);
    } catch {
      /* ignore */
    }
    mainWindow.show();
    collapsed = false;
    if (frozen) {
      closeExamShell();
      openSecondaryBlackouts();
      registerDeepLockShortcuts();
      applyDeepLockSessionGuards(true);
      placeBottomRight(mainWindow, WINDOW_HEIGHT);
      try {
        mainWindow.setContentProtection(true);
      } catch {
        /* optional */
      }
      mainWindow.setAlwaysOnTop(true, 'screen-saver');
      mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      mainWindow.focus();
      startFocusSteal();
    } else {
      stopFocusSteal();
      closeBlackouts();
      unregisterDeepLockShortcuts();
      applyDeepLockSessionGuards(false);
      try {
        mainWindow.setContentProtection(false);
      } catch {
        /* optional */
      }
      mainWindow.setVisibleOnAllWorkspaces(false);
      mainWindow.setAlwaysOnTop(true);
      placeBottomRight(mainWindow, WINDOW_HEIGHT);
    }
    applyWindowChromePolicy();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'set_failed' };
  }
});

ipcMain.handle('offline:set-custody', (_event, on: boolean) => applyOfflineCustody(Boolean(on)));
ipcMain.handle('offline:get-custody', () => ({
  active: offlineCustodyActive || loadOfflineCustodyFlag(),
}));

/** Mark deep-lock armed so collapse/devtools escapes stay blocked. */
ipcMain.handle(
  'deep-lock:set-aggressive',
  (_event, aggressive: boolean) => {
    // Offline custody outranks teacher deep-lock end — student stays covered until unlock code.
    if (!aggressive && offlineCustodyActive) {
      deepLockAggressiveActive = true;
      applyWindowChromePolicy();
      return { ok: true, aggressive: true, custodyHeld: true };
    }
    deepLockAggressiveActive = Boolean(aggressive);
    if (deepLockAggressiveActive) {
      registerDeepLockShortcuts();
      applyDeepLockSessionGuards(true);
      applyWindowChromePolicy();
    } else {
      deepLockFrozenActive = false;
      stopFocusSteal();
      closeExamShell();
      closeBlackouts();
      unregisterDeepLockShortcuts();
      applyDeepLockSessionGuards(false);
      examAllowHosts = [];
      if (mainWindow && !mainWindow.isDestroyed()) {
        try {
          if (mainWindow.isFullScreen()) mainWindow.setFullScreen(false);
        } catch {
          /* ignore */
        }
        try {
          mainWindow.setContentProtection(false);
        } catch {
          /* ignore */
        }
        mainWindow.setVisibleOnAllWorkspaces(false);
        placeBottomRight(mainWindow, WINDOW_HEIGHT);
      }
      applyWindowChromePolicy();
    }
    return { ok: true, aggressive: deepLockAggressiveActive };
  },
);

/**
 * In-app exam BrowserWindow (visible). Used with killForeignBrowsers so the
 * only allowed browser surface is this shell — not a silent OS inject.
 */
ipcMain.handle(
  'deep-lock:set-exam-url',
  async (_event, rawUrl: unknown, allowHosts?: unknown) => {
    const url = String(rawUrl ?? '').trim();
    if (!url) {
      closeExamShell();
      examAllowHosts = [];
      return { ok: true, closed: true };
    }
    if (!/^https?:\/\//i.test(url)) {
      return { ok: false, error: 'only_http_https' };
    }
    const hosts = Array.isArray(allowHosts)
      ? allowHosts.map((h) => String(h ?? '').trim().toLowerCase()).filter(Boolean)
      : [];
    try {
      const examHost = new URL(url).hostname.toLowerCase();
      examAllowHosts = [...new Set([examHost, ...hosts])].slice(0, 64);
    } catch {
      examAllowHosts = hosts.slice(0, 64);
    }
    try {
      if (!examShellWindow || examShellWindow.isDestroyed()) {
        const display = screen.getPrimaryDisplay();
        const { bounds } = display;
        examShellWindow = new BrowserWindow({
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
          show: true,
          frame: true,
          autoHideMenuBar: true,
          alwaysOnTop: true,
          fullscreen: true,
          title: 'Classroom Desk · Exam',
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
          },
        });
        examShellWindow.setAlwaysOnTop(true, 'screen-saver');
        examShellWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        try {
          examShellWindow.setContentProtection(true);
        } catch {
          /* optional */
        }
        examShellWindow.on('close', (e) => {
          if (deepLockAggressiveActive) e.preventDefault();
        });
        examShellWindow.on('closed', () => {
          examShellWindow = null;
        });
        examShellWindow.webContents.on('will-navigate', (event, navUrl) => {
          if (hostIsBlocked(navUrl) || !hostAllowedForExam(navUrl)) event.preventDefault();
        });
        examShellWindow.webContents.setWindowOpenHandler(({ url: openUrl }) =>
          hostAllowedForExam(openUrl) ? { action: 'allow' } : { action: 'deny' },
        );
        examShellWindow.webContents.on('before-input-event', (event, input) => {
          const key = String(input.key || '').toLowerCase();
          if (
            key === 'f12' ||
            key === 'f11' ||
            ((input.control || input.meta) && input.shift && (key === 'i' || key === 'j' || key === 'c')) ||
            ((input.control || input.meta) && (key === 'r' || key === 'w'))
          ) {
            event.preventDefault();
          }
        });
      }
      registerDeepLockShortcuts();
      applyDeepLockSessionGuards(true);
      await examShellWindow.loadURL(url);
      examShellWindow.setFullScreen(true);
      examShellWindow.show();
      examShellWindow.focus();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'exam_shell_failed' };
    }
  },
);

/**
 * Visible policy: end common browser processes while deep-lock kill mode is on.
 * Does not hide itself; does not touch OS security tools. Requires school-owned agent.
 */
/** Best-effort SSID + primary IPv4 for school-defined network zone matching. */
ipcMain.handle('sys:get-arch', () => {
  // Electron process.arch: x64 | arm64 | ia32 …
  const a = String(process.arch || '').toLowerCase();
  if (a === 'arm64' || a === 'aarch64') return 'arm64';
  if (a === 'x64' || a === 'amd64' || a === 'x86_64') return 'x64';
  return a || 'unknown';
});

ipcMain.handle('sys:get-hostname', () => os.hostname());

let dnsServersCache: { at: number; servers: string[] } | null = null;
const DNS_SERVERS_CACHE_MS = 60_000;

function normalizeDnsList(raw: string[]): string[] {
  const out: string[] = [];
  for (const item of raw) {
    const s = String(item ?? '').trim();
    if (!s) continue;
    if (out.includes(s)) continue;
    out.push(s);
  }
  return out;
}

async function resolveDnsServersBestEffort(): Promise<string[]> {
  const fromNode = normalizeDnsList(dns.getServers());
  if (fromNode.length) return fromNode;

  if (process.platform === 'win32') {
    try {
      const { stdout } = await execFileAsync(
        'powershell',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `(Get-DnsClientServerAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | ` +
            `Select-Object -ExpandProperty ServerAddresses -Unique) -join ','`,
        ],
        { windowsHide: true, timeout: 5000 },
      );
      const split = stdout
        .trim()
        .split(/[,;\s]+/)
        .map((x) => x.trim())
        .filter(Boolean);
      const ps = normalizeDnsList(split);
      if (ps.length) return ps;
    } catch {
      /* ignore */
    }
  }

  try {
    const hints: string[] = [];
    const ifaces = os.networkInterfaces();
    for (const rows of Object.values(ifaces)) {
      for (const row of rows ?? []) {
        if (row.family === 'IPv4' && !row.internal && row.address) {
          const parts = row.address.split('.');
          if (parts.length === 4) hints.push(`${parts[0]}.${parts[1]}.${parts[2]}.1`);
        }
      }
    }
    return normalizeDnsList(hints);
  } catch {
    return [];
  }
}

ipcMain.handle('net:get-dns-servers', async () => {
  const now = Date.now();
  if (dnsServersCache && now - dnsServersCache.at < DNS_SERVERS_CACHE_MS) {
    return dnsServersCache.servers;
  }
  const servers = await resolveDnsServersBestEffort();
  dnsServersCache = { at: now, servers };
  return servers;
});

ipcMain.handle('net:get-hint', async () => {
  let ssid = '';
  let ipv4 = '';
  let gateway = '';
  try {
    const ifaces = os.networkInterfaces();
    for (const rows of Object.values(ifaces)) {
      for (const row of rows ?? []) {
        if (row.family === 'IPv4' && !row.internal) {
          ipv4 = row.address;
          break;
        }
      }
      if (ipv4) break;
    }
  } catch {
    /* ignore */
  }
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execFileAsync('netsh', ['wlan', 'show', 'interfaces'], {
        windowsHide: true,
        timeout: 4000,
      });
      const m = /SSID\s*:\s*(.+)/i.exec(stdout);
      if (m) ssid = m[1]!.trim();
    } else if (process.platform === 'darwin') {
      try {
        const { stdout } = await execFileAsync(
          '/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport',
          ['-I'],
          { timeout: 4000 },
        );
        const m = /\sSSID:\s*(.+)/.exec(stdout);
        if (m) ssid = m[1]!.trim();
      } catch {
        /* airport may be missing on newer macOS */
      }
    }
  } catch {
    /* offline / no wifi */
  }
  return { ssid, ipv4, gateway };
});

ipcMain.handle(
  'deep-lock:enforce-browsers',
  async (
    _event,
    opts: { killForeignBrowsers?: boolean; killDistractions?: boolean; allowHosts?: string[] },
  ) => {
    if (!opts?.killForeignBrowsers && !opts?.killDistractions) {
      return { ok: true, killed: [] as string[] };
    }
    const killed: string[] = [];
    const winBrowsers = [
      'chrome.exe',
      'msedge.exe',
      'msedgewebview2.exe',
      'firefox.exe',
      'brave.exe',
      'opera.exe',
      'vivaldi.exe',
      'chromium.exe',
      'iexplore.exe',
      'Arc.exe',
      '360se.exe',
      '360chrome.exe',
      '360ChromeX.exe',
      'sogouexplorer.exe',
      'QQBrowser.exe',
      'Liebao.exe',
      'Maxthon.exe',
      'UCBrowser.exe',
      'theworld.exe',
    ];
    const winDistractions = [
      'WeChat.exe',
      'Weixin.exe',
      'WeChatAppEx.exe',
      'QQ.exe',
      'QQNT.exe',
      'TIM.exe',
      'WXWork.exe',
      'DingTalk.exe',
      'Feishu.exe',
      'Lark.exe',
      'Discord.exe',
      'Telegram.exe',
      'Steam.exe',
      'steamwebhelper.exe',
      'epicgameslauncher.exe',
      'Origin.exe',
      'Battle.net.exe',
      'RiotClientServices.exe',
      'LeagueClient.exe',
      'LeagueClientUx.exe',
      'wegame.exe',
      'WeGameLauncher.exe',
      'Slack.exe',
      'Teams.exe',
      'ms-teams.exe',
      'Zoom.exe',
      'Notion.exe',
      'Spotify.exe',
      'cloudmusic.exe',
      'kwmusic.exe',
      'QQMusic.exe',
      'BiliBili.exe',
      'iQIYI.exe',
      'Youku.exe',
      'GameBar.exe',
      'GameBarFTServer.exe',
      'XboxApp.exe',
    ];
    const macBrowsers = [
      'Google Chrome',
      'Microsoft Edge',
      'Firefox',
      'Chromium',
      'Brave Browser',
      'Opera',
      'Vivaldi',
      'Safari',
      'Arc',
      'QQBrowser',
      '360Chrome',
    ];
    const macDistractions = [
      'WeChat',
      'QQ',
      'DingTalk',
      'Lark',
      'Feishu',
      'Discord',
      'Telegram',
      'Steam',
      'Slack',
      'Microsoft Teams',
      'zoom.us',
      'Notion',
      'Spotify',
      'NeteaseMusic',
      'QQMusic',
    ];
    const extraBlocked = blockedAppsCache
      .map((a) => sanitizeProcessName(a))
      .filter((x): x is string => Boolean(x));
    try {
      if (process.platform === 'win32') {
        const targets = [
          ...new Set([
            ...(opts.killForeignBrowsers ? winBrowsers : []),
            ...(opts.killDistractions ? winDistractions : []),
            ...(offlineCustodyActive || deepLockAggressiveActive ? extraBlocked : []),
          ]),
        ];
        for (const name of targets) {
          try {
            await execFileAsync('taskkill', ['/IM', name, '/F'], { windowsHide: true });
            killed.push(name);
          } catch {
            /* not running */
          }
        }
      } else if (process.platform === 'darwin') {
        const targets = [
          ...new Set([
            ...(opts.killForeignBrowsers ? macBrowsers : []),
            ...(opts.killDistractions ? macDistractions : []),
            ...(offlineCustodyActive || deepLockAggressiveActive ? extraBlocked : []),
          ]),
        ];
        for (const name of targets) {
          try {
            await execFileAsync('killall', [name]);
            killed.push(name);
          } catch {
            /* not running */
          }
        }
      } else {
        const targets = [
          ...new Set([
            ...(opts.killForeignBrowsers
              ? ['chrome', 'chromium', 'firefox', 'msedge', 'brave', 'opera']
              : []),
            ...(opts.killDistractions
              ? ['discord', 'telegram', 'steam', 'slack', 'teams', 'zoom']
              : []),
            ...(offlineCustodyActive || deepLockAggressiveActive ? extraBlocked : []),
          ]),
        ];
        for (const name of targets) {
          try {
            await execFileAsync('pkill', ['-f', name]);
            killed.push(name);
          } catch {
            /* not running */
          }
        }
      }
      return { ok: true, killed };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'enforce_failed', killed };
    }
  },
);

function sanitizeProcessName(raw: string): string | null {
  const name = String(raw ?? '').trim();
  if (!name || name.length > 120) return null;
  // Deny path traversal / shell metacharacters — process image or simple app name only.
  if (/[\\/:*?"<>|\0]/.test(name)) return null;
  if (!/^[A-Za-z0-9._+\- ]+$/.test(name)) return null;
  return name;
}

/** Kill teacher-listed apps (blocked list or close_apps command). */
ipcMain.handle('device-control:kill-apps', async (_event, apps: unknown) => {
  const list = Array.isArray(apps)
    ? apps.map((a) => sanitizeProcessName(String(a ?? ''))).filter((x): x is string => Boolean(x))
    : [];
  const killed: string[] = [];
  for (const name of list.slice(0, 32)) {
    try {
      if (process.platform === 'win32') {
        const im = /\.exe$/i.test(name) ? name : `${name}.exe`;
        await execFileAsync('taskkill', ['/IM', im, '/F'], { windowsHide: true });
        killed.push(im);
      } else if (process.platform === 'darwin') {
        await execFileAsync('killall', [name]);
        killed.push(name);
      } else {
        await execFileAsync('pkill', ['-f', name]);
        killed.push(name);
      }
    } catch {
      /* not running */
    }
  }
  return { ok: true, killed };
});

/** Open a allowlisted-looking app name (visible; no shell string concat). */
ipcMain.handle('device-control:open-app', async (_event, rawApp: unknown) => {
  const name = sanitizeProcessName(String(rawApp ?? ''));
  if (!name) return { ok: false, error: 'invalid_app' };
  try {
    if (process.platform === 'win32') {
      await execFileAsync('cmd.exe', ['/c', 'start', '', name], { windowsHide: true });
      return { ok: true };
    }
    if (process.platform === 'darwin') {
      await execFileAsync('open', ['-a', name]);
      return { ok: true };
    }
    await execFileAsync(name, []);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'open_failed' };
  }
});

function hostIsBlocked(rawUrl: string): boolean {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    return blockedHostsCache.some((h) => host === h || host.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

let blockFilterInstalled = false;
function installRequestBlockFilter() {
  if (blockFilterInstalled) return;
  blockFilterInstalled = true;
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
    if (hostIsBlocked(details.url)) callback({ cancel: true });
    else callback({});
  });
}

/** Block openExternal and in-app navigations when host is on the teacher block list. */
ipcMain.handle('device-control:set-blocked-hosts', (_event, hosts: unknown) => {
  blockedHostsCache = Array.isArray(hosts)
    ? hosts
        .map((h) =>
          String(h ?? '')
            .trim()
            .toLowerCase()
            .replace(/^https?:\/\//, '')
            .replace(/\/.*$/, ''),
        )
        .filter(Boolean)
        .slice(0, 64)
    : [];
  installRequestBlockFilter();
  return { ok: true, count: blockedHostsCache.length };
});

ipcMain.handle('device-control:set-blocked-apps', (_event, apps: unknown) => {
  blockedAppsCache = Array.isArray(apps)
    ? apps
        .map((a) => sanitizeProcessName(String(a ?? '')))
        .filter((x): x is string => Boolean(x))
        .slice(0, 64)
    : [];
  return { ok: true, count: blockedAppsCache.length };
});

ipcMain.handle('lock:verify-offline-code', async (_event, code: unknown, hash: unknown) => {
  const plain = String(code ?? '');
  const stored = String(hash ?? '');
  if (plain.length < 6 || !stored.startsWith('$2')) return { ok: false };
  try {
    return { ok: await bcrypt.compare(plain, stored) };
  } catch {
    return { ok: false };
  }
});

function downloadToFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https:') ? https : http;
    const req = mod.get(url, { timeout: 120_000 }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        void downloadToFile(String(res.headers.location), dest).then(resolve, reject);
        return;
      }
      if ((res.statusCode ?? 500) >= 400) {
        res.resume();
        reject(new Error(`http_${res.statusCode}`));
        return;
      }
      const out = fs.createWriteStream(dest);
      res.pipe(out);
      out.on('finish', () => out.close(() => resolve()));
      out.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('download_timeout'));
    });
  });
}

function isLanOrLoopbackHost(hostname: string): boolean {
  const h = String(hostname ?? '')
    .trim()
    .toLowerCase();
  if (!h) return false;
  if (h === 'localhost' || h === '::1') return true;
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  return false;
}

function sameServicePort(a: URL, b: URL): boolean {
  const def = (u: URL) => u.port || (u.protocol === 'https:' ? '443' : '80');
  return def(a) === def(b);
}

/**
 * Teacher-enabled force sync: download LAN Setup from teacher host and run NSIS /S.
 * Allows http(s) /upgrades/*.exe when host matches apiBase, or same-port private LAN
 * (multi-NIC teacher: bonded IP ≠ upgrade URL host).
 */
ipcMain.handle('upgrade:force-lan-setup', async (_event, rawUrl: unknown) => {
  const url = String(rawUrl ?? '').trim();
  if (!/^https?:\/\//i.test(url) || !/\/upgrades\//i.test(url) || !/\.exe(\?|$)/i.test(url)) {
    return { ok: false, error: 'invalid_upgrade_url' };
  }
  try {
    const cfg = loadConfig();
    const api = new URL(String(cfg.apiBase || 'http://127.0.0.1:8787'));
    const u = new URL(url);
    const apiHost = api.hostname.toLowerCase();
    const upHost = u.hostname.toLowerCase();
    const hostOk =
      upHost === apiHost ||
      (sameServicePort(api, u) && isLanOrLoopbackHost(apiHost) && isLanOrLoopbackHost(upHost));
    if (!hostOk) {
      return { ok: false, error: 'host_mismatch' };
    }
  } catch {
    return { ok: false, error: 'bad_api_base' };
  }
  const dest = path.join(app.getPath('temp'), 'ClassroomDesk-Forced-Setup.exe');
  try {
    await downloadToFile(url, dest);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'download_failed' };
  }
  try {
    if (process.platform === 'win32') {
      spawn(dest, ['/S'], { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [dest], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn(dest, [], { detached: true, stdio: 'ignore' }).unref();
    }
    setTimeout(() => {
      try {
        app.exit(0);
      } catch {
        /* ignore */
      }
    }, 800);
    return { ok: true, path: dest };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'spawn_failed' };
  }
});
