import { expect, test } from '@playwright/test';
import { openPrepTab } from './helpers/navPrep';
import { loginTeacherWeb } from './helpers/teacherWebLogin';
import { ensureTeacherPasswordReady, TEACHER_USER } from './helpers/teacherLogin';

const API = process.env.API_BASE ?? 'http://127.0.0.1:8787';

test.describe('ops unhardened threshold anchor + audit filter', () => {
  test('健康仪表盘 link scrolls to #unhardened-alert-threshold', async ({ page, request }) => {
    await loginTeacherWeb(page, request);
    await openPrepTab(page, '健康仪表盘');
    await expect(page.getByTestId('ops-unhardened-threshold')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('ops-unhardened-threshold-link').click();
    await expect(page.getByTestId('unhardened-alert-threshold')).toBeVisible({ timeout: 15_000 });
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const el = document.getElementById('unhardened-alert-threshold');
            if (!el) return false;
            const r = el.getBoundingClientRect();
            return r.top >= -40 && r.top < window.innerHeight;
          }),
        { timeout: 8_000 },
      )
      .toBe(true);
  });

  test('audit filter settings.unhardened_threshold lists only that action', async ({
    page,
    request,
  }) => {
    const password = await ensureTeacherPasswordReady(request);
    const login = await request.post(`${API}/api/v1/auth/login`, {
      data: { username: TEACHER_USER, password },
    });
    expect(login.ok()).toBeTruthy();
    const { token } = (await login.json()) as { token: string };
    const auth = { Authorization: `Bearer ${token}` };

    const patch = await request.patch(`${API}/api/v1/settings`, {
      headers: auth,
      data: { unhardenedAlertThreshold: 0.41 },
    });
    expect(patch.ok()).toBeTruthy();

    await loginTeacherWeb(page, request);
    await openPrepTab(page, '设置');
    await expect(page.getByRole('heading', { name: /操作审计/ })).toBeVisible({ timeout: 15_000 });
    const auditCard = page
      .locator('.card')
      .filter({ has: page.getByRole('heading', { name: /操作审计/ }) });
    await expect(page.getByTestId('audit-filter-unhardened-threshold')).toBeVisible();
    await page.getByTestId('audit-filter-unhardened-threshold').click();
    // Wait for select + useEffect(loadAudit) — do not click 刷新审计 (stale closure race).
    await expect(auditCard.locator('select').nth(1)).toHaveValue('settings.unhardened_threshold', {
      timeout: 8_000,
    });
    await expect
      .poll(
        async () => {
          const items = auditCard.locator('li');
          const n = await items.count();
          if (n === 0) return 'empty';
          const texts = await items.allTextContents();
          return texts.every((t) => /settings\.unhardened_threshold/.test(t)) ? 'ok' : 'mixed';
        },
        { timeout: 15_000 },
      )
      .toBe('ok');
  });
});
