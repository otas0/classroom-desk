#!/usr/bin/env node
/**
 * Wrap catalog Chinese string literals / JSX text with t('…').
 * Adds `import { t } from '@classroom-desk/i18n'` when needed.
 *
 *   node packages/i18n/scripts/codemod-wrap-t.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const keys = Object.keys(
  JSON.parse(fs.readFileSync(path.join(root, 'packages/i18n/locales/zh-CN.json'), 'utf8')),
).sort((a, b) => b.length - a.length);

const targets = [
  'apps/teacher-web/src',
  'apps/student-desktop/src',
];

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (/\.(tsx|ts)$/.test(ent.name) && !ent.name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function wrapFile(file) {
  let src = fs.readFileSync(file, 'utf8');
  if (!/[\u4e00-\u9fff]/.test(src)) return false;
  let changed = false;

  for (const key of keys) {
    if (!src.includes(key)) continue;
    const esc = escapeRe(key);

    // JSX text >key<  → >{t('key')}<
    const jsxRe = new RegExp(`>(\\s*)${esc}(\\s*)<`, 'g');
    const nextJsx = src.replace(jsxRe, (_m, a, b) => {
      changed = true;
      return `>${a}{t('${key.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}')}${b}<`;
    });
    src = nextJsx;

    // 'key' or "key" not already inside t(  → t('key')
    for (const q of [`'`, `"`]) {
      const lit = `${q}${key}${q}`;
      if (!src.includes(lit)) continue;
      let i = 0;
      let out = '';
      while (i < src.length) {
        const idx = src.indexOf(lit, i);
        if (idx < 0) {
          out += src.slice(i);
          break;
        }
        out += src.slice(i, idx);
        const before = src.slice(Math.max(0, idx - 3), idx);
        // skip if already t('…' or t("…
        if (/t\(\s*$/.test(before) || before.endsWith('t(')) {
          out += lit;
          i = idx + lit.length;
          continue;
        }
        // skip import paths / comments lightly
        const lineStart = src.lastIndexOf('\n', idx) + 1;
        const line = src.slice(lineStart, idx);
        if (/^\s*\/\//.test(line) || /from\s+$/.test(line)) {
          out += lit;
          i = idx + lit.length;
          continue;
        }
        out += `t('${key.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}')`;
        changed = true;
        i = idx + lit.length;
      }
      src = out;
    }
  }

  if (!changed) return false;

  if (!src.includes("from '@classroom-desk/i18n'") && !src.includes('from "@classroom-desk/i18n"')) {
    // insert after last import
    const importRe = /^(import[\s\S]*?;\n)+/m;
    if (importRe.test(src)) {
      src = src.replace(importRe, (block) => `${block}import { t } from '@classroom-desk/i18n';\n`);
    } else {
      src = `import { t } from '@classroom-desk/i18n';\n${src}`;
    }
  } else if (!/\bt\b/.test(src.match(/import\s*\{([^}]*)\}\s*from\s*['"]@classroom-desk\/i18n['"]/)?.[1] ?? 't')) {
    src = src.replace(
      /import\s*\{([^}]*)\}\s*from\s*['"]@classroom-desk\/i18n['"]/,
      (_m, inner) => `import { ${inner.trim() ? `${inner.trim()}, t` : 't'} } from '@classroom-desk/i18n'`,
    );
  }

  fs.writeFileSync(file, src);
  return true;
}

let n = 0;
for (const dir of targets) {
  for (const f of walk(path.join(root, dir))) {
    if (wrapFile(f)) {
      n += 1;
      console.log('updated', path.relative(root, f));
    }
  }
}
console.log('files updated', n);
