import { expect, test } from '@playwright/test';
import { openPrepTab, selectTeacherClass } from './helpers/navPrep';
import { loginTeacherWeb } from './helpers/teacherWebLogin';

const API = process.env.API_BASE ?? 'http://127.0.0.1:8787';

test.describe('question recycle virtual list (≥500)', () => {
  test('seed 520 deleted → virtual scroll + select-all + purge-all', async ({ page, request }) => {
    test.setTimeout(180_000);
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

    // Isolate: clear recycle for this class before seeding.
    await request.post(`${API}/api/v1/questions/recycle/purge-all`, {
      headers: auth,
      data: { classId },
    });

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
    expect(ids.length).toBe(520);

    await selectTeacherClass(page, classId!);
    await openPrepTab(page, '题目回收站');

    const virt = page.getByTestId('q-recycle-virtual');
    await expect(virt).toBeVisible({ timeout: 30_000 });
    // Wait until recycle count reflects seed (avoid asserting 全选（0） mid-load).
    await expect
      .poll(
        async () => {
          const label = ((await page.getByText(/全选（\d+）/).innerText()) || '').replace(/\s+/g, '');
          return Number(label.match(/全选[（(](\d+)[）)]/)?.[1] ?? 0);
        },
        { timeout: 60_000 },
      )
      .toBeGreaterThanOrEqual(520);
    // Newest-first: high indexes mount at top — don't require -0 (may be virtualized off-screen).
    await virt.evaluate((el) => {
      el.scrollTop = 0;
    });
    await expect(page.getByText(new RegExp(`VR大${stamp}-\\d+`)).first()).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId('recycle-days-left').first()).toBeVisible();

    // Scroll deep — virtual list should still render rows without mounting 520 DOM nodes
    await virt.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    const mounted = await page.locator('.q-virtual-row').count();
    expect(mounted).toBeLessThan(80);

    page.once('dialog', (d) => void d.accept());
    await page.getByTestId('q-recycle-purge-all').click();
    await expect(page.getByText('回收站为空')).toBeVisible({ timeout: 60_000 });

    const after = await request.get(`${API}/api/v1/questions?classId=${classId}&includeDeleted=1`, {
      headers: auth,
    });
    const left = ((await after.json()) as { items: Array<{ title?: string }> }).items.filter((x) =>
      String(x.title ?? '').startsWith(`VR大${stamp}`),
    );
    expect(left.length).toBe(0);
  });
});
