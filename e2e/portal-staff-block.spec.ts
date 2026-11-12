import { expect, test } from '@playwright/test';
import { ensureTeacherPasswordReady, TEACHER_NEW_PASSWORD, TEACHER_USER } from './helpers/teacherLogin';

const API = process.env.API_BASE ?? 'http://127.0.0.1:8787';

test.describe('portal staff-net block', () => {
  test('never_student_net blocks admit on faculty SSID', async ({ request }) => {
    await ensureTeacherPasswordReady(request);
    const login = await request.post(`${API}/api/v1/auth/login`, {
      data: { username: TEACHER_USER, password: TEACHER_NEW_PASSWORD },
    });
    expect(login.ok()).toBeTruthy();
    const { token } = (await login.json()) as { token: string };

    const created = await request.post(`${API}/api/v1/classes`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { name: `Portal E2E ${Date.now()}`, classCode: `P${Date.now().toString(36).toUpperCase()}` },
    });
    expect(created.ok()).toBeTruthy();
    const { id: cid } = (await created.json()) as { id: string };

    await request.put(`${API}/api/v1/network-zones`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        zones: [
          {
            id: 'staff',
            label: 'Faculty',
            ssidIncludes: ['Faculty'],
            cidrs: [],
            allowedRoles: ['teacher'],
            defaultNetMode: 'allow',
            defaultAllowlistHosts: [],
            studentUnauthorized: 'flag',
            requirePortal: true,
            enabled: true,
          },
          {
            id: 'learn',
            label: 'Student',
            ssidIncludes: ['Student'],
            cidrs: [],
            allowedRoles: ['student'],
            defaultNetMode: 'allow',
            defaultAllowlistHosts: [],
            studentUnauthorized: 'flag',
            requirePortal: false,
            enabled: true,
          },
        ],
      },
    });

    await request.put(`${API}/api/v1/portal/settings`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { portalSharedCode: 'E2EPORTAL' },
    });

    const addStu = await request.post(`${API}/api/v1/classes/${cid}/students`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { displayName: 'PortalStu', studentNo: `E2E${Date.now().toString().slice(-6)}` },
    });
    expect(addStu.ok()).toBeTruthy();
    const { studentNo } = (await addStu.json()) as { studentNo?: string };
    const no = studentNo || `E2E${Date.now().toString().slice(-6)}`;

    const verify = await request.post(`${API}/api/v1/portal/verify`, {
      data: { studentNo: no, code: 'E2EPORTAL' },
    });
    expect(verify.ok()).toBeTruthy();
    const cookie = verify.headers()['set-cookie'] ?? '';
    expect(cookie).toContain('cd_portal_sess');

    const admit = await request.post(`${API}/api/v1/portal/admit`, {
      headers: { Cookie: cookie.split(';')[0]! },
      data: { ssid: 'Faculty-Hall', ipv4: '10.10.9.9' },
    });
    expect(admit.status()).toBe(403);
    const blocked = (await admit.json()) as { reason?: string; decision?: string };
    expect(blocked.reason).toBe('never_student_net');
    expect(blocked.decision).toBe('block');
  });
});
