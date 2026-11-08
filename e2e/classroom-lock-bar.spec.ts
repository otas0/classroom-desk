import { expect, test } from '@playwright/test';
import { loginTeacherWeb } from './helpers/teacherWebLogin';

test.describe('classroom lock quick bar', () => {
  test('session page shows lock shortcuts for current class', async ({ page, request }) => {
    await loginTeacherWeb(page, request);
    await page.locator('aside').getByRole('button', { name: '上课' }).click();
    const bar = page.getByTestId('classroom-lock-bar');
    await expect(bar).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('lock-quick-km')).toBeVisible();
    await expect(page.getByTestId('lock-chip-keyboard')).toBeVisible();
    await expect(page.getByTestId('lock-open-advanced')).toBeVisible();

    await page.getByTestId('lock-quick-km').click();
    await expect(page.getByTestId('classroom-lock-status')).toContainText(/已锁|locked|ロック|잠김/i, {
      timeout: 10_000,
    });
    await expect(page.getByTestId('lock-quick-unlock')).toBeEnabled({ timeout: 5_000 });
    await page.getByTestId('lock-quick-unlock').click();
    await expect(page.getByTestId('classroom-lock-status')).toContainText(/未锁定|unlocked|未ロック|잠금 없음/i, {
      timeout: 10_000,
    });
  });
});
