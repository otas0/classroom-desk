import { expect, test } from '@playwright/test';

const API = process.env.API_BASE ?? 'http://127.0.0.1:8787';
const TEACHER_WEB = process.env.TEACHER_WEB ?? 'http://localhost:5174';

test.describe('bulk delete UI path', () => {
  test('roster checkbox → impact modal → soft delete hides row', async ({ page, request }) => {
    const login = await request.post(`${API}/api/v1/auth/login`, {
      data: { username: 'teacher', password: 'TeacherPass123' },
    });
    expect(login.ok()).toBeTruthy();
    const { token } = (await login.json()) as { token: string };
    const auth = { Authorization: `Bearer ${token}` };

    const classes = await request.get(`${API}/api/v1/classes`, { headers: auth });
    const classId = ((await classes.json()) as { items: Array<{ id: string }> }).items[0]?.id;
    const stamp = Date.now();
    const created = await request.post(`${API}/api/v1/classes/${classId}/students`, {
      headers: auth,
      data: { displayName: `UI删${stamp}`, studentNo: `U${stamp}` },
    });
    expect(created.ok()).toBeTruthy();
    const studentId = ((await created.json()) as { id: string }).id;

    await page.goto(TEACHER_WEB);
    await page.getByLabel('用户名').fill('teacher');
    await page.getByLabel('密码').fill('TeacherPass123');
    await page.getByRole('button', { name: '登录' }).click();

    // Navigate to 课前准备 / 名单
    const prep = page.getByRole('button', { name: /课前准备|备课/ });
    if (await prep.isVisible().catch(() => false)) {
      await prep.click();
    }
    const rosterNav = page.getByRole('button', { name: '名单', exact: true });
    await expect(rosterNav).toBeVisible({ timeout: 15_000 });
    await rosterNav.click();

    const check = page.getByTestId(`student-check-${studentId}`);
    await expect(check).toBeVisible({ timeout: 15_000 });
    await check.check();

    await page.getByTestId('bulk-delete-students').click();
    await expect(page.getByRole('dialog', { name: '确认移入回收站' })).toBeVisible();
    await page.getByRole('button', { name: '移入回收站' }).click();

    await expect(page.getByTestId(`student-check-${studentId}`)).toHaveCount(0, { timeout: 10_000 });

    const roster = await request.get(`${API}/api/v1/classes/${classId}/roster`);
    const ids = ((await roster.json()) as { items: Array<{ id: string }> }).items.map((x) => x.id);
    expect(ids.includes(studentId)).toBeFalsy();

    // cleanup
    await request.post(`${API}/api/v1/classes/${classId}/students/bulk-purge`, {
      headers: auth,
      data: { ids: [studentId] },
    });
  });
});
