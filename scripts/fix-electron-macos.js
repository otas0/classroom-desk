import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') {
  process.exit(0);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appPath = path.join(root, 'node_modules/electron/dist/Electron.app');

if (!fs.existsSync(appPath)) {
  process.exit(0);
}

try {
  execSync(`xattr -cr "${appPath}"`, { stdio: 'ignore' });
} catch {
  // Non-fatal: developers can clear quarantine manually if Gatekeeper blocks launch.
}
