import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from '@playwright/test';

function loadQuarantine(): string[] {
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'e2e/quarantine.txt'), 'utf8');
    return raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
      .map((l) => l.replace(/^\.\//, ''));
  } catch {
    return [];
  }
}

const quarantine = loadQuarantine();
const skipQuarantine = process.env.CD_E2E_INCLUDE_QUARANTINE === '1' ? [] : quarantine;

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  // Nightly sets CD_E2E_RETRIES=1 (or 2). Smoke gates keep 0 unless CLI overrides.
  retries: Math.max(0, Math.min(2, Number(process.env.CD_E2E_RETRIES) || 0)),
  testIgnore: skipQuarantine,
  use: {
    // Keep traces when a test fails so CI can upload them.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  reporter: [['list']],
});
