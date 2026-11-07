import { expect, test } from '@playwright/test';
import { openPrepTab, selectTeacherClass } from './helpers/navPrep';
import { loginTeacherWeb } from './helpers/teacherWebLogin';

const API = process.env.API_BASE ?? 'http://127.0.0.1:8787';

test.describe('audit jump highlight', () => {
  test('跳转题目回收站 → target rows have cd-audit-jump-hl', async ({ page, request }) => {
    const { password } = await loginTeacherWeb(page, request);
    const login = await request.post(`${API}/api/v1/auth/login`, {
      data: { username: 'teacher', password },
    });
    expect(login.ok()).toBeTruthy();
    const { token } = (await login.json()) as { token: string };
    const auth = { Authorization: `Bearer ${token}` };

    const stamp = Date.now();
    const createdClass = await request.post(`${API}/api/v1/classes`, {
      headers: auth,
      data: { name: `AuditJump_${stamp}` },
    });
    expect(createdClass.ok()).toBeTruthy();
    const classId = ((await createdClass.json()) as { id: string }).id;

    const created = await request.post(`${API}/api/v1/questions`, {
      headers: auth,
      data: {
        classId,
        title: `跳转高亮${stamp}`,
        stem: 'hl?',
        type: 'bool',
        options: [
          { label: 'A', content: '正确', isCorrect: true },
          { label: 'B', content: '错误', isCorrect: false },
        ],
      },
    });
    expect(created.ok()).toBeTruthy();
    const qid = ((await created.json()) as { id: string }).id;

    const soft = await request.post(`${API}/api/v1/questions/bulk`, {
      headers: auth,
      data: { classId, ids: [qid], action: 'delete' },
    });
    expect(soft.ok()).toBeTruthy();

    await page.reload();
    await expect(page.locator('aside select').first()).toBeVisible({ timeout: 20_000 });
    await selectTeacherClass(page, classId);
    await openPrepTab(page, '设置');
    await expect(page.getByRole('heading', { name: /操作审计/ })).toBeVisible({ timeout: 15_000 });

    const auditCard = page.locator('.card').filter({ has: page.getByRole('heading', { name: /操作审计/ }) });
    // Class + action filters keep the list to this suite's soft-delete (shared CI DB).
    await auditCard.locator('select').nth(0).selectOption(classId);
    await auditCard.locator('select').nth(1).selectOption('questions.bulk_delete');
    const jump = auditCard
      .getByRole('listitem')
      .filter({ hasText: 'questions.bulk_delete' })
      .getByTestId('audit-jump-ids')
      .filter({ hasText: '跳转题目回收站' })
      .first();
    await expect(jump).toBeVisible({ timeout: 20_000 });
    await jump.click();

    await expect(page.getByRole('heading', { name: '题目回收站' })).toBeVisible({
      timeout: 25_000,
    });
    const row = page.locator(`[data-row-id="${qid}"]`);
    await expect(row).toBeVisible({ timeout: 25_000 });
    // Highlight is applied after mount-once consume; allow slow CI first paint.
    await expect(row).toHaveClass(/cd-audit-jump-hl/, { timeout: 20_000 });
  });
});
