import type { APIRequestContext, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import {
  ensureTeacherPasswordReady,
  TEACHER_NEW_PASSWORD,
  TEACHER_USER,
} from './teacherLogin.js';

const TEACHER_WEB = process.env.TEACHER_WEB ?? 'http://localhost:5174';

/** Ensure teacher password is usable, then UI-login on Vite teacher-web. */
export async function loginTeacherWeb(
  page: Page,
  request: APIRequestContext,
): Promise<{ password: string }> {
  const password = await ensureTeacherPasswordReady(request);
  await page.goto(TEACHER_WEB);

  const loginHeading = page.getByRole('heading', { name: /教师后台/ });
  const sessionNav = page.locator('aside').getByRole('button', { name: '上课', exact: true });
  const prepNav = page.locator('aside').getByRole('button', { name: '备课', exact: true });
  await loginHeading.or(sessionNav).or(prepNav).first().waitFor({ state: 'visible', timeout: 20_000 });

  if (await loginHeading.isVisible()) {
    await page.getByLabel('用户名').fill(TEACHER_USER);
    await page.getByLabel('密码').fill(password);
    await page.getByRole('button', { name: '登录' }).click();
  }

  const forceGate = page.getByText('必须先改成个人密码才能使用其它功能');
  await expect(forceGate.or(sessionNav).or(prepNav).first()).toBeVisible({ timeout: 20_000 });
  if (await forceGate.isVisible().catch(() => false)) {
    await page.getByLabel('当前密码').fill(password);
    await page.getByLabel('新密码').fill(TEACHER_NEW_PASSWORD);
    await page.getByRole('button', { name: '修改登录密码' }).click();
    await expect(sessionNav.or(prepNav).first()).toBeVisible({ timeout: 20_000 });
    return { password: TEACHER_NEW_PASSWORD };
  }
  return { password };
}

/** Login as assistant (or any staff). Completes first-login password change when required. */
export async function loginStaffWeb(
  page: Page,
  username: string,
  password: string,
): Promise<string> {
  await page.goto(TEACHER_WEB);
  await page.getByLabel('用户名').fill(username);
  await page.getByLabel('密码').fill(password);
  await page.getByRole('button', { name: '登录' }).click();

  const forceGate = page.getByText('必须先改成个人密码才能使用其它功能');
  const attendance = page.getByRole('heading', { name: '出勤报表' });
  const prepNav = page.locator('aside').getByRole('button', { name: '备课', exact: true });
  await expect(forceGate.or(attendance).or(prepNav).first()).toBeVisible({ timeout: 20_000 });

  if (await forceGate.isVisible().catch(() => false)) {
    const next = `${password}Ok9`;
    await page.getByLabel('当前密码').fill(password);
    await page.getByLabel('新密码').fill(next);
    await page.getByRole('button', { name: '修改登录密码' }).click();
    await expect(attendance.or(prepNav).first()).toBeVisible({ timeout: 20_000 });
    // Assistants land on 出勤 after force change; open 备课 if only nav is visible
    if (!(await attendance.isVisible().catch(() => false))) {
      await prepNav.click();
      const attTab = page.locator('.prep-subnav').getByRole('button', { name: '出勤报表', exact: true });
      if (await attTab.isVisible().catch(() => false)) await attTab.click();
    }
    await expect(attendance).toBeVisible({ timeout: 15_000 });
    return next;
  }
  return password;
}
