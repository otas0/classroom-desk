import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const API = process.env.API_BASE ?? 'http://127.0.0.1:8787';
const STUDENT_WEB = process.env.STUDENT_WEB ?? 'http://127.0.0.1:5173';

async function studentReachable(): Promise<boolean> {
  try {
    const res = await fetch(STUDENT_WEB, { signal: AbortSignal.timeout(2000) });
    return res.ok || res.status === 200;
  } catch {
    return false;
  }
}

test.describe('exit-lock student toast', () => {
  test('WS failover shows SSE toast copy', async ({ page }) => {
    test.skip(!(await studentReachable()), `start student vite: ELECTRON_OFF=1 npm run dev --workspace=@classroom-desk/student-desktop`);

    // Point student UI at live API (api.ts key).
    await page.addInitScript((apiBase) => {
      localStorage.setItem('classroom-desk.api-base', apiBase);
    }, API);

    // Ensure student config.json fallback also ok if present in public/resources
    const cfgPath = path.join(
      process.cwd(),
      'apps/student-desktop/resources/config.json',
    );
    if (fs.existsSync(cfgPath)) {
      /* leave file; localStorage override wins in app */
    }

    await page.goto(`${STUDENT_WEB}/?e2e=1`, { waitUntil: 'domcontentloaded' });

    // Wait until failover hook is registered (health + WS open path).
    await expect
      .poll(async () =>
        page.evaluate(() => typeof (window as unknown as { __cdForceExitLockFailover?: () => void }).__cdForceExitLockFailover),
      )
      .toBe('function');

    await page.evaluate(() => {
      (window as unknown as { __cdForceExitLockFailover: () => void }).__cdForceExitLockFailover();
    });

    const toast = page.getByTestId('app-toast');
    await expect(toast).toBeVisible({ timeout: 8_000 });
    await expect(toast).toContainText('实时通道已切到备用');
    await expect(toast).toContainText('WebSocket');
  });
});
