import { expect, test } from '@playwright/test';
import { loginTeacherWeb } from './helpers/teacherWebLogin';

const API = process.env.API_BASE ?? 'http://127.0.0.1:8787';

test.describe('classroom uiLocale', () => {
  test('teacher settings changes language; public settings exposes uiLocale', async ({
    page,
    request,
  }) => {
    await loginTeacherWeb(page, request);
    // Teacher: 备课 → 设置
    await page.locator('aside').getByRole('button', { name: '备课' }).click();
    await page.locator('.prep-subnav').getByRole('button', { name: '设置' }).click();
    const select = page.getByTestId('ui-locale-select');
    await expect(select).toBeVisible({ timeout: 15_000 });

    await select.selectOption('en');
    await expect(page.getByTestId('ui-locale-save-msg')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible({ timeout: 10_000 });

    const pub = await request.get(`${API}/api/v1/settings/public`);
    expect(pub.ok()).toBeTruthy();
    expect(((await pub.json()) as { uiLocale?: string }).uiLocale).toBe('en');

    // restore zh-CN for other suites sharing the same API DB
    await select.selectOption('zh-CN');
    await expect(page.getByRole('heading', { name: '设置' })).toBeVisible({ timeout: 10_000 });
  });
});
