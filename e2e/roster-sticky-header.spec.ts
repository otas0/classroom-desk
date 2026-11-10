import { expect, test } from '@playwright/test';
import { createDedicatedClass, openPrepTab, selectTeacherClass } from './helpers/navPrep';
import { loginTeacherWeb } from './helpers/teacherWebLogin';

const API = process.env.API_BASE ?? 'http://127.0.0.1:8787';

test.describe('roster sticky header', () => {
  test('large roster: scroll to bottom keeps sticky header in viewport', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000);
    const { password } = await loginTeacherWeb(page, request);
    const login = await request.post(`${API}/api/v1/auth/login`, {
      data: { username: 'teacher', password },
    });
    expect(login.ok()).toBeTruthy();
    const { token } = (await login.json()) as { token: string };
    const auth = { Authorization: `Bearer ${token}` };

    const { classId, stamp } = await createDedicatedClass(request, auth, 'StickyRoster');
    for (let batch = 0; batch < 8; batch++) {
      await Promise.all(
        Array.from({ length: 25 }, async (_, j) => {
          const i = batch * 25 + j;
          const r = await request.post(`${API}/api/v1/classes/${classId}/students`, {
            headers: auth,
            data: {
              displayName: `Sticky${stamp}-${i}`,
              studentNo: `ST${stamp}${String(i).padStart(3, '0')}`,
            },
          });
          expect(r.ok()).toBeTruthy();
        }),
      );
    }

    await page.reload();
    await selectTeacherClass(page, classId);
    await openPrepTab(page, '名单');

    const virt = page.getByTestId('roster-virtual');
    const header = page.getByTestId('roster-virtual-header');
    await expect(virt).toBeVisible({ timeout: 20_000 });
    await expect(header).toBeVisible();

    await virt.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await page.waitForTimeout(300);

    const inView = await header.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const parent = el.parentElement?.getBoundingClientRect();
      if (!parent) return false;
      return r.top >= parent.top - 1 && r.top <= parent.top + 48 && r.bottom > parent.top;
    });
    expect(inView).toBeTruthy();
    await expect(header).toBeVisible();
  });
});
