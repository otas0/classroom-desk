import { expect, test } from '@playwright/test';

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

test.describe('exit-lock blocked close toast', () => {
  test('simulate Alt+F4 / close → toast 向教师申请解除', async ({ page }) => {
    test.skip(
      !(await studentReachable()),
      'start student vite: ELECTRON_OFF=1 npm run dev --workspace=@classroom-desk/student-desktop',
    );

    await page.addInitScript((apiBase) => {
      localStorage.setItem('classroom-desk.api-base', apiBase);
      localStorage.removeItem('cd_hardening_tip_dismissed');
    }, API);

    await page.goto(`${STUDENT_WEB}/?e2e=1`, { waitUntil: 'domcontentloaded' });

    await expect
      .poll(async () =>
        page.evaluate(
          () =>
            typeof (window as unknown as { __cdSimulateBlockedClose?: () => void })
              .__cdSimulateBlockedClose,
        ),
      )
      .toBe('function');

    await page.evaluate(() => {
      (window as unknown as { __cdSimulateBlockedClose: () => void }).__cdSimulateBlockedClose();
    });

    const toast = page.getByTestId('exit-lock-blocked-toast');
    await expect(toast).toBeVisible({ timeout: 8_000 });
    await expect(toast).toContainText('向教师申请解除');
  });

  test('showHardening tip is dismissible', async ({ page }) => {
    test.skip(!(await studentReachable()), 'student vite required');
    await page.addInitScript((apiBase) => {
      localStorage.setItem('classroom-desk.api-base', apiBase);
      localStorage.removeItem('cd_hardening_tip_dismissed');
    }, API);
    await page.goto(`${STUDENT_WEB}/?e2e=1&showHardening=1`, { waitUntil: 'domcontentloaded' });
    const tip = page.getByTestId('hardening-tip');
    await expect(tip).toBeVisible({ timeout: 10_000 });
    await expect(tip).toContainText('本机未加固');
    await page.getByTestId('hardening-tip-dismiss').click();
    await expect(tip).toHaveCount(0);
  });
});
