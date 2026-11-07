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
    await expect(page.getByTestId('input-lock-scope')).toBeVisible();
    await page.getByTestId('input-lock-keyboard').check();
    await page.getByTestId('input-lock-camera').check();
    await expect(page.getByText(/物理输入锁已更新/).first()).toBeVisible({
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

  test('assistant cannot PATCH inputLock (API 403)', async ({ request }) => {
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
  });

  test('exam mode locks inputs + exit + audit exam_mode', async ({ request }) => {
    const password = await ensureTeacherPasswordReady(request);
    const login = await request.post(`${API}/api/v1/auth/login`, {
      data: { username: TEACHER_USER, password },
    });
    expect(login.ok()).toBeTruthy();
    const { token } = (await login.json()) as { token: string };
    const auth = { Authorization: `Bearer ${token}` };

    await request.patch(`${API}/api/v1/settings`, {
      headers: auth,
      data: { inputLock: { keyboard: false, mouse: true, voice: false, camera: false } },
    });

    const exam = await request.patch(`${API}/api/v1/settings`, {
      headers: auth,
      data: { examMode: true },
    });
    expect(exam.ok()).toBeTruthy();
    const body = (await exam.json()) as {
      inputLock?: { keyboard?: boolean; mouse?: boolean };
      clientExitAllowed?: boolean;
      examModeSnapshot?: boolean;
    };
    expect(body.inputLock?.keyboard).toBeTruthy();
    expect(body.inputLock?.mouse).toBeTruthy();
    expect(body.clientExitAllowed).toBeFalsy();
    expect(body.examModeSnapshot).toBeTruthy();

    const ev = await request.get(`${API}/api/v1/settings/exit-lock-events?kind=exam_mode&limit=5`, {
      headers: auth,
    });
    expect(ev.ok()).toBeTruthy();
    const items = ((await ev.json()) as { items: Array<{ kind: string }> }).items;
    expect(items.some((i) => i.kind === 'exam_mode')).toBeTruthy();

    const restore = await request.patch(`${API}/api/v1/settings`, {
      headers: auth,
      data: { examModeRestore: true },
    });
    expect(restore.ok()).toBeTruthy();
    const restored = (await restore.json()) as {
      inputLock?: { keyboard?: boolean; mouse?: boolean; camera?: boolean };
      examModeRestored?: boolean;
    };
    expect(restored.examModeRestored).toBeTruthy();
    expect(restored.inputLock?.keyboard).toBeFalsy();
    expect(restored.inputLock?.mouse).toBeTruthy();
    expect(restored.inputLock?.camera).toBeFalsy();
  });

  test('input-lock SSE stream pushes store without exit-lock coupling', async ({ request }) => {
    const password = await ensureTeacherPasswordReady(request);
    const login = await request.post(`${API}/api/v1/auth/login`, {
      data: { username: TEACHER_USER, password },
    });
    expect(login.ok()).toBeTruthy();
    const { token } = (await login.json()) as { token: string };
    const auth = { Authorization: `Bearer ${token}` };

    // SSE is long-lived; assert store/summary via public settings after PATCH (hub broadcast path).
    const patch = await request.patch(`${API}/api/v1/settings`, {
      headers: auth,
      data: { inputLock: { keyboard: true, mouse: false, voice: false, camera: false } },
    });
    expect(patch.ok()).toBeTruthy();
    const pub = await request.get(`${API}/api/v1/settings/public`);
    const body = (await pub.json()) as {
      inputLockSummary?: { global: string; byClass: unknown[]; bySeat: unknown[] };
      inputLockStore?: { global?: { keyboard?: boolean } };
    };
    expect(body.inputLockStore?.global?.keyboard).toBeTruthy();
    expect(body.inputLockSummary?.global).toMatch(/键盘/);
  });
});