import { contextBridge, ipcRenderer } from 'electron';

export type AppConfig = { apiBase: string; classId: string };

export type ExitLockState = {
  exitAllowed: boolean;
  allowStudentExitEnv?: boolean;
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
  getExitLockState: () => Promise<ExitLockState>;
  setExitAllowed: (allowed: boolean) => Promise<ExitLockState>;
  grantExitAndQuit: () => Promise<boolean>;
  onBlockedClose: (cb: () => void) => () => void;
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
  getExitLockState: () => ipcRenderer.invoke('lock:get-state'),
  setExitAllowed: (allowed) => ipcRenderer.invoke('lock:set-exit-allowed', allowed),
  grantExitAndQuit: () => ipcRenderer.invoke('lock:grant-exit-and-quit'),
  onBlockedClose: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('lock:blocked-close', handler);
    return () => ipcRenderer.removeListener('lock:blocked-close', handler);
  },
};

contextBridge.exposeInMainWorld('classroomDesk', api);
