import { expect, test } from '@playwright/test';
import { openPrepTab, selectTeacherClass } from './helpers/navPrep';
import { loginTeacherWeb } from './helpers/teacherWebLogin';

const API = process.env.API_BASE ?? 'http://127.0.0.1:8787';

test.describe('recycle_urgent_days setting', () => {
  test('改阈值后回收站 days-left 紧急样式变化', async ({ page, request }) => {
    const { password } = await loginTeacherWeb(page, request);
    const login = await request.post(`${API}/api/v1/auth/login`, {
      data: { username: 'teacher', password },
    });
    expect(login.ok()).toBeTruthy();
    const { token } = (await login.json()) as { token: string };
    const auth = { Authorization: `Bearer ${token}` };

    // Dedicated class — avoids parallel purge-all on shared items[0].
    const stamp = Date.now();
    const createdClass = await request.post(`${API}/api/v1/classes`, {
      headers: auth,
      data: { name: `UrgentCls_${stamp}` },
    });
    expect(createdClass.ok()).toBeTruthy();
    const classId = ((await createdClass.json()) as { id: string }).id;

    await request.patch(`${API}/api/v1/settings`, {
      headers: auth,
      data: { recycleUrgentDays: 7 },
    });

    const created = await request.post(`${API}/api/v1/questions`, {
      headers: auth,
      data: {
        classId,
        title: `紧急阈值${stamp}`,
        stem: 'urgent?',
        type: 'bool',
        options: [
          { label: 'A', content: '正确', isCorrect: true },
          { label: 'B', content: '错误', isCorrect: false },
        ],
      },
    });
    expect(created.ok()).toBeTruthy();
    const qid = ((await created.json()) as { id: string }).id;
    const del = await request.post(`${API}/api/v1/questions/bulk`, {
      headers: auth,
      data: { classId, ids: [qid], action: 'delete' },
    });
    expect(del.ok()).toBeTruthy();

    // API-created class is not in the SPA select until classes reload.
    await page.reload();
    await expect(page.locator('aside select').first()).toBeVisible({ timeout: 20_000 });
    await selectTeacherClass(page, classId);
    await openPrepTab(page, '题目回收站');
    await expect(page.getByText(`紧急阈值${stamp}`)).toBeVisible({ timeout: 20_000 });
    const days = page.getByTestId('recycle-days-left').first();
    await expect(days).toBeVisible();
    await expect(days).toHaveClass(/days-left-urgent/);

    await openPrepTab(page, '设置');
    const input = page.getByTestId('recycle-urgent-days');
    await expect(input).toBeVisible({ timeout: 15_000 });
    await input.fill('0');
    await input.blur();
    await expect(
      page.getByTestId('settings-save-msg').filter({ hasText: /即将到期阈值/ }).first(),
    ).toBeVisible({ timeout: 8_000 });

    await openPrepTab(page, '题目回收站');
    await expect(page.getByText(`紧急阈值${stamp}`)).toBeVisible({ timeout: 15_000 });
    await page.reload();
    await selectTeacherClass(page, classId);
    await openPrepTab(page, '题目回收站');
    await expect(page.getByText(`紧急阈值${stamp}`)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('recycle-days-left').first()).not.toHaveClass(/days-left-urgent/, {
      timeout: 10_000,
    });

    await request.post(`${API}/api/v1/questions/bulk`, {
      headers: auth,
      data: { classId, ids: [qid], action: 'purge' },
    });
    await request.patch(`${API}/api/v1/settings`, {
      headers: auth,
      data: { recycleUrgentDays: 1 },
    });
  });
});
