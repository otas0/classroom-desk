import { expect, test } from '@playwright/test';
import { openPrepTab, selectTeacherClass } from './helpers/navPrep';
import { loginTeacherWeb } from './helpers/teacherWebLogin';

const API = process.env.API_BASE ?? 'http://127.0.0.1:8787';

test.describe('questions Shift multi-select', () => {
  test('Shift+click range → sticky bar shows count', async ({ page, request }) => {
    const { password } = await loginTeacherWeb(page, request);
    const login = await request.post(`${API}/api/v1/auth/login`, {
      data: { username: 'teacher', password },
    });
    expect(login.ok()).toBeTruthy();
    const { token } = (await login.json()) as { token: string };
    const auth = { Authorization: `Bearer ${token}` };

    const classes = await request.get(`${API}/api/v1/classes`, { headers: auth });
    const classId = ((await classes.json()) as { items: Array<{ id: string }> }).items[0]?.id;
    expect(classId).toBeTruthy();

    await selectTeacherClass(page, classId!);

    const stamp = Date.now();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const created = await request.post(`${API}/api/v1/questions`, {
        headers: auth,
        data: {
          classId,
          title: `连选${stamp}-${i}`,
          stem: `stem ${i}`,
          type: 'bool',
          options: [
            { label: 'A', content: '正确', isCorrect: true },
            { label: 'B', content: '错误', isCorrect: false },
          ],
        },
      });
      expect(created.ok()).toBeTruthy();
      ids.push(((await created.json()) as { id: string }).id);
    }

    // Re-enter tab after API seed so list reloads for the selected class.
    await openPrepTab(page, '发题');
    await expect(page.getByText(`连选${stamp}-0`)).toBeVisible({ timeout: 15_000 });

    // Newest-first list: ids[2] then ids[1] are adjacent at top — Shift-range selects both.
    const a = page.locator(`[data-row-id="${ids[2]}"] input[type="checkbox"]`);
    const b = page.locator(`[data-row-id="${ids[1]}"] input[type="checkbox"]`);
    await expect(a).toBeVisible({ timeout: 10_000 });
    await a.click();
    await b.click({ modifiers: ['Shift'] });

    await expect(page.getByTestId('questions-selection-sticky')).toBeVisible();
    await expect(page.getByTestId('questions-selection-sticky')).toContainText('已选 2 题');
  });
});
