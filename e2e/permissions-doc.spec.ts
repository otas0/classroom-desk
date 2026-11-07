import { expect, test } from '@playwright/test';
import { openPrepTab } from './helpers/navPrep';
import { loginTeacherWeb } from './helpers/teacherWebLogin';

const TEACHER_WEB = process.env.TEACHER_WEB ?? 'http://localhost:5174';

test.describe('PERMISSIONS.md link', () => {
  test('settings link opens matrix doc (Vite public)', async ({ page, request }) => {
    await loginTeacherWeb(page, request);
    await openPrepTab(page, '设置');

    const link = page.getByTestId('permissions-doc-link').first();
    await expect(link).toBeVisible({ timeout: 15_000 });
    const href = await link.getAttribute('href');
    expect(href).toBeTruthy();
    expect(href!).toMatch(/PERMISSIONS\.md$/);

    const doc = await request.get(new URL(href!, TEACHER_WEB).toString());
    expect(doc.ok()).toBeTruthy();
    const text = await doc.text();
    expect(text).toContain('角色权限矩阵');
    expect(text).toContain('assistant');
  });
});
