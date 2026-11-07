import { expect, test } from '@playwright/test';
import { openPrepTab } from './helpers/navPrep';
import { loginTeacherWeb } from './helpers/teacherWebLogin';

const API = process.env.API_BASE ?? 'http://127.0.0.1:8787';

test.describe('assistants SSE list refresh', () => {
  test('API create/disable → settings list updates without reload', async ({ page, request }) => {
    const { password } = await loginTeacherWeb(page, request);
    const login = await request.post(`${API}/api/v1/auth/login`, {
      data: { username: 'teacher', password },
    });
    expect(login.ok()).toBeTruthy();
    const { token } = (await login.json()) as { token: string };
    const auth = { Authorization: `Bearer ${token}` };

    await openPrepTab(page, '设置');
    await expect(page.getByRole('heading', { name: '创建助教账号' })).toBeVisible({
      timeout: 15_000,
    });

    const stamp = Date.now();
    const user = `sse_asst_${stamp}`;
    const pass = `SsePass${stamp % 100000}a9`;
    const created = await request.post(`${API}/api/v1/auth/assistants`, {
      headers: auth,
      data: { username: user, password: pass, displayName: 'SSE助教' },
    });
    expect(created.ok()).toBeTruthy();
    const { id } = (await created.json()) as { id: string };

    await expect(page.getByTestId(`assistant-row-${user}`)).toBeVisible({ timeout: 12_000 });
    await expect(page.getByTestId(`assistant-row-${user}`)).not.toContainText('已停用');

    const disabled = await request.post(`${API}/api/v1/auth/assistants/${id}/disable`, {
      headers: auth,
      data: {},
    });
    expect(disabled.ok()).toBeTruthy();

    await expect(page.getByTestId(`assistant-row-${user}`)).toContainText('已停用', {
      timeout: 12_000,
    });
  });
});
