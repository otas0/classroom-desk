import { test, expect } from '@playwright/test';
import { decodeRoomCode, encodeRoomCode } from '@classroom-desk/shared';
import { ensureTeacherPasswordReady, TEACHER_USER } from './helpers/teacherLogin';

const API = process.env.CD_API_BASE ?? process.env.API_BASE ?? 'http://127.0.0.1:8787';

async function apiUp(request: import('@playwright/test').APIRequestContext): Promise<boolean> {
  try {
    const res = await request.get(`${API}/health`, { timeout: 8_000 });
    return res.ok();
  } catch {
    return false;
  }
}

test.describe('join auth true path (API)', () => {
  test.beforeEach(async ({ request }, testInfo) => {
    if (!(await apiUp(request))) {
      testInfo.skip(true, `CD API not reachable at ${API}`);
    }
  });

  test('room code encode path via network API', async ({ request }) => {
    const password = await ensureTeacherPasswordReady(request);
    const login = await request.post(`${API}/api/v1/auth/login`, {
      data: { username: TEACHER_USER, password },
    });
    expect(login.ok()).toBeTruthy();
    const { token } = (await login.json()) as { token: string };
    const net = await request.get(`${API}/api/v1/network/interfaces`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(net.ok()).toBeTruthy();
    const body = (await net.json()) as {
      roomCode?: string | null;
      advertiseLanIp?: string | null;
    };
    if (body.advertiseLanIp) {
      expect(body.roomCode).toBe(encodeRoomCode(body.advertiseLanIp));
      expect(decodeRoomCode(body.roomCode!)).toBe(body.advertiseLanIp);
    } else {
      const sample = '192.168.64.10';
      expect(encodeRoomCode(sample)).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}$/);
      expect(decodeRoomCode(encodeRoomCode(sample)!)).toBe(sample);
    }
  });

  test('PIN attach, wrong then right; easy-join clear disables join', async ({ request }) => {
    const password = await ensureTeacherPasswordReady(request);
    const login = await request.post(`${API}/api/v1/auth/login`, {
      data: { username: TEACHER_USER, password },
    });
    expect(login.ok()).toBeTruthy();
    const { token } = (await login.json()) as { token: string };
    const auth = { Authorization: `Bearer ${token}` };

    const stamp = Date.now();
    const created = await request.post(`${API}/api/v1/classes`, {
      headers: auth,
      data: { name: `JoinFlow_${stamp}` },
    });
    expect(created.ok()).toBeTruthy();
    const classId = ((await created.json()) as { id: string }).id;

    const lanBase = process.env.CD_LAN_API_BASE ?? 'http://192.168.64.10:8787';
    const pin = `pin${stamp % 10000}`.slice(0, 8);

    const patchOn = await request.patch(`${API}/api/v1/settings`, {
      headers: { ...auth, 'Content-Type': 'application/json' },
      data: {
        classroomApiBase: lanBase,
        studentEasyJoin: true,
        studentEasyJoinClassId: classId,
        studentJoinPin: pin,
      },
    });
    expect(patchOn.ok()).toBeTruthy();

    const joinPeek = await request.get(`${API}/api/v1/classroom/join`);
    expect(joinPeek.ok()).toBeTruthy();
    const joinBody = (await joinPeek.json()) as {
      enabled?: boolean;
      joinPinRequired?: boolean;
      roomCode?: string | null;
    };
    expect(joinBody.enabled).toBe(true);
    expect(joinBody.joinPinRequired).toBe(true);
    if (joinBody.roomCode) {
      const ip = decodeRoomCode(joinBody.roomCode);
      expect(ip).toBeTruthy();
    }

    const bad = await request.post(`${API}/api/v1/classroom/join/attach`, {
      data: { pin: 'wrong-pin', deviceId: `e2e-bad-${stamp}`, hostname: 'e2e' },
    });
    expect(bad.status()).toBe(401);
    const badBody = (await bad.json()) as { error?: string; remainingAttempts?: number };
    expect(badBody.error).toBe('join_pin_invalid');
    expect(badBody.remainingAttempts).toBeLessThan(10);

    const good = await request.post(`${API}/api/v1/classroom/join/attach`, {
      data: { pin, deviceId: `e2e-ok-${stamp}`, hostname: 'e2e' },
    });
    expect(good.ok()).toBeTruthy();
    const attach = (await good.json()) as { attachOk?: boolean; classId?: string | null };
    expect(attach.attachOk).toBe(true);
    expect(attach.classId).toBe(classId);

    const patchOff = await request.patch(`${API}/api/v1/settings`, {
      headers: { ...auth, 'Content-Type': 'application/json' },
      data: { studentEasyJoin: false, studentEasyJoinClassId: '' },
    });
    expect(patchOff.ok()).toBeTruthy();

    const joinOff = await request.get(`${API}/api/v1/classroom/join`);
    expect(joinOff.ok()).toBeTruthy();
    const offBody = (await joinOff.json()) as { enabled?: boolean; ok?: boolean; reason?: string };
    expect(offBody.enabled).toBe(false);
    expect(offBody.ok).toBe(false);

    const attachAfter = await request.post(`${API}/api/v1/classroom/join/attach`, {
      data: { pin, deviceId: `e2e-after-${stamp}`, hostname: 'e2e' },
    });
    expect(attachAfter.status()).toBe(403);
  });
});
