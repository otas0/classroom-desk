import { expect, test } from '@playwright/test';

const API = process.env.API_BASE ?? 'http://127.0.0.1:8787';

test('production /admin deep link serves SPA (no 404 JSON)', async ({ page, request }) => {
  const health = await request.get(`${API}/health`);
  expect(health.ok()).toBeTruthy();

  const res = await request.get(`${API}/admin/assignments`);
  expect(res.status()).toBe(200);
  const ct = res.headers()['content-type'] ?? '';
  expect(ct).toMatch(/text\/html/);
  const body = await res.text();
  expect(body).not.toContain('"error":"not_found"');
  expect(body.toLowerCase()).toContain('<!doctype html');

  await page.goto(`${API}/admin/assignments`);
  await expect(page.locator('#root')).toBeVisible();
  await expect(page.getByRole('heading', { name: /教师后台|Classroom|课堂/ })).toBeVisible({
    timeout: 15_000,
  });
});
