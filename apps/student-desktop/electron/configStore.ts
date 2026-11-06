import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

export type AppConfig = {
  apiBase: string;
};

const DEFAULT: AppConfig = {
  apiBase: 'http://127.0.0.1:8787',
};

function resourceConfigPath(): string {
  // Packaged: <resources>/config.json ; Dev: apps/student-desktop/resources/config.json
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
  const user = readJson(userConfigPath());
  if (user?.apiBase) {
    return { apiBase: String(user.apiBase).replace(/\/$/, '') };
  }

  const bundled = readJson(resourceConfigPath());
  const merged: AppConfig = {
    apiBase: String(bundled?.apiBase ?? DEFAULT.apiBase).replace(/\/$/, ''),
  };

  try {
    fs.mkdirSync(path.dirname(userConfigPath()), { recursive: true });
    if (!fs.existsSync(userConfigPath())) {
      fs.writeFileSync(userConfigPath(), JSON.stringify(merged, null, 2), 'utf8');
    }
  } catch {
    // ignore write failures in restricted environments
  }

  return merged;
}

export function saveConfig(patch: Partial<AppConfig>): AppConfig {
  const current = loadConfig();
  const next: AppConfig = {
    apiBase: String(patch.apiBase ?? current.apiBase).replace(/\/$/, ''),
  };
  fs.mkdirSync(path.dirname(userConfigPath()), { recursive: true });
  fs.writeFileSync(userConfigPath(), JSON.stringify(next, null, 2), 'utf8');
  return next;
}
