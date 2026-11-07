import { expect, test } from '@playwright/test';
import { ensureTeacherPasswordReady } from './helpers/teacherLogin';
import { loginStaffWeb, loginTeacherWeb } from './helpers/teacherWebLogin';
import { openPrepTab } from './helpers/navPrep';

const API = process.env.API_BASE ?? 'http://127.0.0.1:8787';

test.describe('settings-save-msg single mount', () => {
  test('teacher prep→settings: at most one settings-save-msg after save', async ({
    page,
    request,
  }) => {
    await loginTeacherWeb(page, request);
    await openPrepTab(page, '设置');
    const ttl = page.getByLabel('有效期（分钟）');
    await expect(ttl).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: '保存设置', exact: true }).click();
    await expect(page.getByTestId('settings-save-msg').first()).toBeVisible({ timeout: 8_000 });
    await expect(page.getByTestId('settings-save-msg')).toHaveCount(1);
  });

  test('assistant top-nav 设置: single mount + exit-lock readonly', async ({ page, request }) => {
    const password = await ensureTeacherPasswordReady(request);
    const login = await request.post(`${API}/api/v1/auth/login`, {
      data: { username: 'teacher', password },
    });
    expect(login.ok()).toBeTruthy();
    const { token } = (await login.json()) as { token: string };
    const auth = { Authorization: `Bearer ${token}` };
    const stamp = Date.now();
    const user = `asst_save_${stamp}`;
    const pass = `AsstPass${stamp % 100000}s9`;
    const created = await request.post(`${API}/api/v1/auth/assistants`, {
      headers: auth,
      data: { username: user, password: pass, displayName: 'SaveMsg助教' },
    });
    expect(created.ok()).toBeTruthy();

    await loginStaffWeb(page, user, pass);
    // may hit must-change-password — skip soft if gated
    const gate = page.getByText('请先修改个人密码');
    if (await gate.isVisible().catch(() => false)) {
      test.skip(true, 'assistant must-change-password gate');
    }

    await page.locator('aside').getByRole('button', { name: '设置', exact: true }).click();
    await expect(page.getByTestId('exit-lock-readonly')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: '保存解除码' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '保存限流与轮换' })).toHaveCount(0);
    // One SettingsPanel only (no dual settings-save-msg host)
    await expect(page.locator('#exit-lock-settings')).toHaveCount(1);
  });
});
