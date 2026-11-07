import { expect, test } from '@playwright/test';
import { ensureTeacherPasswordReady } from './helpers/teacherLogin';

const API = process.env.API_BASE ?? 'http://127.0.0.1:8787';

test.describe('soft-delete session kick', () => {
  test('online student heartbeat → session_kicked after soft delete', async ({ request }) => {
    const password = await ensureTeacherPasswordReady(request);
    const login = await request.post(`${API}/api/v1/auth/login`, {
      data: { username: 'teacher', password },
    });
    expect(login.ok()).toBeTruthy();
    const { token } = (await login.json()) as { token: string };
    const auth = { Authorization: `Bearer ${token}` };

    const classes = await request.get(`${API}/api/v1/classes`, { headers: auth });
    const classId = ((await classes.json()) as { items: Array<{ id: string }> }).items[0]?.id;
    expect(classId).toBeTruthy();

    const stamp = Date.now();
    const created = await request.post(`${API}/api/v1/classes/${classId}/students`, {
      headers: auth,
      data: { displayName: `踢线${stamp}`, studentNo: `K${stamp}` },
    });
    expect(created.ok()).toBeTruthy();
    const studentId = ((await created.json()) as { id: string }).id;

    const sel = await request.post(`${API}/api/v1/auth/student-select`, {
      data: { classId, studentId },
    });
    expect(sel.ok()).toBeTruthy();
    const studentToken = ((await sel.json()) as { token: string }).token;
    const studentAuth = { Authorization: `Bearer ${studentToken}` };

    const hb1 = await request.post(`${API}/api/v1/presence/heartbeat`, {
      headers: studentAuth,
      data: {},
    });
    expect(hb1.ok()).toBeTruthy();

    const soft = await request.post(`${API}/api/v1/classes/${classId}/students/bulk-delete`, {
      headers: auth,
      data: { ids: [studentId] },
    });
    expect(soft.ok()).toBeTruthy();

    const hb2 = await request.post(`${API}/api/v1/presence/heartbeat`, {
      headers: studentAuth,
      data: {},
    });
    expect(hb2.status()).toBe(401);
    const body = (await hb2.json()) as { error?: string };
    expect(['session_kicked', 'account_deleted']).toContain(body.error);

    const me = await request.get(`${API}/api/v1/auth/me`, { headers: studentAuth });
    expect(me.status()).toBe(401);

    await request.post(`${API}/api/v1/classes/${classId}/students/bulk-purge`, {
      headers: auth,
      data: { ids: [studentId] },
    });
  });
});
