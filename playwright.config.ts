import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 0,
  use: {
    trace: 'on-first-retry',
  },
  reporter: [['list']],
});
