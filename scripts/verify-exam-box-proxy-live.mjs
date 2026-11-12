#!/usr/bin/env node
/**
 * Positive Exam Box probe when teacher API is already up.
 *
 *   CD_API_BASE=http://127.0.0.1:8787 EXAM_BOX_PROXY=http://127.0.0.1:8080 \
 *     node scripts/verify-exam-box-proxy-live.mjs
 *
 * Does not claim examBoxHardware; only checks compose sidecar wiring.
 */
const api = (process.env.CD_API_BASE || 'http://127.0.0.1:8787').replace(/\/$/, '');
const proxy = (process.env.EXAM_BOX_PROXY || 'http://127.0.0.1:8080').replace(/\/$/, '');

async function get(url, opts = {}) {
  const r = await fetch(url, { redirect: 'manual', ...opts });
  const text = await r.text().catch(() => '');
  return { status: r.status, headers: r.headers, text: text.slice(0, 200) };
}

const out = { ok: false, api, proxy, steps: [] };

try {
  const h = await get(`${api}/health`);
  out.steps.push({ step: 'teacher_health', status: h.status, ok: h.status === 200 });
  if (h.status !== 200) throw new Error('teacher /health not 200');

  const ph = await get(`${proxy}/health`);
  out.steps.push({ step: 'proxy_health', status: ph.status, ok: ph.status === 200 });
  if (ph.status !== 200) throw new Error('proxy /health not 200');

  const root = await get(`${proxy}/`);
  const loc = root.headers.get('location') || '';
  const redirected = root.status >= 300 && root.status < 400 && /portal/i.test(loc);
  out.steps.push({
    step: 'walled_garden_redirect',
    status: root.status,
    location: loc,
    ok: redirected,
  });
  if (!redirected) throw new Error('expected redirect to /portal');

  out.ok = true;
  console.log(JSON.stringify(out));
  process.exit(0);
} catch (e) {
  out.error = String(e?.message || e);
  console.log(JSON.stringify(out));
  process.exit(2);
}
