import { expect, test } from '@playwright/test';
import { ensureTeacherPasswordReady } from './helpers/teacherLogin';

const API = process.env.API_BASE ?? 'http://127.0.0.1:8787';
const STUDENT_WEB = process.env.STUDENT_WEB ?? 'http://127.0.0.1:5173';

test.describe('session_kicked student UI', () => {
  test('soft-delete → heartbeat toast → 选人页截图', async ({ page, request }) => {
    const password = await ensureTeacherPasswordReady(request);
    const login = await request.post(`${API}/api/v1/auth/login`, {
      data: { username: 'teacher', password },
    });
    expect(login.ok()).toBeTruthy();
    const { token } = (await login.json()) as { token: string };
    const auth = { Authorization: `Bearer ${token}` };

    const classes = await request.get(`${API}/api/v1/classes`, { headers: auth });
    const classId = ((await classes.json()) as { items: Array<{ id: string }> }).items[0]?.id;
    expect(classId).toBeTruthy();

    const stamp = Date.now();
    const created = await request.post(`${API}/api/v1/classes/${classId}/students`, {
      headers: auth,
      data: { displayName: `踢线UI${stamp}`, studentNo: `KU${stamp}` },
    });
    expect(created.ok()).toBeTruthy();
    const studentId = ((await created.json()) as { id: string }).id;

    const sel = await request.post(`${API}/api/v1/auth/student-select`, {
      data: { classId, studentId },
    });
    expect(sel.ok()).toBeTruthy();
    const studentToken = ((await sel.json()) as { token: string }).token;

    await page.addInitScript(
      ({ api, tok }) => {
        localStorage.setItem('classroom-desk.api-base', api);
        localStorage.setItem('classroom-desk.token', tok);
      },
      { api: API, tok: studentToken },
    );
    await page.goto(STUDENT_WEB);

    await expect(page.getByText(`踢线UI${stamp}`).first()).toBeVisible({ timeout: 20_000 });

    const soft = await request.post(`${API}/api/v1/classes/${classId}/students/bulk-delete`, {
      headers: auth,
      data: { ids: [studentId] },
    });
    expect(soft.ok()).toBeTruthy();

    // Wait for refreshMe interval (~8s) or force a fetch that hits auth
    await page.waitForTimeout(500);
    await page.evaluate(async () => {
      const base = localStorage.getItem('classroom-desk.api-base') || 'http://127.0.0.1:8787';
      const tok = localStorage.getItem('classroom-desk.token');
      try {
        await fetch(`${base}/api/v1/presence/heartbeat`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${tok}`,
            'Content-Type': 'application/json',
          },
          body: '{}',
        });
      } catch {
        /* ignore */
      }
    });
    // App refreshMe also clears token on session ended — nudge by reload of me via focus
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));

    const toast = page.getByTestId('session-kicked-toast');
    // refreshMe runs on interval; poll up to ~15s
    await expect(toast).toBeVisible({ timeout: 20_000 });
    await expect(toast).toContainText(/账号已下线|重新选择身份/);

    await expect(page.getByRole('heading', { name: /你是谁|更换身份/ })).toBeVisible({
      timeout: 15_000,
    });
    await page.screenshot({
      path: 'test-results/session-kicked-select-identity.png',
      fullPage: true,
    });

    await request.post(`${API}/api/v1/classes/${classId}/students/bulk-purge`, {
      headers: auth,
      data: { ids: [studentId] },
    });
  });
});
