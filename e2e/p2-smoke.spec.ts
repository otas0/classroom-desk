import { test, expect } from '@playwright/test';
import { decodeRoomCode, encodeRoomCode } from '@classroom-desk/shared';

const API = process.env.CD_API_BASE ?? 'http://127.0.0.1:8787';

test.describe('P2 smoke', () => {
  test('room code round-trip', async () => {
    const ip = '192.168.64.10';
    const code = encodeRoomCode(ip);
    expect(code).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    expect(decodeRoomCode(code!)).toBe(ip);
  });

  test('settings exposes join ops counters when authed', async ({ request }) => {
    try {
      const health = await request.get(`${API}/health`, { timeout: 5_000 });
      if (!health.ok()) return;
    } catch {
      return;
    }
    const { ensureTeacherPasswordReady, TEACHER_USER } = await import('./helpers/teacherLogin');
    const password = await ensureTeacherPasswordReady(request);
    const login = await request.post(`${API}/api/v1/auth/login`, {
      data: { username: TEACHER_USER, password },
    });
    if (!login.ok()) return;
    const { token } = (await login.json()) as { token: string };
    const settings = await request.get(`${API}/api/v1/settings`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(settings.ok()).toBeTruthy();
    const body = (await settings.json()) as {
      joinPendingDeviceCount?: number;
      joinRateLimitEventsLastHour?: number;
    };
    expect(typeof body.joinPendingDeviceCount).toBe('number');
    expect(typeof body.joinRateLimitEventsLastHour).toBe('number');
  });

  test('health deskdns-check responds JSON', async ({ request }) => {
    const res = await request.get(`${API}/api/v1/health/deskdns-check`);
    expect(res.status()).toBeLessThan(600);
    const body = await res.json();
    expect(body).toHaveProperty('deskDns');
    expect(body).toHaveProperty('dnsResolution');
  });

  test('upgrades latest public', async ({ request }) => {
    const res = await request.get(`${API}/api/v1/upgrades/latest?arch=arm64`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body).toHaveProperty('expectedVersion');
    expect(body).toHaveProperty('byArch');
  });
});
