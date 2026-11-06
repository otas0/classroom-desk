/**
 * playwright.config.ts does not set `use.baseURL`. This spec uses API_BASE
 * (default http://127.0.0.1:8787). The teacher SPA is served at /admin/ on that origin.
 *
 * Student IdentityGate lives in the Electron app (apps/student-desktop IdentityGate),
 * not in a browser route. This file therefore walks the teacher checklist path
 * (login → 上课 → 开课准备) and, when no student web app is available, asserts the
 * teacher assign page exposes the classId copy UI used to point each desk at a student.
 * If the account still has the bootstrap password, 上课/指派 stay hidden behind
 * the forced password-change screen; the spec asserts that gate and does not change the password.
 */
import { expect, test } from '@playwright/test';

const API = process.env.API_BASE ?? 'http://127.0.0.1:8787';
const TEACHER_USER = process.env.TEACHER_USERNAME ?? 'teacher';
const TEACHER_PASSWORD = process.env.TEACHER_PASSWORD || 'TeacherPass123';

test('teacher checklist path and classId copy when student web is absent', async ({ page, request }) => {
  const health = await request.get(`${API}/health`);
  expect(health.ok()).toBeTruthy();

  await page.goto(`${API}/admin/`);
  const loginHeading = page.getByRole('heading', { name: /教师后台/ });
  const sessionNav = page.getByRole('button', { name: '上课' });
  await expect(loginHeading.or(sessionNav)).toBeVisible({ timeout: 15_000 });

  if (await loginHeading.isVisible()) {
    await page.getByLabel('用户名').fill(TEACHER_USER);
    await page.getByLabel('密码').fill(TEACHER_PASSWORD);
    await page.getByRole('button', { name: '登录' }).click();
  }

  const passwordGate = page.getByText('请先修改个人密码');
  await expect(sessionNav.or(passwordGate)).toBeVisible({ timeout: 15_000 });

  const studentWeb = await request.get(`${API}/student/`);
  expect(studentWeb.ok(), 'student IdentityGate is Electron-only; /student/ is not a web app').toBeFalsy();

  if (await passwordGate.isVisible()) {
    // Bootstrap password hides 上课/备课/指派 until it is changed in 设置.
    await expect(page.getByRole('heading', { name: '设置' })).toBeVisible();
    await expect(page.getByRole('button', { name: '修改登录密码' })).toBeVisible();
    return;
  }

  await expect(sessionNav).toBeVisible();
  await expect(page.getByRole('button', { name: '备课' })).toBeVisible();

  const checklist = page.getByRole('heading', { name: /开课准备|开课清单/ });
  if ((await checklist.count()) > 0) {
    await expect(checklist).toBeVisible();
    await expect(page.getByText('建班并导入名单')).toBeVisible();
    await expect(page.getByText('发第一题')).toBeVisible();
    await expect(page.getByRole('button', { name: /创建班级|去导入名单|去指派学生机|去发第一题/ })).toBeVisible();
  }

  await page.getByRole('button', { name: '指派学生机' }).click();
  await expect(page.getByRole('heading', { name: '上课前指派学生机' })).toBeVisible();
  await expect(page.getByRole('button', { name: '复制 classId' })).toBeVisible();
  await expect(page.getByText(/classId/)).toBeVisible();
});
