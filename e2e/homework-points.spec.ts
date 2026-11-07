import { expect, test } from '@playwright/test';
import { ensureTeacherPasswordReady, TEACHER_USER } from './helpers/teacherLogin';
import { loginTeacherWeb } from './helpers/teacherWebLogin';

const API = process.env.API_BASE ?? 'http://127.0.0.1:8787';

test.describe('quiz + teacher UI', () => {
  test('teacher publishes question and student answers; admin shows 发题', async ({ request, page }) => {
    const password = await ensureTeacherPasswordReady(request);
    const login = await request.post(`${API}/api/v1/auth/login`, {
      data: { username: TEACHER_USER, password },
    });
    expect(login.ok()).toBeTruthy();
    const { token } = (await login.json()) as { token: string };
    const auth = { Authorization: `Bearer ${token}` };

    const classes = await request.get(`${API}/api/v1/classes`, { headers: auth });
    const items = ((await classes.json()) as { items: Array<{ id: string; name: string }> }).items;
    const classId =
      items.find((c) => c.name === '本教室')?.id ?? items[0]?.id;
    expect(classId).toBeTruthy();

    const stamp = Date.now();
    const name = `QZ-${stamp}`;
    const created = await request.post(`${API}/api/v1/classes/${classId}/students`, {
      headers: auth,
      data: { displayName: name, studentNo: `Z${stamp}` },
    });
    expect(created.ok()).toBeTruthy();
    const studentId = ((await created.json()) as { id: string }).id;

    const select = await request.post(`${API}/api/v1/auth/student-select`, {
      data: { classId, studentId },
    });
    expect(select.ok()).toBeTruthy();
    const { token: studentToken } = (await select.json()) as { token: string };

    const create = await request.post(`${API}/api/v1/questions`, {
      headers: auth,
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
      headers: auth,
    });
    expect(stats.ok()).toBeTruthy();

    await loginTeacherWeb(page, request);
    const prep = page.locator('aside').getByRole('button', { name: '备课', exact: true });
    await expect(prep).toBeVisible({ timeout: 15_000 });
    await prep.click();
    await expect(page.locator('.prep-subnav').getByRole('button', { name: '发题', exact: true })).toBeVisible({
      timeout: 15_000,
    });
  });
});

