import type { APIRequestContext, Page } from '@playwright/test';
import { LIVE_CLASS_NAV } from './navPrep.js';

const API = process.env.API_BASE ?? 'http://127.0.0.1:8787';

export const TEACHER_USER = process.env.TEACHER_USERNAME ?? 'teacher';
/** Password already set on the deployment (after real change). Falls back to bootstrap. */
export const TEACHER_PASSWORD = process.env.TEACHER_PASSWORD || 'TeacherPass123';
/**
 * If login still forces mustChangePassword, the spec changes to this password
 * so the checklist path can continue. Override with TEACHER_NEW_PASSWORD.
 */
export const TEACHER_NEW_PASSWORD = process.env.TEACHER_NEW_PASSWORD || 'E2eTeacherPass9';

async function tryLogin(request: APIRequestContext, password: string) {
  const login = await request.post(`${API}/api/v1/auth/login`, {
    data: { username: TEACHER_USER, password },
  });
  if (!login.ok()) return null;
  return (await login.json()) as { token: string; mustChangePassword?: boolean };
}

export async function ensureTeacherPasswordReady(request: APIRequestContext): Promise<string> {
  // Prefer already-changed password (common after earlier e2e runs on same DB).
  for (const candidate of [TEACHER_PASSWORD, TEACHER_NEW_PASSWORD]) {
    const body = await tryLogin(request, candidate);
    if (!body) continue;
    if (!body.mustChangePassword) return candidate;
    if (candidate === TEACHER_PASSWORD) {
      const changed = await request.post(`${API}/api/v1/auth/change-password`, {
        headers: { Authorization: `Bearer ${body.token}` },
        data: { currentPassword: TEACHER_PASSWORD, newPassword: TEACHER_NEW_PASSWORD },
      });
      if (!changed.ok()) {
        const err = await changed.text();
        throw new Error(`change-password failed: HTTP ${changed.status()} ${err}`);
      }
      return TEACHER_NEW_PASSWORD;
    }
  }
  throw new Error('teacher login failed for TEACHER_PASSWORD and TEACHER_NEW_PASSWORD');
}

/** UI login that completes forced password change when needed, then reaches 上课. */
export async function loginTeacherUi(page: Page, password: string): Promise<void> {
  await page.goto(`${API}/admin/`);
  const loginHeading = page.getByRole('heading', { name: /教师后台/ });
  const sessionNav = page.getByRole('button', { name: LIVE_CLASS_NAV });
  await loginHeading.or(sessionNav).waitFor({ state: 'visible', timeout: 15_000 });

  if (await loginHeading.isVisible()) {
    await page.getByLabel('用户名').fill(TEACHER_USER);
    await page.getByLabel('密码').fill(password);
    await page.getByRole('button', { name: '登录', exact: true }).click();
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
