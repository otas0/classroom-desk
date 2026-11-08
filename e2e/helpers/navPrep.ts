import type { APIRequestContext, Page } from '@playwright/test';
import { expect } from '@playwright/test';

const API = process.env.API_BASE ?? 'http://127.0.0.1:8787';

/** Align UI class select with the classId used by API seed (avoids localStorage drift). */
export async function selectTeacherClass(page: Page, classId: string): Promise<void> {
  const sel = page.locator('aside select').first();
  await expect(sel).toBeVisible({ timeout: 15_000 });
  // Wait until SPA class list includes the API-created id (reload races loadClasses).
  await expect
    .poll(
      async () =>
        sel.locator('option').evaluateAll((os, id) => os.some((o) => (o as HTMLOptionElement).value === id), classId),
      { timeout: 20_000 },
    )
    .toBe(true);
  await sel.selectOption(classId);
  await expect(sel).toHaveValue(classId, { timeout: 10_000 });
  // PreferClassroomId may re-apply when loadClasses settles; settle then re-assert.
  await expect
    .poll(async () => sel.inputValue(), { timeout: 10_000 })
    .toBe(classId);
}

/**
 * Create an empty class for e2e isolation (shared items[0]/本教室 is raced by parallel bulk specs).
 * Caller should `page.reload()` before `selectTeacherClass` so the SPA select includes the new id.
 */
export async function createDedicatedClass(
  request: APIRequestContext,
  auth: { Authorization: string },
  namePrefix: string,
): Promise<{ classId: string; stamp: number }> {
  const stamp = Date.now();
  const created = await request.post(`${API}/api/v1/classes`, {
    headers: auth,
    data: { name: `${namePrefix}_${stamp}` },
  });
  expect(created.ok()).toBeTruthy();
  const classId = ((await created.json()) as { id: string }).id;
  expect(classId).toBeTruthy();
  return { classId, stamp };
}

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

/** Expand folded advanced input-lock controls in 设置. */
export async function openInputLockAdvanced(page: Page): Promise<void> {
  const details = page.getByTestId('input-lock-advanced');
  await expect(details).toBeVisible({ timeout: 15_000 });
  const isOpen = await details.evaluate((el) => (el as HTMLDetailsElement).open);
  if (!isOpen) {
    await details.locator('summary').click();
  }
  await expect(page.getByTestId('input-lock-scope')).toBeVisible({ timeout: 5_000 });
}
