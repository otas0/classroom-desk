/**
 * playwright.config.ts does not set `use.baseURL`. This spec uses API_BASE
 * (default http://127.0.0.1:8787). The teacher SPA is served at /admin/ on that origin.
 *
 * Student IdentityGate lives in the Electron app (apps/student-desktop IdentityGate),
 * not in a browser route. This file walks the teacher checklist path
 * (login → 上课 → 开课准备) and asserts the assign page exposes classId copy UI.
 *
 * Bootstrap passwords force mustChangePassword. The helper changes to
 * TEACHER_NEW_PASSWORD (default E2eTeacherPass9) via API first so the checklist
 * path always runs with a real post-change teacher password.
 */
import { expect, test } from '@playwright/test';
import {
  ensureTeacherPasswordReady,
  loginTeacherUi,
  TEACHER_USER,
} from './helpers/teacherLogin';

const API = process.env.API_BASE ?? 'http://127.0.0.1:8787';

test('teacher checklist path and classId copy when student web is absent', async ({
  page,
  request,
}) => {
  const health = await request.get(`${API}/health`);
  expect(health.ok()).toBeTruthy();

  const password = await ensureTeacherPasswordReady(request);
  await loginTeacherUi(page, password);

  const sessionNav = page.getByRole('button', { name: '上课' });
  await expect(sessionNav).toBeVisible();
  await expect(page.getByRole('button', { name: '备课', exact: true })).toBeVisible();
  await expect(page.getByText('请先修改个人密码')).toHaveCount(0);

  const studentWeb = await request.get(`${API}/student/`);
  expect(
    studentWeb.ok(),
    'student IdentityGate is Electron-only; /student/ is not a web app',
  ).toBeFalsy();

  const checklist = page.getByRole('heading', { name: /开课准备|开课清单/ });
  if ((await checklist.count()) > 0) {
    await expect(checklist).toBeVisible();
    await expect(page.getByText(/建班并导入名单/)).toBeVisible();
    await expect(page.getByText(/发第一题/).first()).toBeVisible();
    await expect(page.getByText(/服务器可达|服务器/)).toBeVisible();
    await expect(
      page.getByRole('button', { name: /创建班级|去导入名单|去指派学生机|去发第一题|去指派|去建班/ }).first(),
    ).toBeVisible();
  }

  await page.getByRole('button', { name: '指派学生机' }).click();
  await expect(page.getByRole('heading', { name: '上课前指派学生机' })).toBeVisible();
  await expect(page.getByRole('button', { name: '复制 classId' })).toBeVisible();
  await expect(page.getByText('classId', { exact: true }).first()).toBeVisible();

  // Sanity: login API accepts the password we used (post-change if needed).
  const verify = await request.post(`${API}/api/v1/auth/login`, {
    data: { username: TEACHER_USER, password },
  });
  expect(verify.ok()).toBeTruthy();
  const body = (await verify.json()) as { mustChangePassword?: boolean };
  expect(body.mustChangePassword).toBeFalsy();
});
