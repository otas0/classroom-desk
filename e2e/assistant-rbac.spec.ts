import { expect, test } from '@playwright/test';
import { ensureTeacherPasswordReady } from './helpers/teacherLogin';
import { loginStaffWeb } from './helpers/teacherWebLogin';

const API = process.env.API_BASE ?? 'http://127.0.0.1:8787';

async function teacherAuth(request: import('@playwright/test').APIRequestContext) {
  const password = await ensureTeacherPasswordReady(request);
  const login = await request.post(`${API}/api/v1/auth/login`, {
    data: { username: 'teacher', password },
  });
  expect(login.ok()).toBeTruthy();
  const { token } = (await login.json()) as { token: string };
  return { Authorization: `Bearer ${token}` };
}

test.describe('assistant RBAC', () => {
  test('login lands on attendance; roster read-only; no backup/exit-lock/create-assistant', async ({
    page,
    request,
  }) => {
    const auth = await teacherAuth(request);
    const stamp = Date.now();
    const user = `asst_e2e_${stamp}`;
    const pass = `AsstPass${stamp % 100000}a9`;
    const created = await request.post(`${API}/api/v1/auth/assistants`, {
      headers: auth,
      data: { username: user, password: pass, displayName: 'E2E助教' },
    });
    expect(created.ok()).toBeTruthy();

    await loginStaffWeb(page, user, pass);
    await expect(page.getByRole('heading', { name: '出勤报表' })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: '上课' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '指派学生机' })).toHaveCount(0);

    await page.locator('.prep-subnav').getByRole('button', { name: '名单', exact: true }).click();
    await expect(page.getByText(/助教只读名单/)).toBeVisible();
    await expect(page.getByRole('button', { name: '创建班级' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '添加学生' })).toHaveCount(0);

    await page.locator('aside').getByRole('button', { name: '设置', exact: true }).click();
    await expect(page.getByRole('heading', { name: '创建助教账号' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: '数据库备份' })).toHaveCount(0);
    await expect(page.getByText(/退出锁|解除码/)).toHaveCount(0);
    await expect(page.getByTestId('permissions-doc-link')).toBeVisible();

    const list = await request.get(`${API}/api/v1/auth/assistants`, { headers: auth });
    const items = ((await list.json()) as { items: Array<{ id: string; username: string }> }).items;
    const row = items.find((a) => a.username === user);
    if (row) {
      await request.post(`${API}/api/v1/auth/assistants/${row.id}/disable`, {
        headers: auth,
        data: {},
      });
    }
  });

  test('assistant first-login mustChangePassword is per-user (not teacher_password_ok)', async ({
    request,
  }) => {
    const auth = await teacherAuth(request);
    // Ensure teacher bootstrap gate is already cleared
    const teacherLogin = await request.post(`${API}/api/v1/auth/login`, {
      data: { username: 'teacher', password: await ensureTeacherPasswordReady(request) },
    });
    expect(teacherLogin.ok()).toBeTruthy();
    const tBody = (await teacherLogin.json()) as { mustChangePassword?: boolean };
    expect(tBody.mustChangePassword).toBeFalsy();

    const stamp = Date.now();
    const user = `asst_first_${stamp}`;
    const pass = `AsstPass${stamp % 100000}f9`;
    const created = await request.post(`${API}/api/v1/auth/assistants`, {
      headers: auth,
      data: { username: user, password: pass, displayName: '首次改密' },
    });
    expect(created.ok()).toBeTruthy();
    const { id, token: _ignore } = (await created.json()) as { id: string; token?: string };

    const asstLogin = await request.post(`${API}/api/v1/auth/login`, {
      data: { username: user, password: pass },
    });
    expect(asstLogin.ok()).toBeTruthy();
    const asstBody = (await asstLogin.json()) as {
      token: string;
      mustChangePassword?: boolean;
    };
    expect(asstBody.mustChangePassword).toBeTruthy();

    const changed = await request.post(`${API}/api/v1/auth/change-password`, {
      headers: { Authorization: `Bearer ${asstBody.token}` },
      data: { currentPassword: pass, newPassword: `${pass}Ok1` },
    });
    expect(changed.ok()).toBeTruthy();

    const again = await request.post(`${API}/api/v1/auth/login`, {
      data: { username: user, password: `${pass}Ok1` },
    });
    expect(again.ok()).toBeTruthy();
    expect(((await again.json()) as { mustChangePassword?: boolean }).mustChangePassword).toBeFalsy();

    await request.post(`${API}/api/v1/auth/assistants/${id}/disable`, { headers: auth, data: {} });
  });

  test('disabled assistant JWT → 401 account_disabled', async ({ request }) => {
    const auth = await teacherAuth(request);
    const stamp = Date.now();
    const user = `asst_dis_${stamp}`;
    const pass = `AsstPass${stamp % 100000}b9`;
    const created = await request.post(`${API}/api/v1/auth/assistants`, {
      headers: auth,
      data: { username: user, password: pass, displayName: '停用测' },
    });
    expect(created.ok()).toBeTruthy();
    const { id } = (await created.json()) as { id: string };

    const asstLogin = await request.post(`${API}/api/v1/auth/login`, {
      data: { username: user, password: pass },
    });
    expect(asstLogin.ok()).toBeTruthy();
    const { token } = (await asstLogin.json()) as { token: string };

    const meOk = await request.get(`${API}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(meOk.ok()).toBeTruthy();

    const dis = await request.post(`${API}/api/v1/auth/assistants/${id}/disable`, {
      headers: auth,
      data: {},
    });
    expect(dis.ok()).toBeTruthy();

    const meFail = await request.get(`${API}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(meFail.status()).toBe(401);
    const body = (await meFail.json()) as { error?: string };
    expect(body.error).toBe('account_disabled');
  });

  test('assistant may close/archive; delete & set_closes_at forbidden (API+UI)', async ({
    page,
    request,
  }) => {
    const auth = await teacherAuth(request);
    const classes = await request.get(`${API}/api/v1/classes`, { headers: auth });
    const classId = ((await classes.json()) as { items: Array<{ id: string }> }).items[0]?.id;
    expect(classId).toBeTruthy();

    const stamp = Date.now();
    const q = await request.post(`${API}/api/v1/questions`, {
      headers: auth,
      data: {
        classId,
        title: `助教题${stamp}`,
        stem: 'rbac?',
        type: 'bool',
        options: [
          { label: 'A', content: '正确', isCorrect: true },
          { label: 'B', content: '错误', isCorrect: false },
        ],
      },
    });
    expect(q.ok()).toBeTruthy();
    const qid = ((await q.json()) as { id: string }).id;

    const user = `asst_q_${stamp}`;
    const pass = `AsstPass${stamp % 100000}c9`;
    const created = await request.post(`${API}/api/v1/auth/assistants`, {
      headers: auth,
      data: { username: user, password: pass, displayName: '题权测' },
    });
    expect(created.ok()).toBeTruthy();
    const asstLogin = await request.post(`${API}/api/v1/auth/login`, {
      data: { username: user, password: pass },
    });
    const { token: asstToken } = (await asstLogin.json()) as { token: string };
    const asstAuth = { Authorization: `Bearer ${asstToken}` };

    const close = await request.post(`${API}/api/v1/questions/bulk`, {
      headers: asstAuth,
      data: { classId, ids: [qid], action: 'close' },
    });
    expect(close.ok()).toBeTruthy();

    const archive = await request.post(`${API}/api/v1/questions/bulk`, {
      headers: asstAuth,
      data: { classId, ids: [qid], action: 'archive' },
    });
    expect(archive.ok()).toBeTruthy();

    const del = await request.post(`${API}/api/v1/questions/bulk`, {
      headers: asstAuth,
      data: { classId, ids: [qid], action: 'delete' },
    });
    expect(del.status()).toBe(403);

    const deadline = await request.post(`${API}/api/v1/questions/bulk`, {
      headers: asstAuth,
      data: { classId, ids: [qid], action: 'set_closes_at', closesAt: new Date().toISOString() },
    });
    expect(deadline.status()).toBe(403);

    await loginStaffWeb(page, user, pass);
    await page.locator('.prep-subnav').getByRole('button', { name: '发题', exact: true }).click();
    await expect(page.getByText(/助教可收卷\/下线，不可发布/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: '发布题目' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '批量删除' })).toBeDisabled();

    await request.post(`${API}/api/v1/questions/bulk`, {
      headers: auth,
      data: { classId, ids: [qid], action: 'purge' },
    });
  });
});
