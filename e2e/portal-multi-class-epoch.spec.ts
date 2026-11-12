import { expect, test } from '@playwright/test';
import { ensureTeacherPasswordReady, TEACHER_NEW_PASSWORD, TEACHER_USER } from './helpers/teacherLogin';

const API = process.env.API_BASE ?? 'http://127.0.0.1:8787';

/**
 * Multi-class parallel lesson end: ending deep-lock on class A must not revoke
 * portal sessions or gateway allowlist entries belonging to class B.
 */
test.describe('portal per-class epoch', () => {
  test('end deep-lock on A keeps B portal session and allowlist IP', async ({ request }) => {
    await ensureTeacherPasswordReady(request);
    const login = await request.post(`${API}/api/v1/auth/login`, {
      data: { username: TEACHER_USER, password: TEACHER_NEW_PASSWORD },
    });
    expect(login.ok()).toBeTruthy();
    const { token } = (await login.json()) as { token: string };
    const auth = { Authorization: `Bearer ${token}` };

    const mkClass = async (suffix: string) => {
      const created = await request.post(`${API}/api/v1/classes`, {
        headers: auth,
        data: {
          name: `Epoch ${suffix} ${Date.now()}`,
          classCode: `E${suffix}${Date.now().toString(36).toUpperCase()}`.slice(0, 12),
        },
      });
      expect(created.ok()).toBeTruthy();
      return (await created.json()) as { id: string };
    };

    const classA = await mkClass('A');
    const classB = await mkClass('B');

    await request.put(`${API}/api/v1/portal/settings`, {
      headers: auth,
      data: { portalSharedCode: 'E2EEPOCH', portalSsidRequireSig: false },
    });

    const addStu = async (cid: string, name: string) => {
      const no = `E2E${Date.now().toString().slice(-5)}${name}`;
      const r = await request.post(`${API}/api/v1/classes/${cid}/students`, {
        headers: auth,
        data: { displayName: name, studentNo: no },
      });
      expect(r.ok()).toBeTruthy();
      const body = (await r.json()) as { studentNo?: string };
      return body.studentNo || no;
    };

    const noA = await addStu(classA.id, 'EpochA');
    const noB = await addStu(classB.id, 'EpochB');

    const verify = async (studentNo: string) => {
      const v = await request.post(`${API}/api/v1/portal/verify`, {
        data: { studentNo, code: 'E2EEPOCH' },
      });
      expect(v.ok()).toBeTruthy();
      const cookie = v.headers()['set-cookie'] ?? '';
      expect(cookie).toContain('cd_portal_sess');
      return cookie.split(';')[0]!;
    };

    const cookieA = await verify(noA);
    const cookieB = await verify(noB);

    const ipA = '10.66.1.10';
    const ipB = '10.66.2.20';

    const admitA = await request.post(`${API}/api/v1/portal/admit`, {
      headers: { Cookie: cookieA },
      data: { ssid: 'Student-Lab', ipv4: ipA },
    });
    expect(admitA.ok()).toBeTruthy();

    const admitB = await request.post(`${API}/api/v1/portal/admit`, {
      headers: { Cookie: cookieB },
      data: { ssid: 'Student-Lab', ipv4: ipB },
    });
    expect(admitB.ok()).toBeTruthy();

    // End deep-lock only for class A → bumps portal_session_epoch:classA + revoke A's allowlist
    const endA = await request.post(`${API}/api/v1/deep-lock/action`, {
      headers: auth,
      data: { action: 'end', classId: classA.id },
    });
    expect(endA.ok()).toBeTruthy();

    const bootA = await request.get(`${API}/api/v1/portal/bootstrap`, {
      headers: { Cookie: cookieA },
    });
    expect(bootA.ok()).toBeTruthy();
    const aBody = (await bootA.json()) as { authenticated?: boolean };
    expect(aBody.authenticated).toBeFalsy();

    const bootB = await request.get(`${API}/api/v1/portal/bootstrap`, {
      headers: { Cookie: cookieB },
    });
    expect(bootB.ok()).toBeTruthy();
    const bBody = (await bootB.json()) as { authenticated?: boolean; session?: { classId?: string } };
    expect(bBody.authenticated).toBeTruthy();
    expect(bBody.session?.classId).toBe(classB.id);

    const allow = await request.get(`${API}/api/v1/gateway/allowlist`, { headers: auth });
    expect(allow.ok()).toBeTruthy();
    const allowBody = (await allow.json()) as {
      items?: Array<{ ip?: string; classId?: string | null }>;
    };
    const ips = (allowBody.items ?? []).map((x) => x.ip).filter(Boolean);
    expect(ips).toContain(ipB);
    expect(ips).not.toContain(ipA);

    const checkB = await request.get(`${API}/api/v1/gateway/check?ip=${ipB}`);
    expect(checkB.ok()).toBeTruthy();
    expect(((await checkB.json()) as { allowed?: boolean }).allowed).toBeTruthy();

    const checkA = await request.get(`${API}/api/v1/gateway/check?ip=${ipA}`);
    expect(checkA.ok()).toBeTruthy();
    expect(((await checkA.json()) as { allowed?: boolean }).allowed).toBeFalsy();
  });

  test('three classes: end A + change B keeps C allowlist IP', async ({ request }) => {
    await ensureTeacherPasswordReady(request);
    const login = await request.post(`${API}/api/v1/auth/login`, {
      data: { username: TEACHER_USER, password: TEACHER_NEW_PASSWORD },
    });
    expect(login.ok()).toBeTruthy();
    const { token } = (await login.json()) as { token: string };
    const auth = { Authorization: `Bearer ${token}` };

    const mkClass = async (suffix: string) => {
      const created = await request.post(`${API}/api/v1/classes`, {
        headers: auth,
        data: {
          name: `Tri ${suffix} ${Date.now()}`,
          classCode: `T${suffix}${Date.now().toString(36).toUpperCase()}`.slice(0, 12),
        },
      });
      expect(created.ok()).toBeTruthy();
      return (await created.json()) as { id: string };
    };

    const classA = await mkClass('A');
    const classB = await mkClass('B');
    const classC = await mkClass('C');

    await request.put(`${API}/api/v1/portal/settings`, {
      headers: auth,
      data: { portalSharedCode: 'E2ETRI', portalSsidRequireSig: false },
    });

    const addStu = async (cid: string, name: string) => {
      const no = `TRI${Date.now().toString().slice(-5)}${name}`;
      const r = await request.post(`${API}/api/v1/classes/${cid}/students`, {
        headers: auth,
        data: { displayName: name, studentNo: no },
      });
      expect(r.ok()).toBeTruthy();
      const body = (await r.json()) as { studentNo?: string };
      return body.studentNo || no;
    };

    const noA = await addStu(classA.id, 'TriA');
    const noB = await addStu(classB.id, 'TriB');
    const noC = await addStu(classC.id, 'TriC');

    const verify = async (studentNo: string) => {
      const v = await request.post(`${API}/api/v1/portal/verify`, {
        data: { studentNo, code: 'E2ETRI' },
      });
      expect(v.ok()).toBeTruthy();
      const cookie = v.headers()['set-cookie'] ?? '';
      return cookie.split(';')[0]!;
    };

    const cookieA = await verify(noA);
    const cookieB = await verify(noB);
    const cookieC = await verify(noC);

    const ipA = '10.77.1.10';
    const ipB = '10.77.2.20';
    const ipC = '10.77.3.30';

    for (const [cookie, ip] of [
      [cookieA, ipA],
      [cookieB, ipB],
      [cookieC, ipC],
    ] as const) {
      const admit = await request.post(`${API}/api/v1/portal/admit`, {
        headers: { Cookie: cookie },
        data: { ssid: 'Student-Lab', ipv4: ip },
      });
      expect(admit.ok()).toBeTruthy();
    }

    const endA = await request.post(`${API}/api/v1/deep-lock/action`, {
      headers: auth,
      data: { action: 'end', classId: classA.id },
    });
    expect(endA.ok()).toBeTruthy();

    const changeB = await request.post(`${API}/api/v1/deep-lock/action`, {
      headers: auth,
      data: {
        action: 'exam_net',
        classId: classB.id,
        examUrl: 'https://exam.example.edu/paper',
        allowlistHosts: ['exam.example.edu'],
      },
    });
    expect(changeB.ok()).toBeTruthy();

    const allow = await request.get(`${API}/api/v1/gateway/allowlist`, { headers: auth });
    expect(allow.ok()).toBeTruthy();
    const ips = (
      ((await allow.json()) as { items?: Array<{ ip?: string }> }).items ?? []
    )
      .map((x) => x.ip)
      .filter(Boolean);
    expect(ips).toContain(ipC);
    expect(ips).toContain(ipB);
    expect(ips).not.toContain(ipA);

    const checkC = await request.get(`${API}/api/v1/gateway/check?ip=${ipC}`);
    expect(checkC.ok()).toBeTruthy();
    expect(((await checkC.json()) as { allowed?: boolean }).allowed).toBeTruthy();
  });

  test('four classes: end A+B keeps C and D allowlist IPs', async ({ request }) => {
    await ensureTeacherPasswordReady(request);
    const login = await request.post(`${API}/api/v1/auth/login`, {
      data: { username: TEACHER_USER, password: TEACHER_NEW_PASSWORD },
    });
    expect(login.ok()).toBeTruthy();
    const { token } = (await login.json()) as { token: string };
    const auth = { Authorization: `Bearer ${token}` };

    const mkClass = async (suffix: string) => {
      const created = await request.post(`${API}/api/v1/classes`, {
        headers: auth,
        data: {
          name: `Quad ${suffix} ${Date.now()}`,
          classCode: `Q${suffix}${Date.now().toString(36).toUpperCase()}`.slice(0, 12),
        },
      });
      expect(created.ok()).toBeTruthy();
      return (await created.json()) as { id: string };
    };

    const classA = await mkClass('A');
    const classB = await mkClass('B');
    const classC = await mkClass('C');
    const classD = await mkClass('D');

    await request.put(`${API}/api/v1/portal/settings`, {
      headers: auth,
      data: { portalSharedCode: 'E2EQUAD', portalSsidRequireSig: false },
    });

    const addStu = async (cid: string, name: string) => {
      const no = `QD${Date.now().toString().slice(-5)}${name}`;
      const r = await request.post(`${API}/api/v1/classes/${cid}/students`, {
        headers: auth,
        data: { displayName: name, studentNo: no },
      });
      expect(r.ok()).toBeTruthy();
      const body = (await r.json()) as { studentNo?: string };
      return body.studentNo || no;
    };

    const nos = {
      A: await addStu(classA.id, 'QA'),
      B: await addStu(classB.id, 'QB'),
      C: await addStu(classC.id, 'QC'),
      D: await addStu(classD.id, 'QD'),
    };

    const verify = async (studentNo: string) => {
      const v = await request.post(`${API}/api/v1/portal/verify`, {
        data: { studentNo, code: 'E2EQUAD' },
      });
      expect(v.ok()).toBeTruthy();
      return (v.headers()['set-cookie'] ?? '').split(';')[0]!;
    };

    const cookies = {
      A: await verify(nos.A),
      B: await verify(nos.B),
      C: await verify(nos.C),
      D: await verify(nos.D),
    };

    const ips = {
      A: '10.88.1.10',
      B: '10.88.2.20',
      C: '10.88.3.30',
      D: '10.88.4.40',
    };

    for (const key of ['A', 'B', 'C', 'D'] as const) {
      const admit = await request.post(`${API}/api/v1/portal/admit`, {
        headers: { Cookie: cookies[key] },
        data: { ssid: 'Student-Lab', ipv4: ips[key] },
      });
      expect(admit.ok()).toBeTruthy();
    }

    for (const cid of [classA.id, classB.id]) {
      const end = await request.post(`${API}/api/v1/deep-lock/action`, {
        headers: auth,
        data: { action: 'end', classId: cid },
      });
      expect(end.ok()).toBeTruthy();
    }

    const allow = await request.get(`${API}/api/v1/gateway/allowlist`, { headers: auth });
    expect(allow.ok()).toBeTruthy();
    const list = (
      ((await allow.json()) as { items?: Array<{ ip?: string }> }).items ?? []
    )
      .map((x) => x.ip)
      .filter(Boolean);
    expect(list).toContain(ips.C);
    expect(list).toContain(ips.D);
    expect(list).not.toContain(ips.A);
    expect(list).not.toContain(ips.B);

    for (const ip of [ips.C, ips.D]) {
      const check = await request.get(`${API}/api/v1/gateway/check?ip=${ip}`);
      expect(check.ok()).toBeTruthy();
      expect(((await check.json()) as { allowed?: boolean }).allowed).toBeTruthy();
    }
  });
});
