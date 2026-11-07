import { expect, test } from '@playwright/test';
import { openPrepTab } from './helpers/navPrep';
import { loginTeacherWeb } from './helpers/teacherWebLogin';

const API = process.env.API_BASE ?? 'http://127.0.0.1:8787';

test.describe('audit detail JSON fold', () => {
  test('bulk delete with long ids → expand/collapse ids in settings', async ({ page, request }) => {
    const { password } = await loginTeacherWeb(page, request);
    const login = await request.post(`${API}/api/v1/auth/login`, {
      data: { username: 'teacher', password },
    });
    expect(login.ok()).toBeTruthy();
    const { token } = (await login.json()) as { token: string };
    const auth = { Authorization: `Bearer ${token}` };

    const classes = await request.get(`${API}/api/v1/classes`, { headers: auth });
    const classId = ((await classes.json()) as { items: Array<{ id: string }> }).items[0]?.id;
    expect(classId).toBeTruthy();

    const stamp = Date.now();
    const ids: string[] = [];
    for (let i = 0; i < 12; i++) {
      const r = await request.post(`${API}/api/v1/classes/${classId}/students`, {
        headers: auth,
        data: { displayName: `审计${stamp}-${i}`, studentNo: `A${stamp}${i}` },
      });
      expect(r.ok()).toBeTruthy();
      ids.push(((await r.json()) as { id: string }).id);
    }

    const soft = await request.post(`${API}/api/v1/classes/${classId}/students/bulk-delete`, {
      headers: auth,
      data: { ids },
    });
    expect(soft.ok()).toBeTruthy();

    await openPrepTab(page, '设置');
    await expect(page.getByRole('heading', { name: /操作审计/ })).toBeVisible({ timeout: 15_000 });

    const expand = page.getByRole('button', { name: /展开 ids（12）/ }).first();
    await expect(expand).toBeVisible({ timeout: 15_000 });
    await expand.click();
    await expect(page.getByTestId('audit-ids-list').first()).toContainText(ids[0]!);
    await expect(page.getByTestId('audit-jump-ids').first()).toBeVisible();
    await page.getByRole('button', { name: '收起 ids' }).first().click();
    await expect(page.getByRole('button', { name: /展开 ids（12）/ }).first()).toBeVisible();
    await page.getByTestId('audit-jump-ids').first().click();
    await expect(page.getByRole('heading', { name: /班级与名单/ })).toBeVisible({ timeout: 20_000 });

    await request.post(`${API}/api/v1/classes/${classId}/students/bulk-purge`, {
      headers: auth,
      data: { ids },
    });
  });
});
