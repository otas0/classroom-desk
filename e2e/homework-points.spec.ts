import { expect, test } from '@playwright/test';

const API = process.env.API_BASE ?? 'http://127.0.0.1:8787';
const TEACHER_WEB = process.env.TEACHER_WEB ?? 'http://localhost:5174';

test.describe('login → assignment → points', () => {
  test('teacher reviews homework and student points increase', async ({ request, page }) => {
    const health = await request.get(`${API}/health`);
    expect(health.ok()).toBeTruthy();

    const login = await request.post(`${API}/api/v1/auth/login`, {
      data: { username: 'teacher', password: 'TeacherPass123' },
    });
    expect(login.ok()).toBeTruthy();
    const { token } = (await login.json()) as { token: string };

    const join = await request.post(`${API}/api/v1/auth/student-join`, {
      data: { classCode: 'DEMO01', displayName: `E2E-${Date.now()}` },
    });
    expect(join.ok()).toBeTruthy();
    const joined = (await join.json()) as {
      token: string;
      user: { id: string; classId: string; totalPoints: number };
    };

    const create = await request.post(`${API}/api/v1/assignments`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        classId: joined.user.classId,
        title: 'E2E作业',
        description: 'playwright',
        maxPoints: 5,
      },
    });
    expect(create.ok()).toBeTruthy();
    const { id: assignmentId } = (await create.json()) as { id: string };

    const submit = await request.post(`${API}/api/v1/assignments/${assignmentId}/submit`, {
      headers: { Authorization: `Bearer ${joined.token}` },
      data: { note: 'done' },
    });
    expect(submit.ok()).toBeTruthy();

    const review = await request.post(`${API}/api/v1/assignments/${assignmentId}/review`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        studentId: joined.user.id,
        status: 'approved',
        pointsDelta: 5,
        reason: 'E2E通过',
      },
    });
    expect(review.ok()).toBeTruthy();

    const points = await request.get(`${API}/api/v1/points/me`, {
      headers: { Authorization: `Bearer ${joined.token}` },
    });
    expect(points.ok()).toBeTruthy();
    const body = (await points.json()) as { totalPoints: number };
    expect(body.totalPoints).toBeGreaterThanOrEqual(joined.user.totalPoints + 5);

    await page.goto(TEACHER_WEB);
    await page.getByLabel('用户名').fill('teacher');
    await page.getByLabel('密码').fill('TeacherPass123');
    await page.getByRole('button', { name: '登录' }).click();
    await expect(page.getByRole('button', { name: '作业', exact: true })).toBeVisible();
  });
});

