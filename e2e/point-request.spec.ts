import { expect, test } from '@playwright/test';

const API = process.env.API_BASE ?? 'http://127.0.0.1:8787';

test('student point request confirmed by teacher writes points_log', async ({ request }) => {
  const login = await request.post(`${API}/api/v1/auth/login`, {
    data: { username: 'teacher', password: 'TeacherPass123' },
  });
  expect(login.ok()).toBeTruthy();
  const { token } = (await login.json()) as { token: string };

  const join = await request.post(`${API}/api/v1/auth/student-join`, {
    data: { classCode: 'DEMO01', displayName: `PR-${Date.now()}` },
  });
  expect(join.ok()).toBeTruthy();
  const joined = (await join.json()) as {
    token: string;
    user: { id: string; classId: string; totalPoints: number };
  };

  const create = await request.post(`${API}/api/v1/point-requests`, {
    headers: { Authorization: `Bearer ${joined.token}` },
    data: { reason: '课堂积极', category: 'behavior', points: 2 },
  });
  expect(create.ok()).toBeTruthy();
  const reqBody = (await create.json()) as { id: string; countdownSeconds: number };
  expect(reqBody.countdownSeconds).toBeGreaterThan(0);

  const pending = await request.get(`${API}/api/v1/point-requests/pending?classId=${joined.user.classId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(pending.ok()).toBeTruthy();
  const pendingItems = (await pending.json()) as { items: Array<{ id: string }> };
  expect(pendingItems.items.some((i) => i.id === reqBody.id)).toBeTruthy();

  const confirm = await request.post(`${API}/api/v1/point-requests/${reqBody.id}/confirm`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {},
  });
  expect(confirm.ok()).toBeTruthy();

  const points = await request.get(`${API}/api/v1/points/me`, {
    headers: { Authorization: `Bearer ${joined.token}` },
  });
  expect(points.ok()).toBeTruthy();
  const me = (await points.json()) as { totalPoints: number; items: Array<{ source: string }> };
  expect(me.totalPoints).toBeGreaterThanOrEqual(joined.user.totalPoints + 2);
  expect(me.items.some((i) => i.source === 'request')).toBeTruthy();

  const pendingAfter = await request.get(`${API}/api/v1/point-requests/pending?classId=${joined.user.classId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const afterItems = (await pendingAfter.json()) as { items: Array<{ id: string }> };
  expect(afterItems.items.some((i) => i.id === reqBody.id)).toBeFalsy();
});
