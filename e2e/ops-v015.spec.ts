/**
 * v0.1.5 targeted gates: password-policy extras, attendance-absent export,
 * scan-assign audit event — complements ops-polish in bulk gate.
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

test('password-policy merges server extra weak list', async ({ request }) => {
  const password = await ensureTeacherPasswordReady(request);
  const headers = await authHeaders(request, password);

  const marker = `E2eWeakExtra${Date.now()}`;
  const patch = await request.patch(`${API}/api/v1/settings`, {
    headers,
    data: { weakTeacherPasswordsExtra: [marker] },
  });
  expect(patch.ok()).toBeTruthy();

  const policy = await request.get(`${API}/api/v1/auth/password-policy`);
  expect(policy.ok()).toBeTruthy();
  const body = (await policy.json()) as { weakPasswords: string[]; minLength: number };
  expect(body.minLength).toBe(8);
  expect(body.weakPasswords).toContain('TeacherPass123');
  expect(body.weakPasswords).toContain(marker);

  const reject = await request.post(`${API}/api/v1/auth/change-password`, {
    headers,
    data: { currentPassword: password, newPassword: marker },
  });
  expect(reject.status()).toBe(400);
  const err = (await reject.json()) as { error?: string };
  expect(err.error).toBe('weak_password');

  // cleanup extras
  await request.patch(`${API}/api/v1/settings`, {
    headers,
    data: { weakTeacherPasswordsExtra: [] },
  });
});

test('attendance-absent export with leave/late columns + xlsx', async ({ request }) => {
  const password = await ensureTeacherPasswordReady(request);
  const headers = await authHeaders(request, password);

  const { classId } = await createDedicatedClass(request, headers, 'OpsAbs');

  const sess = await request.post(`${API}/api/v1/attendance/sessions`, {
    headers,
    data: { classId, mode: 'manual' },
  });
  expect(sess.ok()).toBeTruthy();
  const sessionId = ((await sess.json()) as { id: string }).id;

  const csv = await request.get(
    `${API}/api/v1/exports/attendance-absent?classId=${classId}&sessionId=${sessionId}&format=csv`,
    { headers },
  );
  expect(csv.ok()).toBeTruthy();
  const text = await csv.text();
  expect(text).toMatch(/缺勤/);
  expect(text).toMatch(/请假/);
  expect(text).toMatch(/迟到/);

  const xlsx = await request.get(
    `${API}/api/v1/exports/attendance-absent?classId=${classId}&sessionId=${sessionId}&format=xlsx`,
    { headers },
  );
  expect(xlsx.ok()).toBeTruthy();
  const buf = Buffer.from(await xlsx.body());
  expect(buf[0]).toBe(0x50); // P
  expect(buf[1]).toBe(0x4b); // K zip/xlsx
  expect(buf.length).toBeGreaterThan(800);
});

test('scan_assign_cta audit event + ops-polish attendance still wired', async ({ request }) => {
  const password = await ensureTeacherPasswordReady(request);
  const headers = await authHeaders(request, password);

  const { classId } = await createDedicatedClass(request, headers, 'OpsScan');

  const ev = await request.post(`${API}/api/v1/audit/events`, {
    headers,
    data: {
      action: 'setup.scan_assign_cta',
      classId,
      detail: { source: 'e2e', at: new Date().toISOString() },
    },
  });
  expect(ev.status()).toBe(201);

  const ready = await request.post(`${API}/api/v1/audit/events`, {
    headers,
    data: {
      action: 'setup.classroom_ready',
      classId,
      detail: { durationMs: 12000, onlineCount: 1 },
    },
  });
  expect(ready.status()).toBe(201);

  const audit = await request.get(
    `${API}/api/v1/audit?classId=${encodeURIComponent(classId!)}&action=setup.scan_assign_cta&limit=20`,
    { headers },
  );
  expect(audit.ok()).toBeTruthy();
  const items = ((await audit.json()) as { items: Array<{ action: string }> }).items;
  expect(items.some((i) => i.action === 'setup.scan_assign_cta')).toBeTruthy();
});
