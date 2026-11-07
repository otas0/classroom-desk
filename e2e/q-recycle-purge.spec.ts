import { expect, test } from '@playwright/test';

const API = process.env.API_BASE ?? 'http://127.0.0.1:8787';
const TEACHER_WEB = process.env.TEACHER_WEB ?? 'http://localhost:5174';

test.describe('question recycle purge-all', () => {
  test('soft-delete → recycle → 一键清空全部', async ({ page, request }) => {
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
    const created = await request.post(`${API}/api/v1/questions`, {
      headers: auth,
      data: {
        classId,
        title: `回收清空${stamp}`,
        stem: '一键清空测？',
        type: 'bool',
        options: [
          { label: 'A', content: '正确', isCorrect: true },
          { label: 'B', content: '错误', isCorrect: false },
        ],
      },
    });
    expect(created.ok()).toBeTruthy();
    const qid = ((await created.json()) as { id: string }).id;

    const soft = await request.post(`${API}/api/v1/questions/bulk`, {
      headers: auth,
      data: { classId, ids: [qid], action: 'delete' },
    });
    expect(soft.ok()).toBeTruthy();

    await page.goto(TEACHER_WEB);
    await page.getByLabel('用户名').fill('teacher');
    await page.getByLabel('密码').fill('TeacherPass123');
    await page.getByRole('button', { name: '登录' }).click();

    const prep = page.getByRole('button', { name: /课前准备|备课/ });
    if (await prep.isVisible().catch(() => false)) {
      await prep.click();
    }
    const recycleNav = page.getByRole('button', { name: '题目回收站', exact: true });
    await expect(recycleNav).toBeVisible({ timeout: 15_000 });
    await recycleNav.click();

    await expect(page.getByTestId('q-recycle-virtual')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(`回收清空${stamp}`)).toBeVisible({ timeout: 15_000 });

    page.once('dialog', (d) => void d.accept());
    await page.getByTestId('q-recycle-purge-all').click();

    await expect(page.getByText(`回收清空${stamp}`)).toHaveCount(0, { timeout: 10_000 });

    const after = await request.get(`${API}/api/v1/questions?classId=${classId}&includeDeleted=1`, {
      headers: auth,
    });
    const ids = ((await after.json()) as { items: Array<{ id: string }> }).items.map((x) => x.id);
    expect(ids.includes(qid)).toBeFalsy();
  });
});
