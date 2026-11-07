import { app, BrowserWindow, ipcMain, Menu, screen, session } from 'electron';
import path from 'node:path';
import { loadConfig, saveConfig } from './configStore';

const WINDOW_WIDTH = 380;
const WINDOW_HEIGHT = 560;
const COLLAPSED_HEIGHT = 56;
const MARGIN = 16;

let mainWindow: BrowserWindow | null = null;
let collapsed = false;

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
