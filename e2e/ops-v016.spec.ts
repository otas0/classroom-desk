/**
 * Presence SSE + classroom readiness audit + ops dashboard readiness stats.
 */
import { expect, test } from '@playwright/test';
import { ensureTeacherPasswordReady, TEACHER_USER } from './helpers/teacherLogin';

const API = process.env.API_BASE ?? 'http://127.0.0.1:8787';

async function authHeaders(request: import('@playwright/test').APIRequestContext, password: string) {
  const login = await request.post(`${API}/api/v1/auth/login`, {
    data: { username: TEACHER_USER, password },
  });
  expect(login.ok()).toBeTruthy();
  const body = (await login.json()) as { token: string };
  return { Authorization: `Bearer ${body.token}`, token: body.token };
}

test('presence SSE hello + classroom_ready duration in ops readiness', async ({ request }) => {
  const password = await ensureTeacherPasswordReady(request);
  const { Authorization, token } = await authHeaders(request, password);

  const classes = await request.get(`${API}/api/v1/classes`, { headers: { Authorization } });
  expect(classes.ok()).toBeTruthy();
  const classId = ((await classes.json()) as { items: Array<{ id: string }> }).items[0]?.id;
  expect(classId).toBeTruthy();

  // Seed CTA → ready funnel with known duration
  await request.post(`${API}/api/v1/audit/events`, {
    headers: { Authorization },
    data: {
      action: 'setup.scan_assign_cta',
      classId,
      detail: { source: 'e2e-v016' },
    },
  });
  await request.post(`${API}/api/v1/audit/events`, {
    headers: { Authorization },
    data: {
      action: 'setup.classroom_ready',
      classId,
      detail: { durationMs: 15000, onlineCount: 1, source: 'e2e-v016' },
    },
  });
  await request.post(`${API}/api/v1/audit/events`, {
    headers: { Authorization },
    data: {
      action: 'setup.classroom_ready',
      classId,
      detail: { durationMs: 45000, onlineCount: 2, source: 'e2e-v016' },
    },
  });

  const ready = await request.get(
    `${API}/api/v1/ops/readiness?classId=${encodeURIComponent(classId!)}`,
    { headers: { Authorization } },
  );
  expect(ready.ok()).toBeTruthy();
  const body = (await ready.json()) as {
    readyCount: number;
    p50Ms: number | null;
    p95Ms: number | null;
    ctaCount: number;
  };
  expect(body.readyCount).toBeGreaterThanOrEqual(2);
  expect(body.ctaCount).toBeGreaterThanOrEqual(1);
  expect(body.p50Ms).not.toBeNull();
  expect(body.p95Ms).not.toBeNull();

  const dash = await request.get(`${API}/api/v1/ops/dashboard`, { headers: { Authorization } });
  expect(dash.ok()).toBeTruthy();
  const d = (await dash.json()) as { readiness: { p50Ms: number | null }; fleet: { classCount: number } };
  expect(d.fleet.classCount).toBeGreaterThanOrEqual(1);
  expect(d.readiness.p50Ms).not.toBeNull();

  // SSE: read first event then abort (EventSource stream never ends)
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 2500);
  try {
    const sseRes = await fetch(
      `${API}/api/v1/presence/stream?classId=${encodeURIComponent(classId!)}&token=${encodeURIComponent(token)}`,
      { signal: ac.signal },
    );
    expect(sseRes.ok).toBeTruthy();
    const reader = sseRes.body?.getReader();
    expect(reader).toBeTruthy();
    const { value } = await reader!.read();
    const chunk = new TextDecoder().decode(value);
    expect(chunk).toMatch(/data:\s*\{/);
    expect(chunk).toMatch(/"type"\s*:\s*"presence"/);
    await reader!.cancel();
  } finally {
    clearTimeout(timer);
  }
});

test('session reset + random-call + seat grid', async ({ request }) => {
  const password = await ensureTeacherPasswordReady(request);
  const { Authorization } = await authHeaders(request, password);
  const classes = await request.get(`${API}/api/v1/classes`, { headers: { Authorization } });
  const classId = ((await classes.json()) as { items: Array<{ id: string }> }).items[0]?.id;

  const seats = await request.put(`${API}/api/v1/classes/${classId}/seats`, {
    headers: { Authorization },
    data: { rows: 2, cols: 3 },
  });
  expect(seats.ok()).toBeTruthy();
  const list = await request.get(`${API}/api/v1/classes/${classId}/seats`, {
    headers: { Authorization },
  });
  expect(list.ok()).toBeTruthy();
  expect(((await list.json()) as { items: unknown[] }).items.length).toBe(6);

  const call = await request.post(`${API}/api/v1/session/random-call`, {
    headers: { Authorization },
    data: { classId, preferOnline: false },
  });
  // empty roster → 404 ok; otherwise 200
  expect([200, 404]).toContain(call.status());

  const reset = await request.post(`${API}/api/v1/session/reset`, {
    headers: { Authorization },
    data: { classId },
  });
  expect(reset.ok()).toBeTruthy();
});
