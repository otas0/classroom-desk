import type { APIRequestContext, Page } from '@playwright/test';

const API = process.env.API_BASE ?? 'http://127.0.0.1:8787';

export const TEACHER_USER = process.env.TEACHER_USERNAME ?? 'teacher';
/** Password already set on the deployment (after real change). Falls back to bootstrap. */
export const TEACHER_PASSWORD = process.env.TEACHER_PASSWORD || 'TeacherPass123';
/**
 * If login still forces mustChangePassword, the spec changes to this password
 * so the checklist path can continue. Override with TEACHER_NEW_PASSWORD.
 */
export const TEACHER_NEW_PASSWORD = process.env.TEACHER_NEW_PASSWORD || 'E2eTeacherPass9';

export async function ensureTeacherPasswordReady(request: APIRequestContext): Promise<string> {
  const tryLogin = async (password: string) =>
    request.post(`${API}/api/v1/auth/login`, {
      data: { username: TEACHER_USER, password },
    });

  let login = await tryLogin(TEACHER_PASSWORD);
  let passwordUsed = TEACHER_PASSWORD;

  if (!login.ok() && TEACHER_NEW_PASSWORD !== TEACHER_PASSWORD) {
    login = await tryLogin(TEACHER_NEW_PASSWORD);
    passwordUsed = TEACHER_NEW_PASSWORD;
  }

  if (!login.ok()) {
    throw new Error(`teacher login failed: HTTP ${login.status()}`);
  }
  const body = (await login.json()) as {
    token: string;
    mustChangePassword?: boolean;
  };
  if (!body.mustChangePassword) return passwordUsed;

  const changed = await request.post(`${API}/api/v1/auth/change-password`, {
    headers: { Authorization: `Bearer ${body.token}` },
    data: { currentPassword: passwordUsed, newPassword: TEACHER_NEW_PASSWORD },
  });
  if (!changed.ok()) {
    const err = await changed.text();
    throw new Error(`change-password failed: HTTP ${changed.status()} ${err}`);
  }
  return TEACHER_NEW_PASSWORD;
}

/** UI login that completes forced password change when needed, then reaches 上课. */
export async function loginTeacherUi(page: Page, password: string): Promise<void> {
  await page.goto(`${API}/admin/`);
  const loginHeading = page.getByRole('heading', { name: /教师后台/ });
  const sessionNav = page.getByRole('button', { name: '上课' });
  await loginHeading.or(sessionNav).waitFor({ state: 'visible', timeout: 15_000 });

  if (await loginHeading.isVisible()) {
    await page.getByLabel('用户名').fill(TEACHER_USER);
    await page.getByLabel('密码').fill(password);
    await page.getByRole('button', { name: '登录' }).click();
  }

  const passwordGate = page.getByText('请先修改个人密码');
  await sessionNav.or(passwordGate).waitFor({ state: 'visible', timeout: 15_000 });

  if (await passwordGate.isVisible()) {
    await page.getByLabel('当前密码').fill(password);
    await page.getByLabel('新密码').fill(TEACHER_NEW_PASSWORD);
    await page.getByRole('button', { name: '修改登录密码' }).click();
    await sessionNav.waitFor({ state: 'visible', timeout: 15_000 });
  }
}
