import { app, BrowserWindow, ipcMain, screen, session } from 'electron';
import path from 'node:path';
import { loadConfig, saveConfig } from './configStore';

const WINDOW_WIDTH = 380;
const WINDOW_HEIGHT = 560;
const COLLAPSED_HEIGHT = 56;
const MARGIN = 16;

let mainWindow: BrowserWindow | null = null;
let collapsed = false;

function placeBottomRight(win: BrowserWindow, height: number) {
  const display = screen.getPrimaryDisplay();
  const { workArea } = display;
  const x = Math.round(workArea.x + workArea.width - WINDOW_WIDTH - MARGIN);
  const y = Math.round(workArea.y + workArea.height - height - MARGIN);
  win.setBounds({ x, y, width: WINDOW_WIDTH, height });
}

function applyProductionCsp() {
  // Packaged builds: tighten CSP (no Vite HMR). API host comes from configurable apiBase.
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

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  applyProductionCsp();
  loadConfig();

  app.setLoginItemSettings({
    openAtLogin: true,
    path: process.execPath,
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
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

ipcMain.handle('admin:quit', () => {
  app.quit();
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

ipcMain.handle('config:set-api-base', (_event, apiBase: string) => {
  return saveConfig({ apiBase: String(apiBase ?? '') });
});
