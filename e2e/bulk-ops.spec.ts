import { expect, test } from '@playwright/test';

const API = process.env.API_BASE ?? 'http://127.0.0.1:8787';
const TEACHER_WEB = process.env.TEACHER_WEB ?? 'http://localhost:5174';

test.describe('bulk soft-delete students & questions', () => {
  test('impact → soft delete hides from roster; question bulk delete hides for student', async ({
    request,
    page,
  }) => {
    const login = await request.post(`${API}/api/v1/auth/login`, {
      data: { username: 'teacher', password: 'TeacherPass123' },
    });
    expect(login.ok()).toBeTruthy();
    const { token } = (await login.json()) as { token: string };
    const auth = { Authorization: `Bearer ${token}` };

    const classes = await request.get(`${API}/api/v1/classes`, { headers: auth });
    const classId = ((await classes.json()) as { items: Array<{ id: string }> }).items[0]?.id;
    expect(classId).toBeTruthy();

    const stamp = Date.now();
    const s1 = await request.post(`${API}/api/v1/classes/${classId}/students`, {
      headers: auth,
      data: { displayName: `批量甲${stamp}`, studentNo: `B${stamp}a` },
    });
    const s2 = await request.post(`${API}/api/v1/classes/${classId}/students`, {
      headers: auth,
      data: { displayName: `批量乙${stamp}`, studentNo: `B${stamp}b` },
    });
    expect(s1.ok()).toBeTruthy();
    expect(s2.ok()).toBeTruthy();
    const id1 = ((await s1.json()) as { id: string }).id;
    const id2 = ((await s2.json()) as { id: string }).id;

    const viewer = await request.post(`${API}/api/v1/classes/${classId}/students`, {
      headers: auth,
      data: { displayName: `看题${stamp}`, studentNo: `V${stamp}` },
    });
    expect(viewer.ok()).toBeTruthy();
    const viewerId = ((await viewer.json()) as { id: string }).id;
    const sel = await request.post(`${API}/api/v1/auth/student-select`, {
      data: { classId, studentId: viewerId },
    });
    expect(sel.ok()).toBeTruthy();
    const studentToken = ((await sel.json()) as { token: string }).token;

    const impact = await request.post(`${API}/api/v1/classes/${classId}/students/bulk-impact`, {
      headers: auth,
      data: { ids: [id1, id2] },
    });
    expect(impact.ok()).toBeTruthy();
    expect(((await impact.json()) as { studentCount: number }).studentCount).toBe(2);

    const soft = await request.post(`${API}/api/v1/classes/${classId}/students/bulk-delete`, {
      headers: auth,
      data: { ids: [id1, id2] },
    });
    expect(soft.ok()).toBeTruthy();
    expect(((await soft.json()) as { deleted: number }).deleted).toBe(2);

    const roster = await request.get(`${API}/api/v1/classes/${classId}/roster`);
    const rosterIds = new Set(
      ((await roster.json()) as { items: Array<{ id: string }> }).items.map((x) => x.id),
    );
    expect(rosterIds.has(id1)).toBeFalsy();
    expect(rosterIds.has(id2)).toBeFalsy();
    expect(rosterIds.has(viewerId)).toBeTruthy();

    const recycle = await request.get(`${API}/api/v1/classes/${classId}/students/recycle`, {
      headers: auth,
    });
    const recycled = ((await recycle.json()) as { items: Array<{ id: string }> }).items.map((x) => x.id);
    expect(recycled).toEqual(expect.arrayContaining([id1, id2]));

    const q = await request.post(`${API}/api/v1/questions`, {
      headers: auth,
      data: {
        classId,
        title: `批量题${stamp}`,
        stem: '批量删除测？',
        type: 'bool',
        options: [
          { label: 'A', content: '正确', isCorrect: true },
          { label: 'B', content: '错误', isCorrect: false },
        ],
      },
    });
    expect(q.ok()).toBeTruthy();
    const qid = ((await q.json()) as { id: string }).id;

    const beforeStudent = await request.get(`${API}/api/v1/questions?classId=${classId}`, {
      headers: { Authorization: `Bearer ${studentToken}` },
    });
    expect(
      ((await beforeStudent.json()) as { items: Array<{ id: string }> }).items.some((x) => x.id === qid),
    ).toBeTruthy();

    const qDel = await request.post(`${API}/api/v1/questions/bulk`, {
      headers: auth,
      data: { classId, ids: [qid], action: 'delete' },
    });
    expect(qDel.ok()).toBeTruthy();

    const afterTeacher = await request.get(`${API}/api/v1/questions?classId=${classId}`, {
      headers: auth,
    });
    expect(
      ((await afterTeacher.json()) as { items: Array<{ id: string }> }).items.some((x) => x.id === qid),
    ).toBeFalsy();

    const afterStudent = await request.get(`${API}/api/v1/questions?classId=${classId}`, {
      headers: { Authorization: `Bearer ${studentToken}` },
    });
    expect(
      ((await afterStudent.json()) as { items: Array<{ id: string }> }).items.some((x) => x.id === qid),
    ).toBeFalsy();

    await request.post(`${API}/api/v1/classes/${classId}/students/bulk-purge`, {
      headers: auth,
      data: { ids: [id1, id2] },
    });
    await request.post(`${API}/api/v1/classes/${classId}/students/bulk-delete`, {
      headers: auth,
      data: { ids: [viewerId] },
    });
    await request.post(`${API}/api/v1/classes/${classId}/students/bulk-purge`, {
      headers: auth,
      data: { ids: [viewerId] },
    });
    await request.post(`${API}/api/v1/questions/bulk`, {
      headers: auth,
      data: { classId, ids: [qid], action: 'purge' },
    });

    await page.goto(TEACHER_WEB);
    await page.getByLabel('用户名').fill('teacher');
    await page.getByLabel('密码').fill('TeacherPass123');
    await page.getByRole('button', { name: '登录' }).click();
    await expect(page.getByRole('button', { name: '发题/正确率', exact: true })).toBeVisible({
      timeout: 15_000,
    });
  });
});
