import { expect, test } from '@playwright/test';

const TEACHER_WEB = process.env.TEACHER_WEB ?? 'http://localhost:5174';
const API = process.env.API_BASE ?? 'http://127.0.0.1:8787';

test.describe('PERMISSIONS.md link', () => {
  test('settings link opens matrix doc (Vite public)', async ({ page, request }) => {
    const login = await request.post(`${API}/api/v1/auth/login`, {
      data: { username: 'teacher', password: 'TeacherPass123' },
    });
    expect(login.ok()).toBeTruthy();

    await page.goto(TEACHER_WEB);
    await page.getByLabel('用户名').fill('teacher');
    await page.getByLabel('密码').fill('TeacherPass123');
    await page.getByRole('button', { name: '登录' }).click();

    const prep = page.getByRole('button', { name: /课前准备|备课/ });
    if (await prep.isVisible().catch(() => false)) await prep.click();
    await page.getByRole('button', { name: '设置', exact: true }).click();

    const link = page.getByTestId('permissions-doc-link').first();
    await expect(link).toBeVisible({ timeout: 15_000 });
    const href = await link.getAttribute('href');
    expect(href).toBeTruthy();
    expect(href!).toMatch(/PERMISSIONS\.md$/);

    const doc = await request.get(new URL(href!, TEACHER_WEB).toString());
    expect(doc.ok()).toBeTruthy();
    const text = await doc.text();
    expect(text).toContain('角色权限矩阵');
    expect(text).toContain('assistant');
  });
});
