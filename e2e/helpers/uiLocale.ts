import type { APIRequestContext } from '@playwright/test';
import { ensureTeacherPasswordReady, TEACHER_USER } from './teacherLogin.js';

const API = process.env.API_BASE ?? 'http://127.0.0.1:8787';

/** Reset classroom uiLocale to zh-CN so Chinese e2e selectors stay valid. */
export async function resetUiLocaleZhCN(request: APIRequestContext): Promise<void> {
  const password = await ensureTeacherPasswordReady(request);
  const login = await request.post(`${API}/api/v1/auth/login`, {
    data: { username: TEACHER_USER, password },
  });
  if (!login.ok()) return;
  const { token } = (await login.json()) as { token: string };
  await request.patch(`${API}/api/v1/settings`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { uiLocale: 'zh-CN' },
  });
}
