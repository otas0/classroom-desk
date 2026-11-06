import { expect, test } from '@playwright/test';

const API = process.env.API_BASE ?? 'http://127.0.0.1:8787';

test('roster select → point request → teacher confirm', async ({ request }) => {
  const login = await request.post(`${API}/api/v1/auth/login`, {
    data: { username: 'teacher', password: 'TeacherPass123' },
  });
  expect(login.ok()).toBeTruthy();
  const { token } = (await login.json()) as { token: string };

  const classes = await request.get(`${API}/api/v1/classes`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(classes.ok()).toBeTruthy();
  const classId = ((await classes.json()) as { items: Array<{ id: string }> }).items[0]?.id;
  expect(classId).toBeTruthy();

  const name = `PR-${Date.now()}`;
  const imp = await request.post(`${API}/api/v1/classes/${classId}/students/import`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { csv: `姓名,学号\n${name},S${Date.now()}` },
  });
  expect(imp.ok()).toBeTruthy();

  const roster = await request.get(`${API}/api/v1/classes/${classId}/roster`);
  expect(roster.ok()).toBeTruthy();
  const student = ((await roster.json()) as { items: Array<{ id: string; displayName: string }> }).items.find(
    (s) => s.displayName === name,
  );
  expect(student).toBeTruthy();

  const select = await request.post(`${API}/api/v1/auth/student-select`, {
    data: { classId, studentId: student!.id },
  });
  expect(select.ok()).toBeTruthy();
  const joined = (await select.json()) as {
    token: string;
    user: { id: string; classId: string; totalPoints: number };
  };

  const create = await request.post(`${API}/api/v1/point-requests`, {
    headers: { Authorization: `Bearer ${joined.token}` },
    data: { reason: '课堂积极', category: 'behavior', points: 2 },
  });
  expect(create.ok()).toBeTruthy();
  const reqBody = (await create.json()) as { id: string };

  const confirm = await request.post(`${API}/api/v1/point-requests/${reqBody.id}/confirm`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {},
  });
  expect(confirm.ok()).toBeTruthy();

  const points = await request.get(`${API}/api/v1/points/me`, {
    headers: { Authorization: `Bearer ${joined.token}` },
  });
  const me = (await points.json()) as { totalPoints: number };
  expect(me.totalPoints).toBeGreaterThanOrEqual(joined.user.totalPoints + 2);
});
