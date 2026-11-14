#!/usr/bin/env node
/**
 * Campus school-net start: minimal classroom + campus soft preset on boot.
 *   npm run start:campus
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const skipBuild = process.argv.includes('--skip-build');

function run(cmd, args, envExtra = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: root,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: {
        ...process.env,
        HOST: process.env.HOST || '0.0.0.0',
        CLASSROOM_DESK_CAMPUS: '1',
        CLASSROOM_DESK_MINIMAL: '1',
        ...envExtra,
      },
    });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(' ')} exited ${code}`));
    });
  });
}

await run(npm, ['run', 'ensure:campus-env']);
console.log('[start:campus] 软件侧会自动套校园网宽松预设（Zones + 私人设备门户；SSID 签名默认关）');
console.log('[start:campus] 真断网：.env 三选一填 OPNsense / UniFi / HTTP，见 docs/CAMPUS_MINIMAL.md');
const args = ['run', 'start:minimal'];
if (skipBuild) args.push('--', '--skip-build');
await run(npm, args);
