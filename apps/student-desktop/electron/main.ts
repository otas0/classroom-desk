import { app, BrowserWindow, globalShortcut, ipcMain, Menu, screen, session } from 'electron';
import { execFile } from 'node:child_process';
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
/** Deep-lock armed (freeze / exam allowlist / deny) — visible classroom policy. */
let deepLockAggressiveActive = false;
let deepLockFrozenActive = false;
let examAllowHosts: string[] = [];
const registeredDeepLockShortcuts: string[] = [];

/**
 * Exit lock: students cannot close/quit unless unlocked.
 * Unlock via teacher batch (renderer polls) or local 解除码 (IPC grant).
 * Dev override: ALLOW_STUDENT_EXIT=1
 *
 * Note: OS Task Manager / kill -9 cannot be blocked by a normal app.
 */
let exitAllowed = process.env.ALLOW_STUDENT_EXIT === '1';

function placeBottomRight(win: BrowserWindow, height: number) {
  const display = screen.getPrimaryDisplay();
  const { workArea } = display;
  const x = Math.round(workArea.x + workArea.width - WINDOW_WIDTH - MARGIN);
  const y = Math.round(workArea.y + workArea.height - height - MARGIN);
  win.setBounds({ x, y, width: WINDOW_WIDTH, height });
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
    minimizable: true,
    closable: false,
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

  if (process.env.VITE_DEV_SERVER_URL) {
    void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

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

    Menu.setApplicationMenu(null);

    app.setLoginItemSettings({
      openAtLogin: true,
      path: process.execPath,
    });

    createWindow();

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

ipcMain.handle('window:toggle-collapse', () => {
  if (!mainWindow) return collapsed;
  // Deep-lock: keep surface expanded so freeze/banner cannot be tucked away.
  if (deepLockAggressiveActive || deepLockFrozenActive) {
    collapsed = false;
    if (deepLockFrozenActive) {
      const { workArea } = screen.getPrimaryDisplay();
      mainWindow.setBounds({
        x: workArea.x,
        y: workArea.y,
        width: workArea.width,
        height: workArea.height,
      });
    } else {
      placeBottomRight(mainWindow, WINDOW_HEIGHT);
    }
    return false;
  }
  collapsed = !collapsed;
  const height = collapsed ? COLLAPSED_HEIGHT : WINDOW_HEIGHT;
  placeBottomRight(mainWindow, height);
  return collapsed;
});

ipcMain.handle('window:get-collapsed', () => collapsed);

ipcMain.handle('window:snap-bottom-right', () => {
  if (!mainWindow) return;
  placeBottomRight(mainWindow, collapsed ? COLLAPSED_HEIGHT : WINDOW_HEIGHT);
});

ipcMain.handle('lock:get-state', () => ({
  exitAllowed,
  allowStudentExitEnv: process.env.ALLOW_STUDENT_EXIT === '1',
}));

ipcMain.handle('lock:set-exit-allowed', (_event, allowed: boolean) => {
  // Teacher batch unlock (from renderer poll) or revoke when window expires
  exitAllowed = Boolean(allowed) || process.env.ALLOW_STUDENT_EXIT === '1';
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setClosable(exitAllowed);
  }
  return { exitAllowed };
});

ipcMain.handle('lock:grant-exit-and-quit', () => {
  exitAllowed = true;
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
  const url = String(rawUrl ?? '').trim();
  if (!/^https?:\/\//i.test(url)) {
    return { ok: false, error: 'only_http_https' };
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

ipcMain.handle('config:set', (_event, patch: { apiBase?: string; classId?: string }) => {
  return saveConfig({
    apiBase: patch?.apiBase != null ? String(patch.apiBase) : undefined,
    classId: patch?.classId != null ? String(patch.classId) : undefined,
  });
});

/**
 * Soft Assigned Access / kiosk signal (ethical, visible tip only).
 * - CD_ASSIGNED_ACCESS=1 → hardened
 * - non-Windows → no nag (hardened=true)
 * - Windows → hardened=false unless env set (IT configures Assigned Access separately)
 */
ipcMain.handle('kiosk:get-hardening', () => {
  if (process.env.CD_ASSIGNED_ACCESS === '1') {
    return { hardened: true, reason: 'env_assigned_access' as const };
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

function startFocusSteal() {
  stopFocusSteal();
  focusStealTimer = setInterval(() => {
    if (!deepLockFrozenActive || !mainWindow || mainWindow.isDestroyed()) return;
    try {
      mainWindow.setAlwaysOnTop(true, 'screen-saver');
      mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      mainWindow.show();
      mainWindow.focus();
    } catch {
      /* ignore */
    }
  }, 600);
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

/** Register visible escape-key consumers (not Task Manager — SECURITY forbids blocking it). */
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

/** Expand widget to work-area overlay while frozen (visible kiosk freeze). */
ipcMain.handle('deep-lock:set-frozen', (_event, frozen: boolean) => {
  if (!mainWindow || mainWindow.isDestroyed()) return { ok: false };
  try {
    deepLockFrozenActive = Boolean(frozen);
    if (frozen) deepLockAggressiveActive = true;
    const display = screen.getPrimaryDisplay();
    const { bounds } = display;
    mainWindow.setIgnoreMouseEvents(false);
    mainWindow.setMinimizable(false);
    mainWindow.show();
    collapsed = false;
    if (frozen) {
      closeExamShell();
      openSecondaryBlackouts();
      registerDeepLockShortcuts();
      applyDeepLockSessionGuards(true);
      mainWindow.setBounds({
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      });
      try {
        mainWindow.setFullScreen(true);
      } catch {
        /* some platforms reject — bounds already fill display */
      }
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
        mainWindow.setFullScreen(false);
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
      mainWindow.setMinimizable(true);
      placeBottomRight(mainWindow, WINDOW_HEIGHT);
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'set_failed' };
  }
});

/** Mark deep-lock armed so collapse/devtools escapes stay blocked. */
ipcMain.handle(
  'deep-lock:set-aggressive',
  (_event, aggressive: boolean) => {
    deepLockAggressiveActive = Boolean(aggressive);
    if (deepLockAggressiveActive) {
      registerDeepLockShortcuts();
      applyDeepLockSessionGuards(true);
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
          mainWindow.setFullScreen(false);
        } catch {
          /* ignore */
        }
        try {
          mainWindow.setContentProtection(false);
        } catch {
          /* ignore */
        }
        mainWindow.setVisibleOnAllWorkspaces(false);
        mainWindow.setMinimizable(true);
      }
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
          if (!hostAllowedForExam(navUrl)) event.preventDefault();
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
      'sogouexplorer.exe',
    ];
    const winDistractions = [
      'WeChat.exe',
      'Weixin.exe',
      'WeChatAppEx.exe',
      'QQ.exe',
      'QQNT.exe',
      'TIM.exe',
      'Discord.exe',
      'Telegram.exe',
      'Steam.exe',
      'steamwebhelper.exe',
      'epicgameslauncher.exe',
      'Slack.exe',
      'Teams.exe',
      'ms-teams.exe',
      'Zoom.exe',
      'Notion.exe',
      'Spotify.exe',
      'cloudmusic.exe',
      'BiliBili.exe',
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
    ];
    const macDistractions = [
      'WeChat',
      'QQ',
      'Discord',
      'Telegram',
      'Steam',
      'Slack',
      'Microsoft Teams',
      'zoom.us',
      'Notion',
      'Spotify',
      'NeteaseMusic',
    ];
    try {
      if (process.platform === 'win32') {
        const targets = [
          ...(opts.killForeignBrowsers ? winBrowsers : []),
          ...(opts.killDistractions ? winDistractions : []),
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
          ...(opts.killForeignBrowsers ? macBrowsers : []),
          ...(opts.killDistractions ? macDistractions : []),
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
          ...(opts.killForeignBrowsers
            ? ['chrome', 'chromium', 'firefox', 'msedge', 'brave', 'opera']
            : []),
          ...(opts.killDistractions
            ? ['discord', 'telegram', 'steam', 'slack', 'teams', 'zoom']
            : []),
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
