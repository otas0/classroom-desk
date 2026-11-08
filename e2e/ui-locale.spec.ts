import { expect, test } from '@playwright/test';
import { loginTeacherWeb } from './helpers/teacherWebLogin';
import { resetUiLocaleZhCN } from './helpers/uiLocale';

const API = process.env.API_BASE ?? 'http://127.0.0.1:8787';

test.describe('classroom uiLocale', () => {
  // Shared API DB — keep this file from racing Chinese-label suites.
  test.describe.configure({ mode: 'serial' });

  test.afterEach(async ({ request }) => {
    await resetUiLocaleZhCN(request);
  });

  test('teacher settings changes language; public settings exposes uiLocale', async ({
    page,
    request,
  }) => {
    await resetUiLocaleZhCN(request);
    await loginTeacherWeb(page, request);
    await page.locator('aside').getByRole('button', { name: '备课' }).click();
    await page.locator('.prep-subnav').getByRole('button', { name: '设置' }).click();
    const select = page.getByTestId('ui-locale-select');
    await expect(select).toBeVisible({ timeout: 15_000 });

    await select.selectOption('en');
    await expect
      .poll(
        async () => {
          const pub = await request.get(`${API}/api/v1/settings/public`);
          if (!pub.ok()) return '';
          return ((await pub.json()) as { uiLocale?: string }).uiLocale ?? '';
        },
        { timeout: 10_000 },
      )
      .toBe('en');
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('ui-locale-save-msg')).toBeVisible({ timeout: 5_000 });

    await select.selectOption('zh-CN');
    await expect
      .poll(
        async () => {
          const pub = await request.get(`${API}/api/v1/settings/public`);
          if (!pub.ok()) return '';
          return ((await pub.json()) as { uiLocale?: string }).uiLocale ?? '';
        },
        { timeout: 10_000 },
      )
      .toBe('zh-CN');
    await expect(page.getByRole('heading', { name: '设置' })).toBeVisible({ timeout: 10_000 });
  });
});
