import assert from 'node:assert/strict';
import {
  principalBackoffSequence,
  principalReconnectDelayMs,
} from './principalWsBackoff.js';
import { attachPrincipalWsReconnect, type PrincipalWsLike } from './principalWsReconnect.js';

assert.deepEqual(principalBackoffSequence(6), [
  1_000,
  2_000,
  4_000,
  8_000,
  16_000,
  30_000,
]);
assert.equal(principalReconnectDelayMs(1), 1_000);
assert.equal(principalReconnectDelayMs(7), 30_000);
assert.equal(principalReconnectDelayMs(0), 1_000);

// Disconnect harness: failed reconnects escalate backoff; successful open resets + live.
{
  const sockets: PrincipalWsLike[] = [];
  const queued: Array<{ fn: () => void; ms: number }> = [];
  let live = false;
  const ctl = attachPrincipalWsReconnect({
    buildUrl: () => 'ws://lab-test/principal',
    wsFactory: () => {
      const sock: PrincipalWsLike = {
        onopen: null,
        onclose: null,
        onerror: null,
        onmessage: null,
        close() {
          this.onclose?.(undefined);
        },
      };
      sockets.push(sock);
      const n = sockets.length;
      queueMicrotask(() => {
        // 1st + 4th open successfully; 2nd/3rd fail immediately (escalating backoff).
        if (n === 1 || n === 4) sock.onopen?.(undefined);
        else sock.onclose?.(undefined);
      });
      return sock;
    },
    schedule: (fn, ms) => {
      queued.push({ fn, ms });
      return queued.length as unknown as ReturnType<typeof setTimeout>;
    },
    clearSchedule: () => undefined,
    onLive: (v) => {
      live = v;
    },
  });

  await Promise.resolve();
  assert.equal(live, true);

  // Drop live connection → schedule 1s reconnect
  sockets[0]!.close();
  assert.equal(live, false);
  assert.equal(queued[0]?.ms, 1_000);
  queued.shift()!.fn();
  await Promise.resolve(); // 2nd socket fails → schedule 2s
  assert.equal(queued[0]?.ms, 2_000);
  queued.shift()!.fn();
  await Promise.resolve(); // 3rd fails → schedule 4s
  assert.equal(queued[0]?.ms, 4_000);
  queued.shift()!.fn();
  await Promise.resolve(); // 4th opens
  assert.equal(live, true);
  assert.deepEqual(ctl.getDelays().slice(0, 3), [1_000, 2_000, 4_000]);
  ctl.dispose();
}

console.log('principalWsBackoff.test.ts ok');
