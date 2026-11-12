#!/usr/bin/env node
/**
 * Fail if any locale catalog is missing keys from packages/i18n/scripts/_ui-zh.json
 * or from the zh-CN catalog itself.
 * Also checks packages/i18n/locales/portal/* share the same message keys.
 *
 *   npm run check:i18n-keys
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const localesDir = path.join(root, 'packages/i18n/locales');
const portalDir = path.join(localesDir, 'portal');
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

// Portal captive catalogs must stay in sync across locales.
const portalLocales = locales;
const portalZh = JSON.parse(fs.readFileSync(path.join(portalDir, 'zh-CN.json'), 'utf8'));
const portalRequired = new Set(Object.keys(portalZh));
for (const loc of portalLocales) {
  const file = path.join(portalDir, `${loc}.json`);
  if (!fs.existsSync(file)) {
    console.error(JSON.stringify({ portalLocale: loc, error: 'missing_file' }));
    failed = true;
    continue;
  }
  const cat = JSON.parse(fs.readFileSync(file, 'utf8'));
  const miss = [...portalRequired].filter((k) => !(k in cat));
  const extra = Object.keys(cat).filter((k) => !portalRequired.has(k));
  console.log(
    JSON.stringify({
      portalLocale: loc,
      keys: Object.keys(cat).length,
      missing: miss.length,
      extra: extra.length,
      missingSample: miss.slice(0, 5),
    }),
  );
  if (miss.length || extra.length) failed = true;
}

if (failed) {
  console.error('FAIL: locale catalogs missing keys (UI and/or portal)');
  process.exit(1);
}
console.log('OK: all locales cover required keys (UI + portal)');
