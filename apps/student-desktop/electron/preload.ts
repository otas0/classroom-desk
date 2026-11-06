import { contextBridge, ipcRenderer } from 'electron';

export type AppConfig = { apiBase: string };

export type StudentDesktopAPI = {
  toggleCollapse: () => Promise<boolean>;
  getCollapsed: () => Promise<boolean>;
  snapBottomRight: () => Promise<void>;
  adminQuit: () => Promise<void>;
  setAutostart: (enabled: boolean) => Promise<boolean>;
  getAutostart: () => Promise<boolean>;
  openUninstallGuide: () => Promise<{ ok: boolean; platform: string; hint?: string }>;
  getConfig: () => Promise<AppConfig>;
  setApiBase: (apiBase: string) => Promise<AppConfig>;
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
  setApiBase: (apiBase) => ipcRenderer.invoke('config:set-api-base', apiBase),
};

contextBridge.exposeInMainWorld('classroomDesk', api);
