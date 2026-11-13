/**
 * Start deploy/lab-shield-http as a real HTTP process for unit tests.
 * Starts deploy/lab-shield-http for unit tests.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HttpShieldConnector } from '../../services/shield/httpConnector.js';
import { setShieldConnector } from '../../services/shield/registry.js';

// helpers → test → src → server → apps → repo root
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../');

export async function startLabShieldHttp(opts?: {
  failRelease?: boolean;
}): Promise<{ base: string; connector: HttpShieldConnector; stop: () => void }> {
  const port = 18800 + Math.floor(Math.random() * 1000);
  const base = `http://127.0.0.1:${port}`;
  const child: ChildProcess = spawn(
    process.execPath,
    [path.join(root, 'deploy/lab-shield-http/server.mjs')],
    {
      cwd: root,
      env: {
        ...process.env,
        LAB_SHIELD_PORT: String(port),
        LAB_SHIELD_STATE: path.join(root, 'tmp', `lab-shield-test-${port}.json`),
        ...(opts?.failRelease ? { LAB_SHIELD_FAIL_RELEASE: '1' } : {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`${base}/health`);
      if (r.ok) break;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 100));
    if (i === 49) {
      child.kill();
      throw new Error('lab-shield-http did not become healthy');
    }
  }
  const connector = new HttpShieldConnector(base, '');
  setShieldConnector(connector);
  return {
    base,
    connector,
    stop: () => {
      child.kill();
    },
  };
}
