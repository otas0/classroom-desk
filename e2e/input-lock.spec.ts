import { expect, test } from '@playwright/test';
import { ensureTeacherPasswordReady, TEACHER_USER } from './helpers/teacherLogin';
import { loginTeacherWeb } from './helpers/teacherWebLogin';
import { openPrepTab } from './helpers/navPrep';

const API = process.env.API_BASE ?? 'http://127.0.0.1:8787';
const STUDENT_WEB = process.env.STUDENT_WEB ?? 'http://127.0.0.1:5173';

async function studentReachable(): Promise<boolean> {
  try {
    const res = await fetch(STUDENT_WEB, { signal: AbortSignal.timeout(2000) });
    return res.ok || res.status === 200;
  } catch {
    return false;
  }
}

test.describe('physical input lock', () => {
  test.afterEach(async ({ request }) => {
    const password = await ensureTeacherPasswordReady(request);
    const login = await request.post(`${API}/api/v1/auth/login`, {
      data: { username: TEACHER_USER, password },
    });
    if (!login.ok()) return;
    const { token } = (await login.json()) as { token: string };
    await request.patch(`${API}/api/v1/settings`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        inputLock: { keyboard: false, mouse: false, voice: false, camera: false },
      },
    });
  });

  test('teacher toggles → public settings + student banner', async ({ page, request }) => {
    test.skip(!(await studentReachable()), 'student vite required');

    const { password } = await loginTeacherWeb(page, request);
    const login = await request.post(`${API}/api/v1/auth/login`, {
      data: { username: TEACHER_USER, password },
    });
    expect(login.ok()).toBeTruthy();
    const { token } = (await login.json()) as { token: string };
    const auth = { Authorization: `Bearer ${token}` };

    await openPrepTab(page, '设置');
    await expect(page.getByTestId('input-lock-controls')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('input-lock-keyboard').check();
    await page.getByTestId('input-lock-camera').check();
    await expect(page.getByText('物理输入锁已更新（已推送到学生端）').first()).toBeVisible({
      timeout: 8_000,
    });

    const pub = await request.get(`${API}/api/v1/settings/public`);
    expect(pub.ok()).toBeTruthy();
    const body = (await pub.json()) as {
      inputLock?: { keyboard?: boolean; camera?: boolean };
      inputLockActive?: boolean;
    };
    expect(body.inputLock?.keyboard).toBeTruthy();
    expect(body.inputLock?.camera).toBeTruthy();
    expect(body.inputLockActive).toBeTruthy();

    const student = await page.context().newPage();
    await student.addInitScript((apiBase) => {
      localStorage.setItem('classroom-desk.api-base', apiBase);
    }, API);
    await student.goto(`${STUDENT_WEB}/?e2e=1`, { waitUntil: 'domcontentloaded' });
    await expect(student.getByTestId('input-lock-banner')).toBeVisible({ timeout: 15_000 });
    await expect(student.getByTestId('input-lock-banner')).toContainText(/键盘|相机/);

    await request.patch(`${API}/api/v1/settings`, {
      headers: auth,
      data: { inputLock: { keyboard: false, mouse: false, voice: false, camera: false } },
    });
    await expect(student.getByTestId('input-lock-banner')).toHaveCount(0, { timeout: 15_000 });
    await student.close();
  });

  test('assistant cannot PATCH inputLock controls', async ({ page, request }) => {
    const password = await ensureTeacherPasswordReady(request);
    const login = await request.post(`${API}/api/v1/auth/login`, {
      data: { username: TEACHER_USER, password },
    });
    expect(login.ok()).toBeTruthy();
    const { token } = (await login.json()) as { token: string };
    const auth = { Authorization: `Bearer ${token}` };
    const stamp = Date.now();
    const user = `asst_il_${stamp}`;
    const pass = `AsstPass${stamp % 100000}i9`;
    const created = await request.post(`${API}/api/v1/auth/assistants`, {
      headers: auth,
      data: { username: user, password: pass, displayName: '输入锁助教' },
    });
    expect(created.ok()).toBeTruthy();

    const asstLogin = await request.post(`${API}/api/v1/auth/login`, {
      data: { username: user, password: pass },
    });
    expect(asstLogin.ok()).toBeTruthy();
    const asstToken = ((await asstLogin.json()) as { token: string }).token;
    const denied = await request.patch(`${API}/api/v1/settings`, {
      headers: { Authorization: `Bearer ${asstToken}` },
      data: { inputLock: { keyboard: true, mouse: true, voice: true, camera: true } },
    });
    expect(denied.status()).toBe(403);

    // UI readonly when assistant opens 设置 (may hit password gate — soft skip)
    const { loginStaffWeb } = await import('./helpers/teacherWebLogin');
    await loginStaffWeb(page, user, pass);
    if (await page.getByText('请先修改个人密码').isVisible().catch(() => false)) {
      test.skip(true, 'must-change-password');
    }
    await page.locator('aside').getByRole('button', { name: '设置', exact: true }).click();
    await expect(page.getByTestId('input-lock-readonly')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('input-lock-controls')).toHaveCount(0);
  });
});
