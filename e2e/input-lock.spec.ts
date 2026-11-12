import { expect, test } from '@playwright/test';
import { ensureTeacherPasswordReady, TEACHER_USER } from './helpers/teacherLogin';
import { loginStaffWeb, loginTeacherWeb } from './helpers/teacherWebLogin';
import { LIVE_CLASS_NAV, openInputLockAdvanced, openPrepTab, selectTeacherClass } from './helpers/navPrep';
import { resetUiLocaleZhCN } from './helpers/uiLocale';

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
        inputLock: { clearAll: true },
        uiLocale: 'zh-CN',
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
    await openInputLockAdvanced(page);
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

  test('unseated + global lock → banner + input-lock-unseated-note', async ({ page, request }) => {
    test.skip(!(await studentReachable()), 'student vite required');

    const password = await ensureTeacherPasswordReady(request);
    const login = await request.post(`${API}/api/v1/auth/login`, {
      data: { username: TEACHER_USER, password },
    });
    expect(login.ok()).toBeTruthy();
    const { token } = (await login.json()) as { token: string };
    const auth = { Authorization: `Bearer ${token}` };

    const stamp = Date.now();
    const createdClass = await request.post(`${API}/api/v1/classes`, {
      headers: auth,
      data: { name: `UnseatLock_${stamp}` },
    });
    expect(createdClass.ok()).toBeTruthy();
    const classId = ((await createdClass.json()) as { id: string }).id;
    const stu = await request.post(`${API}/api/v1/classes/${classId}/students`, {
      headers: auth,
      data: { displayName: `未排座${stamp}`, studentNo: `U${stamp % 100000}` },
    });
    expect(stu.ok()).toBeTruthy();
    const studentId = ((await stu.json()) as { id: string }).id;

    const lock = await request.patch(`${API}/api/v1/settings`, {
      headers: auth,
      data: {
        inputLock: {
          scope: 'global',
          keyboard: true,
          mouse: false,
          voice: false,
          camera: false,
        },
      },
    });
    expect(lock.ok()).toBeTruthy();

    const sel = await request.post(`${API}/api/v1/auth/student-select`, {
      data: { classId, studentId },
    });
    expect(sel.ok()).toBeTruthy();
    const tok = ((await sel.json()) as { token: string }).token;

    const student = await page.context().newPage();
    await student.addInitScript(
      ({ apiBase, tok }) => {
        localStorage.setItem('classroom-desk.api-base', apiBase);
        localStorage.setItem('classroom-desk.token', tok);
        localStorage.removeItem('cd_seat_id');
        localStorage.removeItem('cd_seat_label');
      },
      { apiBase: API, tok },
    );
    await student.goto(`${STUDENT_WEB}/?e2e=1`, { waitUntil: 'domcontentloaded' });
    await expect(student.getByTestId('input-lock-banner')).toBeVisible({ timeout: 15_000 });
    await expect(student.getByTestId('input-lock-unseated-note')).toBeVisible({ timeout: 10_000 });
    await expect(student.getByTestId('input-lock-unseated-note')).toContainText(/本机未排座/);
    // Mutual exclusion: global/class path must not show seat-miss tip.
    await expect(student.getByTestId('input-lock-seat-miss-note')).toHaveCount(0);
    await student.close();
  });

  test('seat_map bind → lock by seat id → only that student banner', async ({ page, request }) => {
    test.skip(!(await studentReachable()), 'student vite required');

    const password = await ensureTeacherPasswordReady(request);
    const login = await request.post(`${API}/api/v1/auth/login`, {
      data: { username: TEACHER_USER, password },
    });
    expect(login.ok()).toBeTruthy();
    const { token } = (await login.json()) as { token: string };
    const auth = { Authorization: `Bearer ${token}` };

    const stamp = Date.now();
    const createdClass = await request.post(`${API}/api/v1/classes`, {
      headers: auth,
      data: { name: `SeatLock_${stamp}` },
    });
    expect(createdClass.ok()).toBeTruthy();
    const classId = ((await createdClass.json()) as { id: string }).id;

    const stuA = await request.post(`${API}/api/v1/classes/${classId}/students`, {
      headers: auth,
      data: { displayName: `座锁甲${stamp}`, studentNo: `SA${stamp % 100000}` },
    });
    const stuB = await request.post(`${API}/api/v1/classes/${classId}/students`, {
      headers: auth,
      data: { displayName: `座锁乙${stamp}`, studentNo: `SB${stamp % 100000}` },
    });
    expect(stuA.ok()).toBeTruthy();
    expect(stuB.ok()).toBeTruthy();
    const studentAId = ((await stuA.json()) as { id: string }).id;
    const studentBId = ((await stuB.json()) as { id: string }).id;

    const grid = await request.put(`${API}/api/v1/classes/${classId}/seats`, {
      headers: auth,
      data: { rows: 1, cols: 2 },
    });
    expect(grid.ok()).toBeTruthy();
    const seatsRes = await request.get(`${API}/api/v1/classes/${classId}/seats`, { headers: auth });
    const seats = ((await seatsRes.json()) as { items: Array<{ id: string; label: string }> }).items;
    expect(seats.length).toBeGreaterThanOrEqual(2);
    const seatA = seats[0]!;
    const seatB = seats[1]!;

    const bind = await request.patch(`${API}/api/v1/classes/${classId}/seats/${seatA.id}`, {
      headers: auth,
      data: { studentId: studentAId, label: `A-${stamp % 1000}` },
    });
    expect(bind.ok()).toBeTruthy();

    const lock = await request.patch(`${API}/api/v1/settings`, {
      headers: auth,
      data: {
        inputLock: {
          scope: 'seat',
          classId,
          seatId: seatA.id,
          keyboard: true,
          mouse: false,
          voice: false,
          camera: false,
        },
      },
    });
    expect(lock.ok()).toBeTruthy();

    const pubA = await request.get(
      `${API}/api/v1/settings/public?classId=${encodeURIComponent(classId)}&seatId=${encodeURIComponent(seatA.id)}`,
    );
    const bodyA = (await pubA.json()) as { inputLock?: { keyboard?: boolean } };
    expect(bodyA.inputLock?.keyboard).toBeTruthy();

    const pubB = await request.get(
      `${API}/api/v1/settings/public?classId=${encodeURIComponent(classId)}&seatId=${encodeURIComponent(seatB.id)}`,
    );
    const bodyB = (await pubB.json()) as { inputLock?: { keyboard?: boolean } };
    expect(bodyB.inputLock?.keyboard).toBeFalsy();

    // Audit detail includes seat label + id
    const audit = await request.get(`${API}/api/v1/audit?limit=20`, { headers: auth });
    if (audit.ok()) {
      const items = ((await audit.json()) as { items: Array<{ action: string; detail: string }> })
        .items;
      const row = items.find((i) => i.action === 'settings.input_lock');
      expect(row?.detail ?? '').toMatch(new RegExp(seatA.id));
    }

    const selA = await request.post(`${API}/api/v1/auth/student-select`, {
      data: { classId, studentId: studentAId },
    });
    const selB = await request.post(`${API}/api/v1/auth/student-select`, {
      data: { classId, studentId: studentBId },
    });
    expect(selA.ok()).toBeTruthy();
    expect(selB.ok()).toBeTruthy();
    const tokA = ((await selA.json()) as { token: string }).token;
    const tokB = ((await selB.json()) as { token: string }).token;

    const pageA = await page.context().newPage();
    await pageA.addInitScript(
      ({ apiBase, tok, seatId }) => {
        localStorage.setItem('classroom-desk.api-base', apiBase);
        localStorage.setItem('classroom-desk.token', tok);
        localStorage.setItem('cd_seat_id', seatId);
      },
      { apiBase: API, tok: tokA, seatId: seatA.id },
    );
    await pageA.goto(`${STUDENT_WEB}/?e2e=1`, { waitUntil: 'domcontentloaded' });
    await expect(pageA.getByTestId('input-lock-banner')).toBeVisible({ timeout: 15_000 });
    await expect(pageA.getByTestId('input-lock-banner')).toContainText(/键盘/);

    const pageB = await page.context().newPage();
    await pageB.addInitScript(
      ({ apiBase, tok }) => {
        localStorage.setItem('classroom-desk.api-base', apiBase);
        localStorage.setItem('classroom-desk.token', tok);
        localStorage.removeItem('cd_seat_id');
      },
      { apiBase: API, tok: tokB },
    );
    await pageB.goto(`${STUDENT_WEB}/?e2e=1`, { waitUntil: 'domcontentloaded' });
    // Unseated student: no seat-scoped banner; may show unseated note only if global/class lock on.
    await expect(pageB.getByTestId('input-lock-banner')).toHaveCount(0, { timeout: 12_000 });
    // Seat-only lock + unseated: tip without global banner; no unseated-note.
    await expect(pageB.getByTestId('input-lock-seat-miss-note')).toBeVisible({ timeout: 12_000 });
    await expect(pageB.getByTestId('input-lock-seat-miss-note')).toContainText(/座锁未命中/);
    await expect(pageB.getByTestId('input-lock-unseated-note')).toHaveCount(0);

    // 换人同座：unbind A → A's stale clientId must not keep seat lock (clears cd_seat_id on refresh).
    await request.patch(`${API}/api/v1/classes/${classId}/seats/${seatA.id}`, {
      headers: auth,
      data: { studentId: null },
    });
    await pageA.reload({ waitUntil: 'domcontentloaded' });
    await expect(pageA.getByTestId('input-lock-banner')).toHaveCount(0, { timeout: 15_000 });

    await pageA.close();
    await pageB.close();
  });

  test('seat-bind SSE updates student seat chip within 2s', async ({ page, request }) => {
    test.skip(!(await studentReachable()), 'student vite required');

    const password = await ensureTeacherPasswordReady(request);
    const login = await request.post(`${API}/api/v1/auth/login`, {
      data: { username: TEACHER_USER, password },
    });
    expect(login.ok()).toBeTruthy();
    const { token } = (await login.json()) as { token: string };
    const auth = { Authorization: `Bearer ${token}` };

    const stamp = Date.now();
    const createdClass = await request.post(`${API}/api/v1/classes`, {
      headers: auth,
      data: { name: `SeatBindSSE_${stamp}` },
    });
    expect(createdClass.ok()).toBeTruthy();
    const classId = ((await createdClass.json()) as { id: string }).id;
    const stu = await request.post(`${API}/api/v1/classes/${classId}/students`, {
      headers: auth,
      data: { displayName: `绑座${stamp}`, studentNo: `SB${stamp % 100000}` },
    });
    expect(stu.ok()).toBeTruthy();
    const studentId = ((await stu.json()) as { id: string }).id;

    const grid = await request.put(`${API}/api/v1/classes/${classId}/seats`, {
      headers: auth,
      data: { rows: 1, cols: 1 },
    });
    expect(grid.ok()).toBeTruthy();
    const seatsRes = await request.get(`${API}/api/v1/classes/${classId}/seats`, { headers: auth });
    const seats = ((await seatsRes.json()) as { items: Array<{ id: string; label: string }> }).items;
    expect(seats[0]).toBeTruthy();
    const seat = seats[0]!;
    const seatLabel = `SSE-${stamp % 10000}`;

    const sel = await request.post(`${API}/api/v1/auth/student-select`, {
      data: { classId, studentId },
    });
    expect(sel.ok()).toBeTruthy();
    const tok = ((await sel.json()) as { token: string }).token;

    const student = await page.context().newPage();
    await student.addInitScript(
      ({ apiBase, tok }) => {
        localStorage.setItem('classroom-desk.api-base', apiBase);
        localStorage.setItem('classroom-desk.token', tok);
        localStorage.removeItem('cd_seat_id');
        localStorage.removeItem('cd_seat_label');
      },
      { apiBase: API, tok },
    );
    await student.goto(`${STUDENT_WEB}/?e2e=1`, { waitUntil: 'domcontentloaded' });
    await expect(student.getByTestId('student-seat-unbound')).toBeVisible({ timeout: 15_000 });

    const bind = await request.patch(`${API}/api/v1/classes/${classId}/seats/${seat.id}`, {
      headers: auth,
      data: { studentId, label: seatLabel },
    });
    expect(bind.ok()).toBeTruthy();

    await expect(student.getByTestId('student-seat-binding')).toBeVisible({ timeout: 2_000 });
    await expect(student.getByTestId('student-seat-binding')).toContainText(seatLabel);
    await student.close();
  });

  test('clearAll clears exam-mode snapshot', async ({ request }) => {
    const password = await ensureTeacherPasswordReady(request);
    const login = await request.post(`${API}/api/v1/auth/login`, {
      data: { username: TEACHER_USER, password },
    });
    expect(login.ok()).toBeTruthy();
    const { token } = (await login.json()) as { token: string };
    const auth = { Authorization: `Bearer ${token}` };

    const exam = await request.patch(`${API}/api/v1/settings`, {
      headers: auth,
      data: { examMode: true },
    });
    expect(exam.ok()).toBeTruthy();
    const examBody = (await exam.json()) as { examModeSnapshot?: boolean };
    expect(examBody.examModeSnapshot).toBeTruthy();

    const cleared = await request.patch(`${API}/api/v1/settings`, {
      headers: auth,
      data: { inputLock: { clearAll: true } },
    });
    expect(cleared.ok()).toBeTruthy();
    const body = (await cleared.json()) as { examModeSnapshot?: boolean };
    expect(body.examModeSnapshot).toBeFalsy();

    const settings = await request.get(`${API}/api/v1/settings`, { headers: auth });
    expect(settings.ok()).toBeTruthy();
    const s = (await settings.json()) as { examModeSnapshot?: boolean };
    expect(s.examModeSnapshot).toBeFalsy();

    const audit = await request.get(`${API}/api/v1/audit?limit=20`, { headers: auth });
    expect(audit.ok()).toBeTruthy();
    const items = ((await audit.json()) as { items: Array<{ action: string; detail: string }> })
      .items;
    const row = items.find((i) => i.action === 'settings.input_lock' && /clear_all/.test(i.detail));
    expect(row?.detail ?? '').toMatch(/clearedExamSnapshot":\s*true/);
  });

  test('clearAll ConfirmModal shows byClass/bySeat counts', async ({ page, request }) => {
    const { password } = await loginTeacherWeb(page, request);
    const login = await request.post(`${API}/api/v1/auth/login`, {
      data: { username: TEACHER_USER, password },
    });
    expect(login.ok()).toBeTruthy();
    const { token } = (await login.json()) as { token: string };
    const auth = { Authorization: `Bearer ${token}` };

    const stamp = Date.now();
    const createdClass = await request.post(`${API}/api/v1/classes`, {
      headers: auth,
      data: { name: `ClearAllUI_${stamp}` },
    });
    expect(createdClass.ok()).toBeTruthy();
    const classId = ((await createdClass.json()) as { id: string }).id;

    await request.patch(`${API}/api/v1/settings`, {
      headers: auth,
      data: {
        inputLock: {
          scope: 'class',
          classId,
          keyboard: true,
          mouse: false,
          voice: false,
          camera: false,
        },
      },
    });

    await openPrepTab(page, '设置');
    await expect(page.getByTestId('input-lock-controls')).toBeVisible({ timeout: 15_000 });
    // Refresh settings so counts include the class lock we just set.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await openPrepTab(page, '设置');
    await expect(page.getByTestId('input-lock-controls')).toBeVisible({ timeout: 15_000 });
    await openInputLockAdvanced(page);

    await page.getByTestId('input-lock-none').click();
    const modal = page.getByTestId('input-lock-clear-all-confirm');
    await expect(modal).toBeVisible({ timeout: 8_000 });
    await expect(page.getByTestId('input-lock-clear-all-class-count')).toBeVisible();
    const classCountText = await page.getByTestId('input-lock-clear-all-class-count').innerText();
    expect(Number(classCountText)).toBeGreaterThanOrEqual(1);
    await page.getByRole('button', { name: '确认全部解除' }).click();
    await expect(modal).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByText(/已全部解除物理输入锁/).first()).toBeVisible({ timeout: 10_000 });
  });

  test('projection SSE force-fallback shows projection-input-lock-sse-fallback', async ({
    page,
    request,
  }) => {
    const { password } = await loginTeacherWeb(page, request);
    const login = await request.post(`${API}/api/v1/auth/login`, {
      data: { username: TEACHER_USER, password },
    });
    expect(login.ok()).toBeTruthy();
    const { token } = (await login.json()) as { token: string };
    const auth = { Authorization: `Bearer ${token}` };

    const stamp = Date.now();
    const createdClass = await request.post(`${API}/api/v1/classes`, {
      headers: auth,
      data: { name: `ProjSse_${stamp}` },
    });
    expect(createdClass.ok()).toBeTruthy();
    const classId = ((await createdClass.json()) as { id: string }).id;

    await page.reload({ waitUntil: 'domcontentloaded' });
    await selectTeacherClass(page, classId);
    await page.locator('aside').getByRole('button', { name: LIVE_CLASS_NAV }).click();

    await expect(page.getByRole('button', { name: '投影全屏' })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: '投影全屏' }).click();
    await expect(page.getByTestId('projection-input-lock-summary')).toBeVisible({ timeout: 15_000 });

    await page.waitForFunction(
      () => typeof (window as unknown as { __cdForceInputLockSseFallback?: () => void }).__cdForceInputLockSseFallback === 'function',
      { timeout: 10_000 },
    );
    await page.evaluate(() => {
      (window as unknown as { __cdForceInputLockSseFallback: () => void }).__cdForceInputLockSseFallback();
    });
    await expect(page.getByTestId('projection-input-lock-sse-fallback')).toBeVisible({
      timeout: 8_000,
    });
  });

  test('assistant badge → 全局 after teacher clearAll (dual-role)', async ({
    page,
    request,
  }) => {
    const password = await ensureTeacherPasswordReady(request);
    const login = await request.post(`${API}/api/v1/auth/login`, {
      data: { username: TEACHER_USER, password },
    });
    expect(login.ok()).toBeTruthy();
    const { token } = (await login.json()) as { token: string };
    const auth = { Authorization: `Bearer ${token}` };

    const stamp = Date.now();
    const createdClass = await request.post(`${API}/api/v1/classes`, {
      headers: auth,
      data: { name: `AsstBadge_${stamp}` },
    });
    expect(createdClass.ok()).toBeTruthy();
    const classId = ((await createdClass.json()) as { id: string }).id;

    await request.patch(`${API}/api/v1/settings`, {
      headers: auth,
      data: {
        inputLock: {
          scope: 'class',
          classId,
          keyboard: true,
          mouse: false,
          voice: false,
          camera: false,
        },
      },
    });

    const user = `asst_badge_${stamp}`;
    const pass = `AsstPass${stamp % 100000}b9`;
    const created = await request.post(`${API}/api/v1/auth/assistants`, {
      headers: auth,
      data: { username: user, password: pass, displayName: '徽章助教' },
    });
    expect(created.ok()).toBeTruthy();

    await loginStaffWeb(page, user, pass);
    await page.locator('aside').getByRole('button', { name: '设置', exact: true }).click();
    await expect(page.getByTestId('input-lock-readonly')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('input-lock-scope-badge-class')).toBeVisible({ timeout: 10_000 });

    // Teacher clearAll via API (second role)
    await request.patch(`${API}/api/v1/settings`, {
      headers: auth,
      data: { inputLock: { clearAll: true } },
    });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('aside').getByRole('button', { name: '设置', exact: true }).click();
    await expect(page.getByTestId('input-lock-scope-badge-global')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('input-lock-scope-badge')).toContainText(/全局/);
  });

  test('TTL expire clears student input-lock banner', async ({ page, request }) => {
    test.skip(!(await studentReachable()), 'student vite required');

    const password = await ensureTeacherPasswordReady(request);
    const login = await request.post(`${API}/api/v1/auth/login`, {
      data: { username: TEACHER_USER, password },
    });
    expect(login.ok()).toBeTruthy();
    const { token } = (await login.json()) as { token: string };
    const auth = { Authorization: `Bearer ${token}` };

    await request.patch(`${API}/api/v1/settings`, {
      headers: auth,
      data: {
        inputLock: {
          keyboard: true,
          mouse: false,
          voice: false,
          camera: false,
          expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        },
      },
    });

    const student = await page.context().newPage();
    await student.addInitScript((apiBase) => {
      localStorage.setItem('classroom-desk.api-base', apiBase);
    }, API);
    await student.goto(`${STUDENT_WEB}/?e2e=1`, { waitUntil: 'domcontentloaded' });
    await expect(student.getByTestId('input-lock-banner')).toBeVisible({ timeout: 15_000 });

    // Past expiresAt → next public settings read purges + SSE/poll clears banner
    await request.patch(`${API}/api/v1/settings`, {
      headers: auth,
      data: {
        inputLock: { expiresAt: new Date(Date.now() - 2_000).toISOString() },
      },
    });
    // Force purge path via public GET (same as student poll)
    await request.get(`${API}/api/v1/settings/public`);
    await expect(student.getByTestId('input-lock-banner')).toHaveCount(0, { timeout: 20_000 });
    await expect(student.getByTestId('input-lock-ttl-cleared-toast')).toContainText(
      '课次结束，输入锁已解除',
      { timeout: 12_000 },
    );
    await student.close();
  });

  test('TTL expire toast via public purge broadcast (not 8s poll)', async ({ page, request }) => {
    test.skip(!(await studentReachable()), 'student vite required');

    const password = await ensureTeacherPasswordReady(request);
    const login = await request.post(`${API}/api/v1/auth/login`, {
      data: { username: TEACHER_USER, password },
    });
    expect(login.ok()).toBeTruthy();
    const { token } = (await login.json()) as { token: string };
    const auth = { Authorization: `Bearer ${token}` };

    await request.patch(`${API}/api/v1/settings`, {
      headers: auth,
      data: {
        inputLock: {
          keyboard: true,
          mouse: false,
          voice: false,
          camera: false,
          expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        },
      },
    });

    const student = await page.context().newPage();
    await student.addInitScript((apiBase) => {
      localStorage.setItem('classroom-desk.api-base', apiBase);
    }, API);
    await student.goto(`${STUDENT_WEB}/?e2e=1`, { waitUntil: 'domcontentloaded' });
    await expect(student.getByTestId('input-lock-banner')).toBeVisible({ timeout: 15_000 });

    await request.patch(`${API}/api/v1/settings`, {
      headers: auth,
      data: {
        inputLock: { expiresAt: new Date(Date.now() - 2_000).toISOString() },
      },
    });
    const t0 = Date.now();
    // public GET purges + broadcastInputLock → student SSE should toast without waiting 8s poll
    await request.get(`${API}/api/v1/settings/public`);
    await expect(student.getByTestId('input-lock-ttl-cleared-toast')).toContainText(
      '课次结束，输入锁已解除',
      { timeout: 4_000 },
    );
    expect(Date.now() - t0).toBeLessThan(7_000);
    await student.close();
  });

  test('input lock TTL binds attendance session end_at', async ({ request }) => {
    const password = await ensureTeacherPasswordReady(request);
    const login = await request.post(`${API}/api/v1/auth/login`, {
      data: { username: TEACHER_USER, password },
    });
    expect(login.ok()).toBeTruthy();
    const { token } = (await login.json()) as { token: string };
    const auth = { Authorization: `Bearer ${token}` };

    const stamp = Date.now();
    const createdClass = await request.post(`${API}/api/v1/classes`, {
      headers: auth,
      data: { name: `TtlLock_${stamp}` },
    });
    expect(createdClass.ok()).toBeTruthy();
    const classId = ((await createdClass.json()) as { id: string }).id;

    const startAt = new Date(Date.now() - 60_000).toISOString();
    const endAt = new Date(Date.now() + 3_600_000).toISOString();
    const sess = await request.post(`${API}/api/v1/attendance/sessions`, {
      headers: auth,
      data: { classId, mode: 'manual', startAt, endAt, lateAfterMinutes: 5 },
    });
    expect(sess.ok()).toBeTruthy();
    const sessionId = ((await sess.json()) as { id: string }).id;

    await request.patch(`${API}/api/v1/settings`, {
      headers: auth,
      data: {
        inputLock: {
          keyboard: true,
          mouse: false,
          voice: false,
          camera: false,
          bindAttendanceSessionId: sessionId,
        },
      },
    });

    const settings = await request.get(`${API}/api/v1/settings`, { headers: auth });
    expect(settings.ok()).toBeTruthy();
    const body = (await settings.json()) as {
      inputLockExpiresAt?: string | null;
      inputLockAttendanceSessionId?: string | null;
      inputLock?: { keyboard?: boolean };
    };
    expect(body.inputLockAttendanceSessionId).toBe(sessionId);
    expect(body.inputLockExpiresAt).toBeTruthy();
    expect(Date.parse(String(body.inputLockExpiresAt))).toBe(Date.parse(endAt));
    expect(body.inputLock?.keyboard).toBeTruthy();

    // Past expiry → purged
    await request.patch(`${API}/api/v1/settings`, {
      headers: auth,
      data: {
        inputLock: { expiresAt: new Date(Date.now() - 5_000).toISOString() },
      },
    });
    const pub = await request.get(`${API}/api/v1/settings/public`);
    expect(pub.ok()).toBeTruthy();
    const pubBody = (await pub.json()) as {
      inputLockActive?: boolean;
      inputLock?: { keyboard?: boolean };
      inputLockExpiresAt?: string | null;
    };
    expect(pubBody.inputLockActive).toBeFalsy();
    expect(pubBody.inputLock?.keyboard).toBeFalsy();
    expect(pubBody.inputLockExpiresAt).toBeNull();
  });

  test('bulk clearSeatIds unlocks seat locks', async ({ request }) => {
    const password = await ensureTeacherPasswordReady(request);
    const login = await request.post(`${API}/api/v1/auth/login`, {
      data: { username: TEACHER_USER, password },
    });
    expect(login.ok()).toBeTruthy();
    const { token } = (await login.json()) as { token: string };
    const auth = { Authorization: `Bearer ${token}` };

    const stamp = Date.now();
    const createdClass = await request.post(`${API}/api/v1/classes`, {
      headers: auth,
      data: { name: `ClearSeats_${stamp}` },
    });
    expect(createdClass.ok()).toBeTruthy();
    const classId = ((await createdClass.json()) as { id: string }).id;
    await request.put(`${API}/api/v1/classes/${classId}/seats`, {
      headers: auth,
      data: { rows: 1, cols: 2 },
    });
    const seats = await request.get(`${API}/api/v1/classes/${classId}/seats`, { headers: auth });
    const seatIds = ((await seats.json()) as { items: Array<{ id: string }> }).items.map((s) => s.id);
    expect(seatIds.length).toBe(2);

    await request.patch(`${API}/api/v1/settings`, {
      headers: auth,
      data: {
        inputLock: {
          classId,
          seatIds,
          keyboard: true,
          mouse: true,
          voice: false,
          camera: false,
        },
      },
    });
    await request.patch(`${API}/api/v1/settings`, {
      headers: auth,
      data: { inputLock: { classId, clearSeatIds: seatIds } },
    });

    const pub = await request.get(
      `${API}/api/v1/settings/public?classId=${encodeURIComponent(classId)}&seatId=${encodeURIComponent(seatIds[0]!)}`,
    );
    const body = (await pub.json()) as { inputLock?: { keyboard?: boolean } };
    expect(body.inputLock?.keyboard).toBeFalsy();
  });

  test('bulk lock empty seats by seatIds', async ({ request }) => {
    const password = await ensureTeacherPasswordReady(request);
    const login = await request.post(`${API}/api/v1/auth/login`, {
      data: { username: TEACHER_USER, password },
    });
    expect(login.ok()).toBeTruthy();
    const { token } = (await login.json()) as { token: string };
    const auth = { Authorization: `Bearer ${token}` };

    const stamp = Date.now();
    const createdClass = await request.post(`${API}/api/v1/classes`, {
      headers: auth,
      data: { name: `EmptyLock_${stamp}` },
    });
    expect(createdClass.ok()).toBeTruthy();
    const classId = ((await createdClass.json()) as { id: string }).id;

    await request.put(`${API}/api/v1/classes/${classId}/seats`, {
      headers: auth,
      data: { rows: 2, cols: 2 },
    });
    const seats = await request.get(`${API}/api/v1/classes/${classId}/seats`, { headers: auth });
    expect(seats.ok()).toBeTruthy();
    const seatIds = ((await seats.json()) as { items: Array<{ id: string }> }).items.map((s) => s.id);
    expect(seatIds.length).toBeGreaterThanOrEqual(2);

    const patch = await request.patch(`${API}/api/v1/settings`, {
      headers: auth,
      data: {
        inputLock: {
          classId,
          seatIds: seatIds.slice(0, 2),
          keyboard: true,
          mouse: true,
          voice: false,
          camera: false,
        },
      },
    });
    expect(patch.ok()).toBeTruthy();

    const pubA = await request.get(
      `${API}/api/v1/settings/public?classId=${encodeURIComponent(classId)}&seatId=${encodeURIComponent(seatIds[0]!)}`,
    );
    const bodyA = (await pubA.json()) as { inputLock?: { keyboard?: boolean; mouse?: boolean } };
    expect(bodyA.inputLock?.keyboard).toBeTruthy();
    expect(bodyA.inputLock?.mouse).toBeTruthy();
  });
});
