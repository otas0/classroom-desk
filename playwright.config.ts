import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  // Global CI retries:0 — flaky full-suite doubling is expensive.
  // RBAC/session-kick gate passes `--retries=1` explicitly in ci.yml.
  retries: 0,
  use: {
    // Keep traces when a test fails so CI can upload them.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  reporter: [['list']],
});
