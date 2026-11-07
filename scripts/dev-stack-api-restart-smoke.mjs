#!/usr/bin/env node
/**
 * Smoke: while teacher Vite is up, SIGKILL the API child and assert:
 * - teacher :5174 still responds
 * - API /health returns after supervised restart (dev:stack) OR we can restart api alone
 *
 * Prefer running under an already-up `npm run dev:stack -- --no-student`.
 * This script kills whatever listens on :8787, waits for /health again (stack restart),
 * and checks teacher never went down.
 *
 *   npm run smoke:dev-stack-api-restart
 */
const apiHost = process.env.HOST || '127.0.0.1';
const apiPort = process.env.PORT || '8787';
const teacherUrl = process.env.TEACHER_WEB || 'http://127.0.0.1:5174/';
const waitMs = Number(process.env.SMOKE_WAIT_MS ?? 45_000);

async function probe(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return res.status;
  } catch {
    return 0;
  }
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const healthBefore = await probe(`http://${apiHost}:${apiPort}/health`);
  const teacherBefore = await probe(teacherUrl);
  if (healthBefore < 200 || healthBefore >= 300) {
    console.error(`API not up (${healthBefore}). Start: npm run dev:stack -- --no-student`);
    process.exit(1);
  }
  if (teacherBefore < 200 || teacherBefore >= 500) {
    console.error(`Teacher Vite not up (${teacherBefore}) at ${teacherUrl}`);
    process.exit(1);
  }
  console.log(`✓ baseline api=${healthBefore} teacher=${teacherBefore}`);

  // Kill listener on API port (macOS/Linux)
  const { execSync } = await import('node:child_process');
  try {
    const pids = execSync(`lsof -tiTCP:${apiPort} -sTCP:LISTEN`, { encoding: 'utf8' })
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    for (const pid of pids) {
      console.log(`[smoke] SIGKILL pid=${pid} on :${apiPort}`);
      try {
        process.kill(Number(pid), 'SIGKILL');
      } catch (e) {
        console.warn(`[smoke] kill ${pid}:`, e.message);
      }
    }
  } catch {
    console.error(`No listener on :${apiPort}`);
    process.exit(1);
  }

  await sleep(400);
  const teacherMid = await probe(teacherUrl);
  if (teacherMid < 200 || teacherMid >= 500) {
    console.error(`✗ teacher went down after API kill (status=${teacherMid})`);
    process.exit(1);
  }
  console.log(`✓ teacher still up after API kill (status=${teacherMid})`);

  const t0 = Date.now();
  let healthAfter = 0;
  while (Date.now() - t0 < waitMs) {
    healthAfter = await probe(`http://${apiHost}:${apiPort}/health`);
    if (healthAfter >= 200 && healthAfter < 300) break;
    await sleep(500);
  }
  if (healthAfter < 200 || healthAfter >= 300) {
    console.error(`✗ API did not recover within ${waitMs}ms (need supervised dev:stack restart)`);
    process.exit(1);
  }
  console.log(`✓ API healthy again after ${Date.now() - t0}ms`);

  const teacherEnd = await probe(teacherUrl);
  if (teacherEnd < 200 || teacherEnd >= 500) {
    console.error(`✗ teacher down at end (status=${teacherEnd})`);
    process.exit(1);
  }
  console.log('PASSED — teacher survived API 137-style kill; API came back via health gate/restart');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
