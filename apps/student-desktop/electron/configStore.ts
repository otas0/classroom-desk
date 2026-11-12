import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

export type AppConfig = {
  apiBase: string;
  /** Class assigned to this student machine by teacher before class. */
  classId: string;
  /** Optional podium label remembered for reconnect / header chip. */
  displayName?: string;
  className?: string;
};

const DEFAULT: AppConfig = {
  apiBase: 'http://127.0.0.1:8787',
  classId: '',
  displayName: '',
  className: '',
};

function resourceConfigPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'config.json');
  }
  return path.join(app.getAppPath(), 'resources', 'config.json');
}

function userConfigPath(): string {
  return path.join(app.getPath('userData'), 'config.json');
}

function readJson(filePath: string): Partial<AppConfig> | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as Partial<AppConfig>;
  } catch {
    return null;
  }
}

export function loadConfig(): AppConfig {
  const bundled = readJson(resourceConfigPath());
  const user = readJson(userConfigPath());
  const merged: AppConfig = {
    apiBase: String(user?.apiBase ?? bundled?.apiBase ?? DEFAULT.apiBase).replace(/\/$/, ''),
    classId: String(user?.classId ?? bundled?.classId ?? DEFAULT.classId).trim(),
    displayName: String(user?.displayName ?? bundled?.displayName ?? DEFAULT.displayName ?? '').trim(),
    className: String(user?.className ?? bundled?.className ?? DEFAULT.className ?? '').trim(),
  };

  try {
    fs.mkdirSync(path.dirname(userConfigPath()), { recursive: true });
    if (!fs.existsSync(userConfigPath())) {
      fs.writeFileSync(userConfigPath(), JSON.stringify(merged, null, 2), 'utf8');
    }
  } catch {
    // ignore
  }

  return merged;
}

export function saveConfig(patch: Partial<AppConfig>): AppConfig {
  const current = loadConfig();
  const next: AppConfig = {
    apiBase: String(patch.apiBase ?? current.apiBase).replace(/\/$/, ''),
    classId: String(patch.classId ?? current.classId).trim(),
    displayName: String(
      patch.displayName !== undefined ? patch.displayName : (current.displayName ?? ''),
    ).trim(),
    className: String(
      patch.className !== undefined ? patch.className : (current.className ?? ''),
    ).trim(),
  };
  fs.mkdirSync(path.dirname(userConfigPath()), { recursive: true });
  fs.writeFileSync(userConfigPath(), JSON.stringify(next, null, 2), 'utf8');
  return next;
}
