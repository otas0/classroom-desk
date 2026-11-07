#!/usr/bin/env node
/**
 * Extract the CHANGELOG.md section for the current git tag (or argv[2] / GITHUB_REF_NAME)
 * into RELEASE_NOTES.md for softprops/action-gh-release body_path.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const changelogPath = path.join(root, 'CHANGELOG.md');
const outPath = path.join(root, 'RELEASE_NOTES.md');

const rawTag =
  process.argv[2] ||
  process.env.GITHUB_REF_NAME ||
  process.env.npm_config_tag ||
  '';
const tag = String(rawTag).replace(/^refs\/tags\//, '').trim();
if (!tag) {
  console.error('extract-release-notes: no tag (pass argv or set GITHUB_REF_NAME)');
  process.exit(1);
}
const version = tag.replace(/^v/, '');

const md = fs.readFileSync(changelogPath, 'utf8');
const lines = md.split(/\r?\n/);
const startRe = new RegExp(`^##\\s+v?${version.replace(/\./g, '\\.')}\\b`);
const start = lines.findIndex((line) => startRe.test(line));
let body;
if (start < 0) {
  body = [
    `# Classroom Desk ${tag}`,
    '',
    `CHANGELOG 中未找到「## v${version}」段落，请补全后重发。`,
    '',
    '完整日志见仓库 CHANGELOG.md。',
    '',
  ].join('\n');
  console.warn(`extract-release-notes: section v${version} missing; wrote stub`);
} else {
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i])) {
      end = i;
      break;
    }
  }
  body = `${lines.slice(start, end).join('\n').trim()}\n`;
}

const install = `
---

## 安装说明

教师机 / 学生机步骤见 [docs/SETUP_FROM_GITHUB.md](https://github.com/otas0/classroom-desk/blob/${tag}/docs/SETUP_FROM_GITHUB.md)。

学生机：下载本页 \`ClassroomDesk-Setup-*.exe\` + \`config.example.json\`。安装后可用首次引导或扫教师 QR 写入 \`apiBase\` / \`classId\`。禁止 127.0.0.1。

未签名包：SmartScreen → 更多信息 → 仍要运行（[docs/SMARTSCREEN.md](https://github.com/otas0/classroom-desk/blob/${tag}/docs/SMARTSCREEN.md)）。
`.trim();

fs.writeFileSync(outPath, `${body.trim()}\n\n${install}\n`, 'utf8');
console.log(`wrote ${outPath} for ${tag} (${body.length} chars section)`);
