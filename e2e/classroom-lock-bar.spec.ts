import { expect, test } from '@playwright/test';
import { LIVE_CLASS_NAV } from './helpers/navPrep';
import { loginTeacherWeb } from './helpers/teacherWebLogin';
import { resetUiLocaleZhCN } from './helpers/uiLocale';

test.describe('classroom lock quick bar', () => {
  test('session page shows lock shortcuts for current class', async ({ page, request }) => {
    await resetUiLocaleZhCN(request);
    await loginTeacherWeb(page, request);
    await page.locator('aside').getByRole('button', { name: LIVE_CLASS_NAV }).click();
    const bar = page.getByTestId('classroom-lock-bar');
    await expect(bar).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('lock-quick-km')).toBeVisible();
    await expect(page.getByTestId('lock-chip-keyboard')).toBeVisible();
    await expect(page.getByTestId('lock-open-advanced')).toBeVisible();

    await page.getByTestId('lock-quick-km').click();
    await expect(page.getByTestId('classroom-lock-status')).toContainText(/状态：已锁|Status: locked|状態：ロック|상태: 잠김/i, {
      timeout: 10_000,
    });
    await expect(page.getByTestId('lock-quick-unlock')).toBeEnabled({ timeout: 10_000 });
    await page.getByTestId('lock-quick-unlock').click();
    await expect(page.getByTestId('classroom-lock-status')).toContainText(/状态：未锁定|Status: unlocked|状態：未ロック|상태: 잠금 없음/i, {
      timeout: 10_000,
    });
  });
});
