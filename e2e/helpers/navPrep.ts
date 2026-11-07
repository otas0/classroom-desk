import type { APIRequestContext, Page } from '@playwright/test';
import { expect } from '@playwright/test';

const API = process.env.API_BASE ?? 'http://127.0.0.1:8787';

/** Align UI class select with the classId used by API seed (avoids localStorage drift). */
export async function selectTeacherClass(page: Page, classId: string): Promise<void> {
  const sel = page.locator('aside select').first();
  await expect(sel).toBeVisible({ timeout: 15_000 });
  await sel.selectOption(classId);
  await expect(sel).toHaveValue(classId, { timeout: 10_000 });
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
