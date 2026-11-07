#!/usr/bin/env node
/**
 * Append release tag + tree SHA block to docs/ARTIFACTS.md (idempotent per tag).
 * Invoked by extract-release-notes.mjs on Release workflow.
 *
 * Usage: node scripts/append-artifacts-release.mjs <tag>
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifactsPath = path.join(root, 'docs', 'ARTIFACTS.md');

const rawTag =
  process.argv[2] ||
  process.env.GITHUB_REF_NAME ||
  process.env.npm_config_tag ||
  '';
const tag = String(rawTag).replace(/^refs\/tags\//, '').trim();
if (!tag) {
  console.error('append-artifacts-release: no tag');
  process.exit(1);
}

function sh(cmd) {
  try {
    return execSync(cmd, { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

const tree =
  process.env.TREE_SHA ||
  process.env.GITHUB_SHA_TREE ||
  sh(`git rev-parse ${tag}^{tree}`) ||
  sh('git rev-parse HEAD^{tree}') ||
  'unknown';
const commit =
  process.env.COMMIT_SHA ||
  sh(`git rev-parse ${tag}^{commit}`) ||
  sh('git rev-parse HEAD') ||
  process.env.GITHUB_SHA ||
  'unknown';
const day = new Date().toISOString().slice(0, 10);

let md = fs.readFileSync(artifactsPath, 'utf8');
const marker = `<!-- release-record:${tag} -->`;
if (md.includes(marker)) {
  console.log(`append-artifacts-release: ${tag} already recorded, skip`);
  process.exit(0);
}

const block = `
${marker}
### 发版记录 ${tag}（${day}）

| 字段 | 值 |
|---|---|
| **tag** | \`${tag}\` |
| **tree SHA** | \`${tree}\` |
| **commit SHA**（可能与远程 tip 字面不同） | \`${commit}\` |

badge / 样机核对：优先 **tag**；内容对齐用 **tree SHA**（见上文「Commit SHA vs tree SHA」）。
`;

if (!md.includes('## 发版记录（自动追加）')) {
  md = `${md.trimEnd()}\n\n## 发版记录（自动追加）\n\n由 \`scripts/append-artifacts-release.mjs\` 在 Release 时写入。\n`;
}

md = `${md.trimEnd()}\n${block}\n`;
fs.writeFileSync(artifactsPath, md, 'utf8');
console.log(`append-artifacts-release: wrote ${tag} tree=${tree}`);
