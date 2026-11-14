import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electronDir = path.join(root, 'node_modules/electron');

// Offline / teacher-host packs: never download Electron from GitHub.
if (
  process.env.ELECTRON_SKIP_BINARY_DOWNLOAD === '1' ||
  process.env.CLASSROOM_DESK_OFFLINE === '1' ||
  fs.existsSync(path.join(root, '.classroom-desk-offline-ready'))
) {
  process.exit(0);
}

if (!fs.existsSync(electronDir)) {
  process.exit(0);
}

function binaryPath() {
  if (process.platform === 'darwin') {
    return path.join(electronDir, 'dist/Electron.app/Contents/MacOS/Electron');
  }
  if (process.platform === 'win32') {
    return path.join(electronDir, 'dist/electron.exe');
  }
  return path.join(electronDir, 'dist/electron');
}

const binary = binaryPath();

function ensureBinary() {
  if (fs.existsSync(binary) && fs.statSync(binary).size > 0) {
    return true;
  }
  console.log('[postinstall] Electron binary missing — running node_modules/electron/install.js …');
  try {
    execSync('node install.js', { cwd: electronDir, stdio: 'inherit' });
  } catch (e) {
    console.error('[postinstall] electron install.js failed:', e instanceof Error ? e.message : e);
    return false;
  }
  return fs.existsSync(binary) && fs.statSync(binary).size > 0;
}

if (!ensureBinary()) {
  console.error('[postinstall] Electron binary still missing after install:', binary);
  process.exitCode = 1;
} else {
  console.log('[postinstall] Electron binary OK:', binary);
}

if (process.platform === 'darwin') {
  const appPath = path.join(electronDir, 'dist/Electron.app');
  if (fs.existsSync(appPath)) {
    try {
      execSync(`xattr -cr "${appPath}"`, { stdio: 'ignore' });
    } catch {
      // Non-fatal: developers can clear quarantine manually if Gatekeeper blocks launch.
    }
  }
}
