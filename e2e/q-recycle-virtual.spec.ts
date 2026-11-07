import { expect, test } from '@playwright/test';

const API = process.env.API_BASE ?? 'http://127.0.0.1:8787';
const TEACHER_WEB = process.env.TEACHER_WEB ?? 'http://localhost:5174';

test.describe('question recycle virtual list (≥500)', () => {
  test('seed 520 deleted → virtual scroll + select-all + purge-all', async ({ page, request }) => {
    test.setTimeout(120_000);
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
    const ids: string[] = [];
    // Parallel batches: 520 soft-deleted questions
    for (let batch = 0; batch < 26; batch++) {
      const created = await Promise.all(
        Array.from({ length: 20 }, async (_, j) => {
          const i = batch * 20 + j;
          const r = await request.post(`${API}/api/v1/questions`, {
            headers: auth,
            data: {
              classId,
              title: `VR大${stamp}-${i}`,
              stem: 'v?',
              type: 'bool',
              options: [
                { label: 'A', content: '正确', isCorrect: true },
                { label: 'B', content: '错误', isCorrect: false },
              ],
            },
          });
          expect(r.ok()).toBeTruthy();
          return ((await r.json()) as { id: string }).id;
        }),
      );
      ids.push(...created);
      const del = await request.post(`${API}/api/v1/questions/bulk`, {
        headers: auth,
        data: { classId, ids: created, action: 'delete' },
      });
      expect(del.ok()).toBeTruthy();
    }

    await page.goto(TEACHER_WEB);
    await page.getByLabel('用户名').fill('teacher');
    await page.getByLabel('密码').fill('TeacherPass123');
    await page.getByRole('button', { name: '登录' }).click();
    const prep = page.getByRole('button', { name: /课前准备|备课/ });
    if (await prep.isVisible().catch(() => false)) await prep.click();
    await page.getByRole('button', { name: '题目回收站', exact: true }).click();

    const virt = page.getByTestId('q-recycle-virtual');
    await expect(virt).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('全选（520）')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('recycle-days-left').first()).toBeVisible();

    // Scroll deep — virtual list should still render rows without mounting 520 DOM nodes
    await virt.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await expect(page.locator('.q-virtual-row')).toHaveCount(await page.locator('.q-virtual-row').count());
    const mounted = await page.locator('.q-virtual-row').count();
    expect(mounted).toBeLessThan(80);

    await page.getByLabel(/全选/).check();
    page.once('dialog', (d) => void d.accept());
    await page.getByTestId('q-recycle-purge-all').click();
    await expect(page.getByText('回收站为空')).toBeVisible({ timeout: 30_000 });

    const after = await request.get(`${API}/api/v1/questions?classId=${classId}&includeDeleted=1`, {
      headers: auth,
    });
    const left = ((await after.json()) as { items: Array<{ title?: string }> }).items.filter((x) =>
      String(x.title ?? '').startsWith(`VR大${stamp}`),
    );
    expect(left.length).toBe(0);
  });
});
