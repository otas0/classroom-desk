import assert from 'node:assert/strict';
import http from 'node:http';
import { notifyRestoreConfirm } from '../services/notifyEmail.js';

async function withServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
  fn: (base: string) => Promise<void>,
): Promise<void> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  assert.ok(addr && typeof addr === 'object');
  const base = `http://127.0.0.1:${addr.port}/hook`;
  try {
    await fn(base);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
}

async function run() {
  const prev = process.env.CLASSROOM_DESK_EMAIL_WEBHOOK;
  try {
    // Webhook 200 → emailDelivered
    await withServer((req, res) => {
      assert.equal(req.method, 'POST');
      let body = '';
      req.on('data', (c) => {
        body += c;
      });
      req.on('end', () => {
        const parsed = JSON.parse(body) as { type: string; code: string; to: string };
        assert.equal(parsed.type, 'restore_confirm');
        assert.equal(parsed.code, '123456');
        assert.equal(parsed.to, 'ops@example.com');
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"ok":true}');
      });
    }, async (base) => {
      process.env.CLASSROOM_DESK_EMAIL_WEBHOOK = base;
      const r = await notifyRestoreConfirm({
        to: 'ops@example.com',
        code: '123456',
        sha256: 'abc',
        fileName: 'backup.db',
        timeoutMs: 2000,
      });
      assert.equal(r.emailDelivered, true);
      assert.equal(r.mailtoUrl, null);
    });

    // Webhook hangs past timeout → not delivered
    await withServer((_req, res) => {
      // never end
      void res;
    }, async (base) => {
      process.env.CLASSROOM_DESK_EMAIL_WEBHOOK = base;
      const started = Date.now();
      const r = await notifyRestoreConfirm({
        to: 'ops@example.com',
        code: '654321',
        sha256: 'def',
        fileName: 'backup.db',
        timeoutMs: 150,
      });
      const elapsed = Date.now() - started;
      assert.equal(r.emailDelivered, false);
      assert.equal(r.mailtoUrl, null);
      assert.equal(r.webhookError, 'timeout');
      assert.ok(elapsed < 2000, `timeout should abort quickly, took ${elapsed}ms`);
    });

    // Webhook non-2xx → not delivered + status
    await withServer((_req, res) => {
      res.writeHead(503, { 'content-type': 'text/plain' });
      res.end('unavailable');
    }, async (base) => {
      process.env.CLASSROOM_DESK_EMAIL_WEBHOOK = base;
      const r = await notifyRestoreConfirm({
        to: 'ops@example.com',
        code: '999888',
        sha256: '503sha',
        fileName: 'backup.db',
        timeoutMs: 2000,
      });
      assert.equal(r.emailDelivered, false);
      assert.equal(r.webhookStatus, 503);
      assert.equal(r.webhookError, 'http_503');
    });

    // No webhook → mailto when address set
    delete process.env.CLASSROOM_DESK_EMAIL_WEBHOOK;
    const mailto = await notifyRestoreConfirm({
      to: 'teacher@school.local',
      code: '111222',
      sha256: 'ghi',
      fileName: 'x.db',
    });
    assert.equal(mailto.emailDelivered, false);
    assert.ok(mailto.mailtoUrl?.startsWith('mailto:teacher@school.local?'));
    assert.ok(mailto.mailtoUrl?.includes('111222'));

    console.log('notifyEmail.test.ts ok');
  } finally {
    if (prev == null) delete process.env.CLASSROOM_DESK_EMAIL_WEBHOOK;
    else process.env.CLASSROOM_DESK_EMAIL_WEBHOOK = prev;
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
