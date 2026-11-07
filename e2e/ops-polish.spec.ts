/**
 * Ops polish: attendance export + session filter, quiz confirm setting,
 * multi-choice reject when zero correct options.
 */
import { expect, test } from '@playwright/test';
import { createDedicatedClass } from './helpers/navPrep';
import { ensureTeacherPasswordReady, TEACHER_USER } from './helpers/teacherLogin';

const API = process.env.API_BASE ?? 'http://127.0.0.1:8787';

async function authHeaders(request: import('@playwright/test').APIRequestContext, password: string) {
  const login = await request.post(`${API}/api/v1/auth/login`, {
    data: { username: TEACHER_USER, password },
  });
  expect(login.ok()).toBeTruthy();
  const body = (await login.json()) as { token: string; mustChangePassword?: boolean };
  expect(body.mustChangePassword).toBeFalsy();
  return { Authorization: `Bearer ${body.token}` };
}

test('attendance stats session filter + CSV export', async ({ request }) => {
  const password = await ensureTeacherPasswordReady(request);
  const headers = await authHeaders(request, password);

  const { classId } = await createDedicatedClass(request, headers, 'OpsAtt');

  const month = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
  const sess = await request.post(`${API}/api/v1/attendance/sessions`, {
    headers,
    data: { classId, mode: 'manual' },
  });
  expect(sess.ok()).toBeTruthy();
  const session = (await sess.json()) as { id: string };

  const statsAll = await request.get(
    `${API}/api/v1/attendance/stats?classId=${classId}&month=${month}`,
    { headers },
  );
  expect(statsAll.ok()).toBeTruthy();
  const allBody = (await statsAll.json()) as { sessionCount: number };

  const statsOne = await request.get(
    `${API}/api/v1/attendance/stats?classId=${classId}&month=${month}&sessionId=${session.id}`,
    { headers },
  );
  expect(statsOne.ok()).toBeTruthy();
  const oneBody = (await statsOne.json()) as { sessionCount: number; sessionId: string | null };
  expect(oneBody.sessionCount).toBe(1);
  expect(oneBody.sessionId).toBe(session.id);
  expect(allBody.sessionCount).toBeGreaterThanOrEqual(1);

  const csv = await request.get(
    `${API}/api/v1/exports/attendance?classId=${classId}&month=${month}&sessionId=${session.id}&format=csv`,
    { headers },
  );
  expect(csv.ok()).toBeTruthy();
  const text = await csv.text();
  expect(text).toMatch(/班级|学生|场次/);
});

test('quiz confirm submit toggle via settings', async ({ request }) => {
  const password = await ensureTeacherPasswordReady(request);
  const headers = await authHeaders(request, password);

  const off = await request.patch(`${API}/api/v1/settings`, {
    headers,
    data: { quizConfirmSubmit: false },
  });
  expect(off.ok()).toBeTruthy();
  const pubOff = await request.get(`${API}/api/v1/settings/public`);
  expect(pubOff.ok()).toBeTruthy();
  expect(((await pubOff.json()) as { quizConfirmSubmit?: boolean }).quizConfirmSubmit).toBe(false);

  const on = await request.patch(`${API}/api/v1/settings`, {
    headers,
    data: { quizConfirmSubmit: true },
  });
  expect(on.ok()).toBeTruthy();
  const pubOn = await request.get(`${API}/api/v1/settings/public`);
  expect(((await pubOn.json()) as { quizConfirmSubmit?: boolean }).quizConfirmSubmit).toBe(true);
});

test('multi question with zero correct options is rejected', async ({ request }) => {
  const password = await ensureTeacherPasswordReady(request);
  const headers = await authHeaders(request, password);
  const { classId } = await createDedicatedClass(request, headers, 'OpsMulti');

  const bad = await request.post(`${API}/api/v1/questions`, {
    headers,
    data: {
      classId,
      title: 'e2e multi no correct',
      stem: 'should fail',
      type: 'multi',
      options: [
        { label: 'A', content: '一', isCorrect: false },
        { label: 'B', content: '二', isCorrect: false },
        { label: 'C', content: '三', isCorrect: false },
      ],
    },
  });
  expect(bad.status()).toBe(400);
  const err = (await bad.json()) as { error?: string };
  expect(err.error).toMatch(/correct_option_required|invalid/);
});
