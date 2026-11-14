import { contextBridge, ipcRenderer } from 'electron';

export type AppConfig = {
  apiBase: string;
  classId: string;
  displayName?: string;
  className?: string;
};

export type ExitLockState = {
  exitAllowed: boolean;
  teacherBonded?: boolean;
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
  setWindowChromePolicy: (policy: {
    allowCollapse?: boolean;
    allowMinimize?: boolean;
  }) => Promise<{ ok: boolean; allowCollapse?: boolean; allowMinimize?: boolean; collapsed?: boolean }>;
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
      displayName?: string;
      lanIp?: string;
      label?: string;
      easyJoin?: boolean;
    }>;
    hint?: { ipv4: string; gateway: string };
    scannedHosts?: number;
    openPorts?: number;
  }>;
  onDiscoverProgress: (cb: (p: { done: number; total: number; phase?: string }) => void) => () => void;
  getExitLockState: () => Promise<ExitLockState>;
  markTeacherBonded: () => Promise<{ ok: boolean; teacherBonded?: boolean; exitAllowed?: boolean }>;
  setExitAllowed: (allowed: boolean) => Promise<ExitLockState>;
  grantExitAndQuit: () => Promise<boolean>;
  onBlockedClose: (cb: () => void) => () => void;
  getKioskHardening: () => Promise<KioskHardening>;
  setInputMouseLocked: (locked: boolean) => Promise<{ ok: boolean; mouseLocked?: boolean; error?: string }>;
  /** Open http(s) URLs via OS browser / download handler (LAN Setup.exe, Release). */
  openExternal: (url: string) => Promise<{ ok: boolean; error?: string }>;
  setDeepLockFrozen: (frozen: boolean) => Promise<{ ok: boolean; error?: string }>;
  setOfflineCustody: (on: boolean) => Promise<{ ok: boolean; error?: string }>;
  getOfflineCustody: () => Promise<{ active: boolean }>;
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
  getDnsServers: () => Promise<string[]>;
  getClientArch: () => Promise<string>;
  getClientHostName: () => Promise<string>;
  killApps: (apps: string[]) => Promise<{ ok: boolean; killed?: string[] }>;
  openApp: (app: string) => Promise<{ ok: boolean; error?: string }>;
  setBlockedHosts: (hosts: string[]) => Promise<{ ok: boolean; count?: number }>;
  setBlockedApps: (apps: string[]) => Promise<{ ok: boolean; count?: number }>;
  verifyOfflineCode: (code: string, hash: string) => Promise<{ ok: boolean }>;
  forceLanSetup: (url: string) => Promise<{ ok: boolean; error?: string; path?: string }>;
};

const api: StudentDesktopAPI = {
  toggleCollapse: () => ipcRenderer.invoke('window:toggle-collapse'),
  getCollapsed: () => ipcRenderer.invoke('window:get-collapsed'),
  snapBottomRight: () => ipcRenderer.invoke('window:snap-bottom-right'),
  setWindowChromePolicy: (policy) => ipcRenderer.invoke('window:set-chrome-policy', policy),
  adminQuit: () => ipcRenderer.invoke('admin:quit'),
  setAutostart: (enabled) => ipcRenderer.invoke('admin:set-autostart', enabled),
  getAutostart: () => ipcRenderer.invoke('admin:get-autostart'),
  openUninstallGuide: () => ipcRenderer.invoke('admin:open-uninstall-guide'),
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (patch) => ipcRenderer.invoke('config:set', patch),
  setApiBase: (apiBase) => ipcRenderer.invoke('config:set', { apiBase }),
  findRemovableConfig: () => ipcRenderer.invoke('config:find-removable'),
  discoverLanClassroom: () => ipcRenderer.invoke('config:discover-lan'),
  onDiscoverProgress: (cb) => {
    const handler = (_: unknown, p: { done: number; total: number; phase?: string }) => cb(p);
    ipcRenderer.on('config:discover-progress', handler);
    return () => ipcRenderer.removeListener('config:discover-progress', handler);
  },
  getExitLockState: () => ipcRenderer.invoke('lock:get-state'),
  markTeacherBonded: () => ipcRenderer.invoke('lock:mark-teacher-bonded'),
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
  setOfflineCustody: (on) => ipcRenderer.invoke('offline:set-custody', on),
  getOfflineCustody: () => ipcRenderer.invoke('offline:get-custody'),
  setDeepLockAggressive: (aggressive) => ipcRenderer.invoke('deep-lock:set-aggressive', aggressive),
  setDeepLockExamUrl: (url, allowHosts) =>
    ipcRenderer.invoke('deep-lock:set-exam-url', url, allowHosts),
  enforceDeepLockBrowsers: (opts) => ipcRenderer.invoke('deep-lock:enforce-browsers', opts),
  getNetworkHint: () => ipcRenderer.invoke('net:get-hint'),
  getDnsServers: () => ipcRenderer.invoke('net:get-dns-servers'),
  getClientArch: () => ipcRenderer.invoke('sys:get-arch'),
  getClientHostName: () => ipcRenderer.invoke('sys:get-hostname'),
  killApps: (apps) => ipcRenderer.invoke('device-control:kill-apps', apps),
  openApp: (app) => ipcRenderer.invoke('device-control:open-app', app),
  setBlockedHosts: (hosts) => ipcRenderer.invoke('device-control:set-blocked-hosts', hosts),
  setBlockedApps: (apps) => ipcRenderer.invoke('device-control:set-blocked-apps', apps),
  verifyOfflineCode: (code, hash) => ipcRenderer.invoke('lock:verify-offline-code', code, hash),
  forceLanSetup: (url) => ipcRenderer.invoke('upgrade:force-lan-setup', url),
};

contextBridge.exposeInMainWorld('classroomDesk', api);
