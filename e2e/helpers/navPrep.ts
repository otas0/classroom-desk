import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

/** Open 备课 and optionally a prep sub-tab (名单 / 设置 / 发题 / …). */
export async function openPrepTab(page: Page, sub?: string): Promise<void> {
  const prep = page.locator('aside').getByRole('button', { name: '备课', exact: true });
  await expect(prep).toBeVisible({ timeout: 20_000 });
  await prep.click();
  if (sub) {
    const tab = page.locator('.prep-subnav').getByRole('button', { name: sub, exact: true });
    await expect(tab).toBeVisible({ timeout: 15_000 });
    await tab.click();
  }
}
