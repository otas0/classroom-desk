import { expect, test } from '@playwright/test';
import { createDedicatedClass, openPrepTab, selectTeacherClass } from './helpers/navPrep';
import { loginTeacherWeb } from './helpers/teacherWebLogin';
import { resetUiLocaleZhCN } from './helpers/uiLocale';

const API = process.env.API_BASE ?? 'http://127.0.0.1:8787';

test.describe('audit detail JSON fold', () => {
  test('bulk delete with long ids → expand/collapse ids in settings', async ({ page, request }) => {
    await resetUiLocaleZhCN(request);
    const { password } = await loginTeacherWeb(page, request);
    const login = await request.post(`${API}/api/v1/auth/login`, {
      data: { username: 'teacher', password },
    });
    expect(login.ok()).toBeTruthy();
    const { token } = (await login.json()) as { token: string };
    const auth = { Authorization: `Bearer ${token}` };

    const { classId, stamp } = await createDedicatedClass(request, auth, 'AuditDet');
    const ids: string[] = [];
    for (let i = 0; i < 12; i++) {
      const r = await request.post(`${API}/api/v1/classes/${classId}/students`, {
        headers: auth,
        data: { displayName: `审计${stamp}-${i}`, studentNo: `A${stamp}${i}` },
      });
      expect(r.ok()).toBeTruthy();
      ids.push(((await r.json()) as { id: string }).id);
    }

    const soft = await request.post(`${API}/api/v1/classes/${classId}/students/bulk-delete`, {
      headers: auth,
      data: { ids },
    });
    expect(soft.ok()).toBeTruthy();

    await page.reload();
    await expect(page.locator('aside select').first()).toBeVisible({ timeout: 20_000 });
    await selectTeacherClass(page, classId);
    await openPrepTab(page, '设置');
    await expect(page.getByRole('heading', { name: /操作审计|Audit|審計|監査|감사/ })).toBeVisible({
      timeout: 15_000,
    });

    // Wait until the bulk-delete row is present (audit list can lag one poll).
    const expand = page.getByTestId('audit-expand-ids').first();
    await expect(expand).toBeVisible({ timeout: 30_000 });
    await expand.click();
    await expect(page.getByTestId('audit-ids-list').first()).toContainText(ids[0]!, {
      timeout: 10_000,
    });
    await expect(page.getByTestId('audit-jump-ids').first()).toBeVisible();
    await page.getByRole('button', { name: /收起 ids|Collapse ids|收起 ids|ids を閉じる|ids 접기/ }).first().click();
    await expect(page.getByTestId('audit-expand-ids').first()).toBeVisible();
    await page.getByTestId('audit-jump-ids').first().click();
    await expect(page.getByRole('heading', { name: /班级与名单|Roster|班級|名簿|명단/ })).toBeVisible({
      timeout: 20_000,
    });

    await request.post(`${API}/api/v1/classes/${classId}/students/bulk-purge`, {
      headers: auth,
      data: { ids },
    });
  });
});
