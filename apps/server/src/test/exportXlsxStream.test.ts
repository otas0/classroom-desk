import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { streamXlsxExport } from '../utils/exportFormats.js';

async function run() {
  const rows = Array.from({ length: 2500 }, (_, i) => [
    `S${i}`,
    `学生${i}`,
    i % 100,
  ]);
  const headers = ['学号', '姓名', '积分'];

  const before = new Set(
    fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith('cd-export-')),
  );

  const chunks: Buffer[] = [];
  const res = new PassThrough() as PassThrough & {
    setHeader: (k: string, v: string) => void;
    headersSent: boolean;
  };
  res.setHeader = () => undefined;
  res.headersSent = false;
  res.on('data', (c: Buffer) => chunks.push(Buffer.from(c)));

  const heapBefore = process.memoryUsage().heapUsed;
  await streamXlsxExport(res as never, {
    filenameBase: 'stress-roster',
    headers,
    rows,
  });
  await new Promise<void>((resolve) => res.on('finish', () => resolve()));
  const heapAfter = process.memoryUsage().heapUsed;

  const body = Buffer.concat(chunks);
  assert.ok(body.length > 1000, 'xlsx body should be non-trivial');
  // xlsx zip magic
  assert.equal(body[0], 0x50);
  assert.equal(body[1], 0x4b);

  const after = fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith('cd-export-'));
  const leaked = after.filter((f) => !before.has(f));
  assert.equal(leaked.length, 0, `temp xlsx leaked: ${leaked.join(', ')}`);

  // Heuristic: stream path should not hold a second full Buffer copy of the sheet
  // (writeFile + stream). Peak delta for 2500 rows should stay well under a naive
  // in-memory double-buffer of ~body*4.
  const delta = heapAfter - heapBefore;
  assert.ok(
    delta < body.length * 8 + 20_000_000,
    `unexpected heap growth ${delta} vs body ${body.length}`,
  );

  // Ensure no leftover named file under tmp for this test process
  for (const f of fs.readdirSync(os.tmpdir())) {
    if (f.startsWith('cd-export-') && f.endsWith('.xlsx')) {
      const full = path.join(os.tmpdir(), f);
      const age = Date.now() - fs.statSync(full).mtimeMs;
      if (age < 5_000) {
        assert.fail(`recent temp export still present: ${full}`);
      }
    }
  }

  console.log(
    `exportXlsxStream.test.ts ok body=${body.length}B heapDelta=${Math.round(delta / 1024)}KB`,
  );
}

void run().catch((e) => {
  console.error(e);
  process.exit(1);
});
