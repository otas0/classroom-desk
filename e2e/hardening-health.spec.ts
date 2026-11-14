import { expect, test } from '@playwright/test';
import { openPrepTab, selectTeacherClass } from './helpers/navPrep';
import { loginStaffWeb, loginTeacherWeb } from './helpers/teacherWebLogin';
import { ensureTeacherPasswordReady, TEACHER_USER } from './helpers/teacherLogin';

const API = process.env.API_BASE ?? 'http://127.0.0.1:8787';

test.describe('hardening health panel', () => {
  // TTL/SSE assistant cases share global inputLock store — isolate from parallel clearAll.
  test.describe.configure({ mode: 'serial' });

  test('empty class shows presence empty + AA export filename', async ({ page, request }) => {
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
      data: { name: `HardeningEmpty_${stamp}` },
    });
    expect(created.ok()).toBeTruthy();
    const classId = ((await created.json()) as { id: string }).id;

    await page.reload({ waitUntil: 'domcontentloaded' });
    await selectTeacherClass(page, classId);
    await openPrepTab(page, '加固体检');

    await expect(page.getByTestId('hardening-health-panel')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('hardening-health-summary')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('hardening-presence-empty')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('hardening-presence-summary')).toContainText(/在线 0/);
    await expect(page.getByTestId('hardening-copy-unhardened-tip')).toBeDisabled();

    const day = new Date().toISOString().slice(0, 10);
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 10_000 }),
      page.getByTestId('aa-checklist-export').click(),
    ]);
    expect(download.suggestedFilename()).toBe(`assigned-access-checklist-${day}.json`);
  });

  test('clipboard denied → fallback textarea', async ({ page, request }) => {
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
      data: { name: `ClipDeny_${stamp}` },
    });
    expect(created.ok()).toBeTruthy();
    const classId = ((await created.json()) as { id: string }).id;
    const stu = await request.post(`${API}/api/v1/classes/${classId}/students`, {
      headers: auth,
      data: { displayName: `剪贴板${stamp}`, studentNo: `CD${stamp % 100000}` },
    });
    const studentId = ((await stu.json()) as { id: string }).id;
    const sel = await request.post(`${API}/api/v1/auth/student-select`, {
      data: { classId, studentId },
    });
    const studentToken = ((await sel.json()) as { token: string }).token;
    await request.post(`${API}/api/v1/presence/heartbeat`, {
      headers: { Authorization: `Bearer ${studentToken}` },
      data: { hardened: false, clientVersion: '0.0.0-e2e' },
    });

    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: () => Promise.reject(new Error('clipboard_denied_e2e')),
        },
      });
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await selectTeacherClass(page, classId);
    await openPrepTab(page, '加固体检');
    await expect(page.getByTestId('hardening-copy-unhardened-tip')).toBeEnabled({ timeout: 15_000 });
    await page.getByTestId('hardening-copy-unhardened-tip').click();
    await expect(page.getByTestId('hardening-copy-msg')).toContainText(/剪贴板不可用/, {
      timeout: 8_000,
    });
    await expect(page.getByTestId('hardening-copy-fallback')).toBeVisible();
    await expect(page.getByTestId('hardening-copy-fallback')).toHaveValue(/未加固在线机位/);
    await expect(page.getByTestId('hardening-copy-fallback-select-all')).toBeVisible();
    await page.getByTestId('hardening-copy-fallback-select-all').click();
    const selected = await page.evaluate(() => {
      const el = document.querySelector(
        '[data-testid="hardening-copy-fallback"]',
      ) as HTMLTextAreaElement | null;
      if (!el) return '';
      return el.value.slice(el.selectionStart, el.selectionEnd);
    });
    expect(selected.length).toBeGreaterThan(10);
  });

  test('copy unhardened tip when presence reports hardened=false', async ({ page, request }) => {
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
      data: { name: `HardeningTip_${stamp}` },
    });
    expect(created.ok()).toBeTruthy();
    const classId = ((await created.json()) as { id: string }).id;
    const stu = await request.post(`${API}/api/v1/classes/${classId}/students`, {
      headers: auth,
      data: { displayName: `未加固生${stamp}`, studentNo: `UH${stamp % 100000}` },
    });
    expect(stu.ok()).toBeTruthy();
    const studentId = ((await stu.json()) as { id: string }).id;
    const sel = await request.post(`${API}/api/v1/auth/student-select`, {
      data: { classId, studentId },
    });
    expect(sel.ok()).toBeTruthy();
    const studentToken = ((await sel.json()) as { token: string }).token;
    const hb = await request.post(`${API}/api/v1/presence/heartbeat`, {
      headers: { Authorization: `Bearer ${studentToken}` },
      data: { clientVersion: '0.0.0-e2e', clientPlatform: 'e2e', hardened: false },
    });
    expect(hb.ok()).toBeTruthy();

    await page.reload({ waitUntil: 'domcontentloaded' });
    await selectTeacherClass(page, classId);
    await openPrepTab(page, '加固体检');
    await expect(page.getByTestId('hardening-presence-summary')).toContainText(/未加固 1/, {
      timeout: 15_000,
    });
    await expect(page.getByTestId('hardening-copy-unhardened-tip')).toBeEnabled();
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    page.once('dialog', (d) => void d.dismiss());
    await page.getByTestId('hardening-copy-unhardened-tip').click();
    await expect(page.getByTestId('hardening-copy-msg')).toContainText(/已复制 1|剪贴板/, {
      timeout: 8_000,
    });
  });

  test('assistant settings shows inputLockExpiresAt readonly', async ({ page, request }) => {
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
      data: { name: `AsstTtl_${stamp}` },
    });
    expect(createdClass.ok()).toBeTruthy();
    const classId = ((await createdClass.json()) as { id: string }).id;
    const endAt = new Date(Date.now() + 3_600_000).toISOString();
    const sess = await request.post(`${API}/api/v1/attendance/sessions`, {
      headers: auth,
      data: {
        classId,
        mode: 'manual',
        startAt: new Date(Date.now() - 60_000).toISOString(),
        endAt,
        lateAfterMinutes: 5,
      },
    });
    expect(sess.ok()).toBeTruthy();
    const sessionId = ((await sess.json()) as { id: string }).id;
    await request.patch(`${API}/api/v1/settings`, {
      headers: auth,
      data: {
        inputLock: {
          keyboard: true,
          bindAttendanceSessionId: sessionId,
        },
      },
    });

    const user = `asst_ttl_${stamp}`;
    const pass = `AsstPass${stamp % 100000}t9`;
    const created = await request.post(`${API}/api/v1/auth/assistants`, {
      headers: auth,
      data: { username: user, password: pass, displayName: 'TTL助教' },
    });
    expect(created.ok()).toBeTruthy();

    await loginStaffWeb(page, user, pass);
    await page
      .locator('aside')
      .getByRole('button', { name: /^(设置|Settings|設定|설정)$/ })
      .click();
    await expect(page.getByTestId('input-lock-readonly')).toBeVisible({ timeout: 15_000 });
    // Re-bind after login (parallel clearAll) — avoid reload wipe race; wait via SSE/poll.
    const bind = await request.patch(`${API}/api/v1/settings`, {
      headers: auth,
      data: {
        inputLock: {
          keyboard: true,
          bindAttendanceSessionId: sessionId,
        },
      },
    });
    expect(bind.ok()).toBeTruthy();
    const bindBody = (await bind.json()) as { inputLockExpiresAt?: string | null };
    expect(bindBody.inputLockExpiresAt).toBeTruthy();
    await expect(page.getByTestId('input-lock-expires-readonly')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('input-lock-expires-readonly')).not.toContainText(
      /未绑定|Not bound|未綁定|未バインド|미바인딩/,
      { timeout: 15_000 },
    );
    await expect(page.getByTestId('input-lock-expires-readonly')).toContainText(/\d/);
  });

  test('assistant expiresAt updates via input-lock SSE without reload', async ({ page, request }) => {
    const password = await ensureTeacherPasswordReady(request);
    const login = await request.post(`${API}/api/v1/auth/login`, {
      data: { username: TEACHER_USER, password },
    });
    expect(login.ok()).toBeTruthy();
    const { token } = (await login.json()) as { token: string };
    const auth = { Authorization: `Bearer ${token}` };

    await request.patch(`${API}/api/v1/settings`, {
      headers: auth,
      data: { inputLock: { clearAll: true, clearTtl: true } },
    });

    const stamp = Date.now();
    const createdClass = await request.post(`${API}/api/v1/classes`, {
      headers: auth,
      data: { name: `AsstSseTtl_${stamp}` },
    });
    expect(createdClass.ok()).toBeTruthy();
    const classId = ((await createdClass.json()) as { id: string }).id;
    const endAt = new Date(Date.now() + 7_200_000).toISOString();
    const sess = await request.post(`${API}/api/v1/attendance/sessions`, {
      headers: auth,
      data: {
        classId,
        mode: 'manual',
        startAt: new Date().toISOString(),
        endAt,
        lateAfterMinutes: 5,
      },
    });
    expect(sess.ok()).toBeTruthy();
    const sessionId = ((await sess.json()) as { id: string }).id;

    const user = `asst_sse_ttl_${stamp}`;
    const pass = `AsstPass${stamp % 100000}s9`;
    await request.post(`${API}/api/v1/auth/assistants`, {
      headers: auth,
      data: { username: user, password: pass, displayName: 'SSE TTL助教' },
    });

    await loginStaffWeb(page, user, pass);
    await page
      .locator('aside')
      .getByRole('button', { name: /^(设置|Settings|設定|설정)$/ })
      .click();
    await expect(page.getByTestId('input-lock-expires-readonly')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('input-lock-expires-readonly')).toContainText(
      /未绑定|Not bound|未綁定|未バインド|미바인딩/,
    );

    const bind = await request.patch(`${API}/api/v1/settings`, {
      headers: auth,
      data: {
        inputLock: {
          keyboard: true,
          bindAttendanceSessionId: sessionId,
        },
      },
    });
    expect(bind.ok()).toBeTruthy();
    expect(((await bind.json()) as { inputLockExpiresAt?: string | null }).inputLockExpiresAt).toBeTruthy();

    await expect(page.getByTestId('input-lock-expires-readonly')).not.toContainText(
      /未绑定|Not bound|未綁定|未バインド|미바인딩/,
      { timeout: 15_000 },
    );
  });

  test('assistant SSE force-fallback still updates expiresAt via poll', async ({ page, request }) => {
    const password = await ensureTeacherPasswordReady(request);
    const login = await request.post(`${API}/api/v1/auth/login`, {
      data: { username: TEACHER_USER, password },
    });
    expect(login.ok()).toBeTruthy();
    const { token } = (await login.json()) as { token: string };
    const auth = { Authorization: `Bearer ${token}` };

    await request.patch(`${API}/api/v1/settings`, {
      headers: auth,
      data: { inputLock: { clearAll: true, clearTtl: true } },
    });

    const stamp = Date.now();
    const createdClass = await request.post(`${API}/api/v1/classes`, {
      headers: auth,
      data: { name: `AsstPollTtl_${stamp}` },
    });
    expect(createdClass.ok()).toBeTruthy();
    const classId = ((await createdClass.json()) as { id: string }).id;
    const endAt = new Date(Date.now() + 7_200_000).toISOString();
    const sess = await request.post(`${API}/api/v1/attendance/sessions`, {
      headers: auth,
      data: {
        classId,
        mode: 'manual',
        startAt: new Date().toISOString(),
        endAt,
        lateAfterMinutes: 5,
      },
    });
    expect(sess.ok()).toBeTruthy();
    const sessionId = ((await sess.json()) as { id: string }).id;

    const user = `asst_poll_ttl_${stamp}`;
    const pass = `AsstPass${stamp % 100000}s9`;
    await request.post(`${API}/api/v1/auth/assistants`, {
      headers: auth,
      data: { username: user, password: pass, displayName: 'Poll TTL助教' },
    });

    await loginStaffWeb(page, user, pass);
    await page
      .locator('aside')
      .getByRole('button', { name: /^(设置|Settings|設定|설정)$/ })
      .click();
    await expect(page.getByTestId('input-lock-expires-readonly')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('input-lock-expires-readonly')).toContainText(
      /未绑定|Not bound|未綁定|未バインド|미바인딩/,
    );

    await page.waitForFunction(
      () =>
        typeof (window as unknown as { __cdForceAssistantInputLockSseFallback?: () => void })
          .__cdForceAssistantInputLockSseFallback === 'function',
      { timeout: 15_000 },
    );
    await page.evaluate(() => {
      (window as unknown as { __cdForceAssistantInputLockSseFallback: () => void }).__cdForceAssistantInputLockSseFallback();
    });
    await expect(page.getByTestId('input-lock-sse-polling-badge')).toBeVisible({ timeout: 8_000 });
    await expect(page.getByTestId('input-lock-sse-polling-badge')).toHaveText(
      /轮询中|Polling|輪詢中|ポーリング中|폴링 중/,
    );

    const bind = await request.patch(`${API}/api/v1/settings`, {
      headers: auth,
      data: {
        inputLock: {
          keyboard: true,
          bindAttendanceSessionId: sessionId,
        },
      },
    });
    expect(bind.ok()).toBeTruthy();
    const bindBody = (await bind.json()) as { inputLockExpiresAt?: string | null };
    expect(bindBody.inputLockExpiresAt).toBeTruthy();

    // Nudge immediate poll (SSE already closed); do not wait for 5s interval alone.
    await page.evaluate(() => {
      (window as unknown as { __cdForceAssistantInputLockSseFallback: () => void }).__cdForceAssistantInputLockSseFallback();
    });

    await expect(page.getByTestId('input-lock-expires-readonly')).not.toContainText(
      /未绑定|Not bound|未綁定|未バインド|미바인딩/,
      { timeout: 15_000 },
    );
  });
});