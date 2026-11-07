import { expect, test } from '@playwright/test';
import { openPrepTab } from './helpers/navPrep';
import { ensureTeacherPasswordReady, TEACHER_USER } from './helpers/teacherLogin';
import { loginStaffWeb, loginTeacherWeb } from './helpers/teacherWebLogin';

const API = process.env.API_BASE ?? 'http://127.0.0.1:8787';

async function teacherAuth(request: import('@playwright/test').APIRequestContext) {
  const password = await ensureTeacherPasswordReady(request);
  const login = await request.post(`${API}/api/v1/auth/login`, {
    data: { username: TEACHER_USER, password },
  });
  expect(login.ok()).toBeTruthy();
  const { token } = (await login.json()) as { token: string };
  return { Authorization: `Bearer ${token}` };
}

test.describe('exit-lock system generate + cooldown', () => {
  test('PATCH exitUnlockCodeGenerate returns plaintext once; immediate re-gen is 400', async ({
    request,
  }) => {
    const auth = await teacherAuth(request);

    const first = await request.patch(`${API}/api/v1/settings`, {
      headers: auth,
      data: { exitUnlockCodeGenerate: true },
    });
    expect(first.status(), await first.text()).toBe(200);
    const body1 = (await first.json()) as {
      hasExitUnlockCode?: boolean;
      generatedExitUnlockCode?: string;
      exitUnlockCodeRotateDays?: number;
    };
    expect(body1.hasExitUnlockCode).toBe(true);
    expect(body1.exitUnlockCodeRotateDays).toBe(90);
    const code1 = body1.generatedExitUnlockCode?.trim() ?? '';
    expect(code1.length).toBeGreaterThanOrEqual(6);

    const second = await request.patch(`${API}/api/v1/settings`, {
      headers: auth,
      data: { exitUnlockCodeGenerate: true },
    });
    expect(second.status()).toBe(400);
    const err = (await second.json()) as {
      error?: string;
      retryAfterSec?: number;
      message?: string;
    };
    expect(err.error).toBe('exit_unlock_rotate_too_soon');
    expect(Number(err.retryAfterSec)).toBeGreaterThan(0);
    expect(Number(err.retryAfterSec)).toBeLessThanOrEqual(30);

    // Wrong code fails; correct code from this generate succeeds on student unlock path
    const bad = await request.post(`${API}/api/v1/auth/exit-unlock`, {
      data: { code: 'NOT-THE-CODE-XYZ' },
    });
    expect(bad.ok()).toBeFalsy();

    const ok = await request.post(`${API}/api/v1/auth/exit-unlock`, {
      data: { code: code1 },
    });
    expect(ok.ok(), await ok.text()).toBeTruthy();
  });

  test('teacher settings shows rotate days 90 and generate button', async ({ page, request }) => {
    test.setTimeout(90_000);
    await loginTeacherWeb(page, request);
    // Session view has no settings; prep-subnav owns「设置」.
    await openPrepTab(page, '设置');
    await expect(page.getByRole('heading', { name: '学生端退出锁定' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId('exit-unlock-rotate-days-display')).toContainText('90');
    await expect(page.getByTestId('exit-unlock-rotate-days-input')).toHaveValue('90');
    await expect(page.getByTestId('exit-unlock-generate-btn')).toBeVisible();
    await expect(page.getByTestId('exit-unlock-generate-btn')).toBeEnabled();
  });

  test('assistant cannot see generate / save unlock controls', async ({ page, request }) => {
    const auth = await teacherAuth(request);
    const stamp = Date.now();
    const user = `asst_gen_${stamp}`;
    const pass = `AsstPass${stamp % 100000}a9`;
    const created = await request.post(`${API}/api/v1/auth/assistants`, {
      headers: auth,
      data: { username: user, password: pass, displayName: 'E2E助教生成只读' },
    });
    expect(created.ok()).toBeTruthy();

    await loginStaffWeb(page, user, pass);
    // Assistants land on attendance (prep shell); settings is in aside.
    await page.locator('aside').getByRole('button', { name: '设置', exact: true }).click();
    await expect(page.getByTestId('exit-lock-readonly')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('exit-lock-readonly-rotate')).toContainText(/90/);
    await expect(page.getByTestId('exit-unlock-generate-btn')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '保存解除码' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '系统生成并轮换' })).toHaveCount(0);

    const list = await request.get(`${API}/api/v1/auth/assistants`, { headers: auth });
    const items = ((await list.json()) as { items: Array<{ id: string; username: string }> }).items;
    const row = items.find((a) => a.username === user);
    if (row) {
      await request.post(`${API}/api/v1/auth/assistants/${row.id}/disable`, {
        headers: auth,
        data: {},
      });
    }
  });
});
