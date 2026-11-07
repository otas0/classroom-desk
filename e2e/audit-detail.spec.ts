import { expect, test } from '@playwright/test';

const API = process.env.API_BASE ?? 'http://127.0.0.1:8787';
const TEACHER_WEB = process.env.TEACHER_WEB ?? 'http://localhost:5174';

test.describe('audit detail JSON fold', () => {
  test('bulk delete with long ids → expand/collapse ids in settings', async ({ page, request }) => {
    const login = await request.post(`${API}/api/v1/auth/login`, {
      data: { username: 'teacher', password: 'TeacherPass123' },
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

    await page.goto(TEACHER_WEB);
    await page.getByLabel('用户名').fill('teacher');
    await page.getByLabel('密码').fill('TeacherPass123');
    await page.getByRole('button', { name: '登录' }).click();

    const prep = page.getByRole('button', { name: /课前准备|备课/ });
    if (await prep.isVisible().catch(() => false)) await prep.click();
    await page.getByRole('button', { name: '设置', exact: true }).click();
    await expect(page.getByRole('heading', { name: /操作审计/ })).toBeVisible({ timeout: 15_000 });

    const expand = page.getByRole('button', { name: /展开 ids（12）/ }).first();
    await expect(expand).toBeVisible({ timeout: 15_000 });
    await expand.click();
    await expect(page.locator('pre.audit-ids').first()).toContainText(ids[0]!);
    await page.getByRole('button', { name: '收起 ids' }).first().click();
    await expect(page.getByRole('button', { name: /展开 ids（12）/ }).first()).toBeVisible();

    await request.post(`${API}/api/v1/classes/${classId}/students/bulk-purge`, {
      headers: auth,
      data: { ids },
    });
  });
});
