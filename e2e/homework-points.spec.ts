import { expect, test } from '@playwright/test';

const API = process.env.API_BASE ?? 'http://127.0.0.1:8787';
const TEACHER_WEB = process.env.TEACHER_WEB ?? 'http://localhost:5174';

test.describe('quiz + teacher UI', () => {
  test('teacher publishes question and student answers; admin shows 发题', async ({ request, page }) => {
    const login = await request.post(`${API}/api/v1/auth/login`, {
      data: { username: 'teacher', password: 'TeacherPass123' },
    });
    expect(login.ok()).toBeTruthy();
    const { token } = (await login.json()) as { token: string };

    const classes = await request.get(`${API}/api/v1/classes`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const classId = ((await classes.json()) as { items: Array<{ id: string }> }).items[0]?.id;

    const name = `QZ-${Date.now()}`;
    await request.post(`${API}/api/v1/classes/${classId}/students/import`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { csv: `${name},Z${Date.now()}` },
    });
    const roster = await request.get(`${API}/api/v1/classes/${classId}/roster`);
    const student = ((await roster.json()) as { items: Array<{ id: string; displayName: string }> }).items.find(
      (s) => s.displayName === name,
    );

    const select = await request.post(`${API}/api/v1/auth/student-select`, {
      data: { classId, studentId: student!.id },
    });
    const { token: studentToken } = (await select.json()) as { token: string };

    const create = await request.post(`${API}/api/v1/questions`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        classId,
        title: 'E2E判断',
        stem: '1+1=2？',
        type: 'bool',
        options: [
          { label: 'A', content: '正确', isCorrect: true },
          { label: 'B', content: '错误', isCorrect: false },
        ],
      },
    });
    expect(create.ok()).toBeTruthy();
    const { id: questionId } = (await create.json()) as { id: string };

    const detail = await request.get(`${API}/api/v1/questions?classId=${classId}`, {
      headers: { Authorization: `Bearer ${studentToken}` },
    });
    const q = ((await detail.json()) as { items: Array<{ id: string; options: Array<{ id: string }> }> }).items.find(
      (i) => i.id === questionId,
    );
    const correctOpt = q!.options[0]!.id;

    const ans = await request.post(`${API}/api/v1/questions/${questionId}/answer`, {
      headers: { Authorization: `Bearer ${studentToken}` },
      data: { answerPayload: { optionIds: [correctOpt] } },
    });
    expect(ans.ok()).toBeTruthy();
    expect(((await ans.json()) as { isCorrect: boolean }).isCorrect).toBeTruthy();

    const stats = await request.get(`${API}/api/v1/questions/${questionId}/stats`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(stats.ok()).toBeTruthy();

    await page.goto(TEACHER_WEB);
    await page.getByLabel('用户名').fill('teacher');
    await page.getByLabel('密码').fill('TeacherPass123');
    await page.getByRole('button', { name: '登录' }).click();
    await expect(page.getByRole('button', { name: '发题/正确率', exact: true })).toBeVisible();
  });
});
