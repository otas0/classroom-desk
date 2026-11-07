import { expect, test } from '@playwright/test';
import { openPrepTab, selectTeacherClass } from './helpers/navPrep';
import { loginTeacherWeb } from './helpers/teacherWebLogin';
import { TEACHER_USER } from './helpers/teacherLogin';

const API = process.env.API_BASE ?? 'http://127.0.0.1:8787';

test.describe('seat map batch lock ConfirmModal', () => {
  test.afterEach(async ({ request }) => {
    const { ensureTeacherPasswordReady } = await import('./helpers/teacherLogin');
    const password = await ensureTeacherPasswordReady(request);
    const login = await request.post(`${API}/api/v1/auth/login`, {
      data: { username: TEACHER_USER, password },
    });
    if (!login.ok()) return;
    const { token } = (await login.json()) as { token: string };
    await request.patch(`${API}/api/v1/settings`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { inputLock: { clearAll: true } },
    });
  });

  test('lock-all-empty ConfirmModal shows empty count', async ({ page, request }) => {
    const { password } = await loginTeacherWeb(page, request);
    const login = await request.post(`${API}/api/v1/auth/login`, {
      data: { username: TEACHER_USER, password },
    });
    expect(login.ok()).toBeTruthy();
    const { token } = (await login.json()) as { token: string };
    const auth = { Authorization: `Bearer ${token}` };

    const stamp = Date.now();
    const created = await request.post(`${API}/api/v1/classes`, {
      headers: auth,
      data: { name: `SeatBatch_${stamp}` },
    });
    expect(created.ok()).toBeTruthy();
    const classId = ((await created.json()) as { id: string }).id;
    await request.put(`${API}/api/v1/classes/${classId}/seats`, {
      headers: auth,
      data: { rows: 2, cols: 2 },
    });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await selectTeacherClass(page, classId);
    await openPrepTab(page, '座位图');
    await expect(page.getByTestId('seat-lock-empty-all')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.seat-grid .seat-cell')).toHaveCount(4, { timeout: 15_000 });
    await page.getByTestId('seat-lock-empty-all').click();
    const body = page.getByTestId('seat-batch-lock-confirm-body');
    await expect(body).toBeVisible({ timeout: 8_000 });
    await expect(body).toContainText(/4 个空座/);
    await page.getByRole('button', { name: '确认锁定' }).click();
    await expect(body).toHaveCount(0, { timeout: 10_000 });
  });

  test('unlock ConfirmModal shows only locked seat count', async ({ page, request }) => {
    const { password } = await loginTeacherWeb(page, request);
    const login = await request.post(`${API}/api/v1/auth/login`, {
      data: { username: TEACHER_USER, password },
    });
    expect(login.ok()).toBeTruthy();
    const { token } = (await login.json()) as { token: string };
    const auth = { Authorization: `Bearer ${token}` };

    const stamp = Date.now();
    const created = await request.post(`${API}/api/v1/classes`, {
      headers: auth,
      data: { name: `SeatUnlock_${stamp}` },
    });
    expect(created.ok()).toBeTruthy();
    const classId = ((await created.json()) as { id: string }).id;
    await request.put(`${API}/api/v1/classes/${classId}/seats`, {
      headers: auth,
      data: { rows: 1, cols: 3 },
    });
    const seats = await request.get(`${API}/api/v1/classes/${classId}/seats`, { headers: auth });
    const ids = ((await seats.json()) as { items: Array<{ id: string }> }).items.map((s) => s.id);
    // Lock only 2 of 3
    await request.patch(`${API}/api/v1/settings`, {
      headers: auth,
      data: {
        inputLock: {
          classId,
          seatIds: ids.slice(0, 2),
          keyboard: true,
          mouse: true,
          voice: false,
          camera: false,
        },
      },
    });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await selectTeacherClass(page, classId);
    await openPrepTab(page, '座位图');
    await expect(page.locator('.seat-grid .seat-cell')).toHaveCount(3, { timeout: 15_000 });
    // Re-apply locks immediately before unlock (parallel suites may clearAll).
    await request.patch(`${API}/api/v1/settings`, {
      headers: auth,
      data: {
        inputLock: {
          classId,
          seatIds: ids.slice(0, 2),
          keyboard: true,
          mouse: true,
          voice: false,
          camera: false,
        },
      },
    });
    await page.getByTestId('seat-unlock-all').click();
    const body = page.getByTestId('seat-batch-lock-confirm-body');
    await expect(body).toBeVisible({ timeout: 8_000 });
    await expect(body).toContainText(/清除 2 个已上锁机位/);
    const labels = page.getByTestId('seat-batch-unlock-labels');
    await expect(labels).toBeVisible();
    await expect(labels.locator('li')).toHaveCount(2);
    await page.getByRole('button', { name: '确认解除' }).click();
    await expect(body).toHaveCount(0, { timeout: 10_000 });
  });

  test('unlock ConfirmModal collapses labels when >5 and shows 共 N', async ({ page, request }) => {
    const { password } = await loginTeacherWeb(page, request);
    const login = await request.post(`${API}/api/v1/auth/login`, {
      data: { username: TEACHER_USER, password },
    });
    expect(login.ok()).toBeTruthy();
    const { token } = (await login.json()) as { token: string };
    const auth = { Authorization: `Bearer ${token}` };

    const stamp = Date.now();
    const created = await request.post(`${API}/api/v1/classes`, {
      headers: auth,
      data: { name: `SeatUnlockMany_${stamp}` },
    });
    expect(created.ok()).toBeTruthy();
    const classId = ((await created.json()) as { id: string }).id;
    await request.put(`${API}/api/v1/classes/${classId}/seats`, {
      headers: auth,
      data: { rows: 2, cols: 4 },
    });
    const seats = await request.get(`${API}/api/v1/classes/${classId}/seats`, { headers: auth });
    const ids = ((await seats.json()) as { items: Array<{ id: string }> }).items.map((s) => s.id);
    expect(ids.length).toBeGreaterThanOrEqual(6);
    const lockIds = ids.slice(0, 6);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await selectTeacherClass(page, classId);
    await openPrepTab(page, '座位图');
    await request.patch(`${API}/api/v1/settings`, {
      headers: auth,
      data: {
        inputLock: {
          classId,
          seatIds: lockIds,
          keyboard: true,
          mouse: true,
          voice: false,
          camera: false,
        },
      },
    });
    await page.getByTestId('seat-unlock-all').click();
    const body = page.getByTestId('seat-batch-lock-confirm-body');
    await expect(body).toBeVisible({ timeout: 8_000 });
    await expect(page.getByTestId('seat-batch-unlock-total')).toContainText('共 6');
    const labels = page.getByTestId('seat-batch-unlock-labels');
    await expect(labels.locator('li')).toHaveCount(5);
    await expect(page.getByTestId('seat-batch-unlock-labels-toggle')).toContainText(/共 6/);
    await page.getByTestId('seat-batch-unlock-labels-toggle').click();
    await expect(labels.locator('li')).toHaveCount(6);
    await page.getByTestId('seat-batch-unlock-labels-toggle').click();
    await expect(labels.locator('li')).toHaveCount(5);
    await page.getByRole('button', { name: '取消' }).click();
  });
});
