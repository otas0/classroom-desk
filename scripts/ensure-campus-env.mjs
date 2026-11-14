#!/usr/bin/env node
/**
 * Campus (school-net) minimal env on top of classroom minimal.
 * School IT only fills ONE gateway block (opnsense | unifi | http).
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(root, '.env');
const force = process.argv.includes('--force');

spawnSync(process.execPath, [path.join(root, 'scripts/ensure-minimal-env.mjs')], {
  cwd: root,
  stdio: 'inherit',
});

let text = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
const add = [];
function ensureLine(key, value) {
  if (new RegExp(`^${key}=`, 'm').test(text)) return;
  add.push(`${key}=${value}`);
}

ensureLine('CLASSROOM_DESK_CAMPUS', '1');
ensureLine('CLASSROOM_DESK_MINIMAL', '1');
// Soft campus: do not force SSID sig via env
if (!/^CLASSROOM_DESK_PORTAL_SSID_REQUIRE_SIG=/m.test(text)) {
  add.push('# CLASSROOM_DESK_PORTAL_SSID_REQUIRE_SIG=1  # only for hard Captive');
}

const gatewayBlock = `
# --- 校园网：只填下面三选一（填完重启）---
# A) OPNsense
# CLASSROOM_DESK_SHIELD=opnsense
# OPNSENSE_URL=https://192.168.1.1
# OPNSENSE_API_KEY=
# OPNSENSE_API_SECRET=
# B) UniFi
# CLASSROOM_DESK_SHIELD=unifi
# UNIFI_URL=https://192.168.1.1
# UNIFI_USER=
# UNIFI_PASS=
# C) HTTP 网关 / lab
# CLASSROOM_DESK_SHIELD=http
# CLASSROOM_DESK_SHIELD_URL=http://127.0.0.1:8791
# CLASSROOM_DESK_SHIELD_TOKEN=
`;

if (!text.includes('校园网：只填下面三选一') && (force || !text.includes('OPNSENSE_URL='))) {
  add.push(gatewayBlock.trim());
}

if (add.length) {
  text = `${text.trimEnd()}\n\n# campus (${new Date().toISOString().slice(0, 10)})\n${add.join('\n')}\n`;
  fs.writeFileSync(envPath, text, { mode: 0o600 });
  console.log(`[campus-env] updated ${envPath}`);
} else {
  console.log(`[campus-env] ${envPath} already has campus keys`);
}

console.log('');
console.log('=== 校园网最小路径 ===');
console.log('1. npm run start:campus');
console.log('2. 编辑 .env：三选一填网关 URL + 账号/密钥（可不填 = 仅门户/Zones，UI 显示网关未断）');
console.log('3. 设置 → 网络档：按本校改「学生网/教工网」SSID 关键字');
console.log('文档: docs/CAMPUS_MINIMAL.md');
console.log('');
