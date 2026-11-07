#!/usr/bin/env node
/**
 * POST a test payload to CLASSROOM_DESK_OPS_WEBHOOK (Slack / 飞书).
 * Does not touch GitHub Releases — use before wiring the Actions secret.
 *
 *   CLASSROOM_DESK_OPS_WEBHOOK=https://… npm run ops:webhook-dry-run
 */
const hook = String(process.env.CLASSROOM_DESK_OPS_WEBHOOK ?? '').trim();
if (!hook) {
  console.error('Set CLASSROOM_DESK_OPS_WEBHOOK to a Slack/飞书 webhook URL first.');
  process.exit(1);
}

const body = {
  text: `[classroom-desk] ops webhook dry-run · ${new Date().toISOString()} · host=${process.env.USER || 'local'}`,
  tag: 'dry-run',
  runId: 0,
};

const res = await fetch(hook, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});
const text = await res.text().catch(() => '');
console.log(JSON.stringify({ ok: res.ok, status: res.status, body: text.slice(0, 200) }, null, 2));
if (!res.ok) process.exit(2);
console.log('OK: channel should show the dry-run text.');
