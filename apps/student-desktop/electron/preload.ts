import { contextBridge, ipcRenderer } from 'electron';

export type AppConfig = { apiBase: string; classId: string };

export type ExitLockState = {
  exitAllowed: boolean;
  allowStudentExitEnv?: boolean;
};

export type KioskHardening = {
  hardened: boolean;
  reason: string;
};

export type StudentDesktopAPI = {
  toggleCollapse: () => Promise<boolean>;
  getCollapsed: () => Promise<boolean>;
  snapBottomRight: () => Promise<void>;
  adminQuit: () => Promise<{ ok: boolean; error?: string } | void>;
  setAutostart: (enabled: boolean) => Promise<boolean>;
  getAutostart: () => Promise<boolean>;
  openUninstallGuide: () => Promise<{ ok: boolean; platform: string; hint?: string }>;
  getConfig: () => Promise<AppConfig>;
  setConfig: (patch: Partial<AppConfig>) => Promise<AppConfig>;
  setApiBase: (apiBase: string) => Promise<AppConfig>;
  findRemovableConfig: () => Promise<{
    ok: boolean;
    hits: Array<{ path: string; apiBase: string; classId: string }>;
  }>;
  discoverLanClassroom: () => Promise<{
    ok: boolean;
    found: Array<{
      apiBase: string;
      version?: string;
      classId?: string;
      className?: string;
      hostName?: string;
      lanIp?: string;
      label?: string;
      easyJoin?: boolean;
    }>;
    hint?: { ipv4: string; gateway: string };
  }>;
  getExitLockState: () => Promise<ExitLockState>;
  setExitAllowed: (allowed: boolean) => Promise<ExitLockState>;
  grantExitAndQuit: () => Promise<boolean>;
  onBlockedClose: (cb: () => void) => () => void;
  getKioskHardening: () => Promise<KioskHardening>;
  setInputMouseLocked: (locked: boolean) => Promise<{ ok: boolean; mouseLocked?: boolean; error?: string }>;
  /** Open http(s) URLs via OS browser / download handler (LAN Setup.exe, Release). */
  openExternal: (url: string) => Promise<{ ok: boolean; error?: string }>;
  setDeepLockFrozen: (frozen: boolean) => Promise<{ ok: boolean; error?: string }>;
  setDeepLockAggressive: (aggressive: boolean) => Promise<{ ok: boolean; aggressive?: boolean }>;
  setDeepLockExamUrl: (
    url: string | null,
    allowHosts?: string[],
  ) => Promise<{ ok: boolean; error?: string; closed?: boolean }>;
  enforceDeepLockBrowsers: (opts: {
    killForeignBrowsers: boolean;
    killDistractions?: boolean;
    allowHosts?: string[];
  }) => Promise<{ ok: boolean; killed?: string[]; error?: string }>;
  getNetworkHint: () => Promise<{ ssid: string; ipv4: string; gateway: string }>;
  killApps: (apps: string[]) => Promise<{ ok: boolean; killed?: string[] }>;
  openApp: (app: string) => Promise<{ ok: boolean; error?: string }>;
  setBlockedHosts: (hosts: string[]) => Promise<{ ok: boolean; count?: number }>;
  verifyOfflineCode: (code: string, hash: string) => Promise<{ ok: boolean }>;
  forceLanSetup: (url: string) => Promise<{ ok: boolean; error?: string; path?: string }>;
};

const api: StudentDesktopAPI = {
  toggleCollapse: () => ipcRenderer.invoke('window:toggle-collapse'),
  getCollapsed: () => ipcRenderer.invoke('window:get-collapsed'),
  snapBottomRight: () => ipcRenderer.invoke('window:snap-bottom-right'),
  adminQuit: () => ipcRenderer.invoke('admin:quit'),
  setAutostart: (enabled) => ipcRenderer.invoke('admin:set-autostart', enabled),
  getAutostart: () => ipcRenderer.invoke('admin:get-autostart'),
  openUninstallGuide: () => ipcRenderer.invoke('admin:open-uninstall-guide'),
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (patch) => ipcRenderer.invoke('config:set', patch),
  setApiBase: (apiBase) => ipcRenderer.invoke('config:set', { apiBase }),
  findRemovableConfig: () => ipcRenderer.invoke('config:find-removable'),
  discoverLanClassroom: () => ipcRenderer.invoke('config:discover-lan'),
  getExitLockState: () => ipcRenderer.invoke('lock:get-state'),
  setExitAllowed: (allowed) => ipcRenderer.invoke('lock:set-exit-allowed', allowed),
  grantExitAndQuit: () => ipcRenderer.invoke('lock:grant-exit-and-quit'),
  onBlockedClose: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('lock:blocked-close', handler);
    return () => ipcRenderer.removeListener('lock:blocked-close', handler);
  },
  getKioskHardening: () => ipcRenderer.invoke('kiosk:get-hardening'),
  setInputMouseLocked: (locked) => ipcRenderer.invoke('lock:set-input-mouse-locked', locked),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  setDeepLockFrozen: (frozen) => ipcRenderer.invoke('deep-lock:set-frozen', frozen),
  setDeepLockAggressive: (aggressive) => ipcRenderer.invoke('deep-lock:set-aggressive', aggressive),
  setDeepLockExamUrl: (url, allowHosts) =>
    ipcRenderer.invoke('deep-lock:set-exam-url', url, allowHosts),
  enforceDeepLockBrowsers: (opts) => ipcRenderer.invoke('deep-lock:enforce-browsers', opts),
  getNetworkHint: () => ipcRenderer.invoke('net:get-hint'),
  killApps: (apps) => ipcRenderer.invoke('device-control:kill-apps', apps),
  openApp: (app) => ipcRenderer.invoke('device-control:open-app', app),
  setBlockedHosts: (hosts) => ipcRenderer.invoke('device-control:set-blocked-hosts', hosts),
  verifyOfflineCode: (code, hash) => ipcRenderer.invoke('lock:verify-offline-code', code, hash),
  forceLanSetup: (url) => ipcRenderer.invoke('upgrade:force-lan-setup', url),
};

contextBridge.exposeInMainWorld('classroomDesk', api);
