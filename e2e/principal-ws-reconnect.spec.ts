import { expect, test } from '@playwright/test';
import { loginTeacherWeb } from './helpers/teacherWebLogin';

/**
 * Inject a mock WebSocket: first connection opens as live, then closes once;
 * second connection opens again → principal-ws-live should recover.
 */
test.describe('principal WS reconnect', () => {
  test('disconnect then live again', async ({ page, request }) => {
    await page.addInitScript(() => {
      type Sock = {
        onopen: ((ev?: Event) => void) | null;
        onclose: ((ev?: CloseEvent) => void) | null;
        onerror: ((ev?: Event) => void) | null;
        onmessage: ((ev: MessageEvent) => void) | null;
        close: () => void;
        readyState: number;
        send: () => void;
      };
      let n = 0;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).WebSocket = class MockWS {
        onopen: Sock['onopen'] = null;
        onclose: Sock['onclose'] = null;
        onerror: Sock['onerror'] = null;
        onmessage: Sock['onmessage'] = null;
        readyState = 0;
        constructor(public url: string) {
          n += 1;
          const idx = n;
          queueMicrotask(() => {
            this.readyState = 1;
            this.onopen?.(new Event('open'));
            this.onmessage?.(
              new MessageEvent('message', {
                data: JSON.stringify({ onlineTotal: 0, rosterTotal: 0 }),
              }),
            );
            if (idx === 1) {
              setTimeout(() => {
                this.readyState = 3;
                this.onclose?.(new CloseEvent('close'));
              }, 80);
            }
          });
        }
        close() {
          this.readyState = 3;
          this.onclose?.(new CloseEvent('close'));
        }
        send() {
          /* noop */
        }
      };
    });

    await loginTeacherWeb(page, request);
    await page.getByRole('button', { name: '上课', exact: true }).click();
    const dash = page.getByTestId('principal-dashboard');
    await expect(dash).toBeVisible({ timeout: 20_000 });
    const live = page.getByTestId('principal-ws-live');
    await expect(live).toContainText(/实时|Live|即時|ライブ|실시간/, { timeout: 10_000 });
    // After mock close, briefly 轮询后备 then reconnect → 实时 again
    await expect
      .poll(async () => (await live.innerText()).replace(/\s+/g, ''), { timeout: 15_000 })
      .toMatch(/实时|Live|即時|ライブ|실시간/);
  });
});
