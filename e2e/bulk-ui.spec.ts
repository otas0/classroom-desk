import { expect, test } from '@playwright/test';
import { createDedicatedClass, openPrepTab, selectTeacherClass } from './helpers/navPrep';
import { loginTeacherWeb } from './helpers/teacherWebLogin';

const API = process.env.API_BASE ?? 'http://127.0.0.1:8787';

test.describe('bulk delete UI path', () => {
  test('roster checkbox → impact modal → soft delete hides row', async ({ page, request }) => {
    const { password } = await loginTeacherWeb(page, request);
    const login = await request.post(`${API}/api/v1/auth/login`, {
      data: { username: 'teacher', password },
    });
    expect(login.ok()).toBeTruthy();
    const { token } = (await login.json()) as { token: string };
    const auth = { Authorization: `Bearer ${token}` };

    const { classId, stamp } = await createDedicatedClass(request, auth, 'BulkUi');
    const created = await request.post(`${API}/api/v1/classes/${classId}/students`, {
      headers: auth,
      data: { displayName: `UI删${stamp}`, studentNo: `U${stamp}` },
    });
    expect(created.ok()).toBeTruthy();
    const studentId = ((await created.json()) as { id: string }).id;

    await page.reload();
    await expect(page.locator('aside select').first()).toBeVisible({ timeout: 20_000 });
    await selectTeacherClass(page, classId);
    await openPrepTab(page, '名单');
    // Virtual roster: filter so the new row mounts in the viewport.
    await page.getByPlaceholder('搜索姓名/学号').fill(`UI删${stamp}`);

    const check = page.getByTestId(`student-check-${studentId}`);
    await expect(check).toBeVisible({ timeout: 15_000 });
    await check.check();

    await page.getByTestId('bulk-delete-students').click();
    await expect(page.getByRole('dialog', { name: '确认移入回收站' })).toBeVisible();
    await page.getByRole('button', { name: '移入回收站' }).click();

    await expect(page.getByTestId(`student-check-${studentId}`)).toHaveCount(0, { timeout: 10_000 });

    const roster = await request.get(`${API}/api/v1/classes/${classId}/roster`, { headers: auth });
    const ids = ((await roster.json()) as { items: Array<{ id: string }> }).items.map((x) => x.id);
    expect(ids.includes(studentId)).toBeFalsy();

    await request.post(`${API}/api/v1/classes/${classId}/students/bulk-purge`, {
      headers: auth,
      data: { ids: [studentId] },
    });
  });
});
