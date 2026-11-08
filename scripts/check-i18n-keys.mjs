#!/usr/bin/env node
/**
 * Fail if any locale catalog is missing keys from packages/i18n/scripts/_ui-zh.json
 * or from the zh-CN catalog itself.
 *
 *   npm run check:i18n-keys
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const localesDir = path.join(root, 'packages/i18n/locales');
const uiListPath = path.join(root, 'packages/i18n/scripts/_ui-zh.json');

const zhCN = JSON.parse(fs.readFileSync(path.join(localesDir, 'zh-CN.json'), 'utf8'));
const uiList = fs.existsSync(uiListPath)
  ? JSON.parse(fs.readFileSync(uiListPath, 'utf8'))
  : Object.keys(zhCN);

const required = new Set([...Object.keys(zhCN), ...uiList]);
const locales = ['zh-CN', 'en', 'zh-TW', 'ja', 'ko'];
let failed = false;

for (const loc of locales) {
  const cat = JSON.parse(fs.readFileSync(path.join(localesDir, `${loc}.json`), 'utf8'));
  const miss = [...required].filter((k) => !(k in cat));
  const extra = Object.keys(cat).filter((k) => !required.has(k));
  console.log(
    JSON.stringify({
      locale: loc,
      keys: Object.keys(cat).length,
      missing: miss.length,
      extra: extra.length,
      missingSample: miss.slice(0, 5),
    }),
  );
  if (miss.length) failed = true;
}

if (failed) {
  console.error('FAIL: locale catalogs missing keys');
  process.exit(1);
}
console.log('OK: all locales cover required keys');
