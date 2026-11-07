import { expect, test } from '@playwright/test';
import { ensureTeacherPasswordReady, TEACHER_USER } from './helpers/teacherLogin';

const API = process.env.API_BASE ?? 'http://127.0.0.1:8787';

test('roster select → point request → teacher confirm', async ({ request }) => {
  const password = await ensureTeacherPasswordReady(request);
  const login = await request.post(`${API}/api/v1/auth/login`, {
    data: { username: TEACHER_USER, password },
  });
  expect(login.ok()).toBeTruthy();
  const { token } = (await login.json()) as { token: string };
  const auth = { Authorization: `Bearer ${token}` };

  const classes = await request.get(`${API}/api/v1/classes`, { headers: auth });
  expect(classes.ok()).toBeTruthy();
  const items = ((await classes.json()) as { items: Array<{ id: string; name: string }> }).items;
  const classId = items.find((c) => c.name === '本教室')?.id ?? items[0]?.id;
  expect(classId).toBeTruthy();

  const stamp = Date.now();
  const name = `PR-${stamp}`;
  const created = await request.post(`${API}/api/v1/classes/${classId}/students`, {
    headers: auth,
    data: { displayName: name, studentNo: `S${stamp}` },
  });
  expect(created.ok()).toBeTruthy();
  const studentId = ((await created.json()) as { id: string }).id;

  const select = await request.post(`${API}/api/v1/auth/student-select`, {
    data: { classId, studentId },
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
    headers: auth,
    data: {},
  });
  expect(confirm.ok()).toBeTruthy();

  const points = await request.get(`${API}/api/v1/points/me`, {
    headers: { Authorization: `Bearer ${joined.token}` },
  });
  const me = (await points.json()) as { totalPoints: number };
  expect(me.totalPoints).toBeGreaterThanOrEqual(joined.user.totalPoints + 2);
});
