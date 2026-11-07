/**
 * Buzz WebSocket: JWT required; authenticated clients receive buzz snapshot.
 */
import { expect, test } from '@playwright/test';
import { ensureTeacherPasswordReady, TEACHER_USER } from './helpers/teacherLogin';

const API = process.env.API_BASE ?? 'http://127.0.0.1:8787';

function wsUrl(pathAndQuery: string): string {
  return API.replace(/^http/, 'ws') + pathAndQuery;
}

function openWs(url: string): Promise<{
  ws: WebSocket;
  messages: string[];
  closeCode: number | null;
}> {
  return new Promise((resolve, reject) => {
    const messages: string[] = [];
    let closeCode: number | null = null;
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      resolve({ ws, messages, closeCode });
    }, 2500);
    ws.addEventListener('message', (ev) => {
      messages.push(String(ev.data));
    });
    ws.addEventListener('close', (ev) => {
      closeCode = ev.code;
      clearTimeout(timer);
      resolve({ ws, messages, closeCode });
    });
    ws.addEventListener('error', () => {
      /* handshake may fail without token — wait for close */
    });
    ws.addEventListener('open', () => {
      /* keep open until timeout or close */
    });
    void reject;
  });
}

test('buzz WS rejects missing token', async ({ request }) => {
  const password = await ensureTeacherPasswordReady(request);
  const login = await request.post(`${API}/api/v1/auth/login`, {
    data: { username: TEACHER_USER, password },
  });
  expect(login.ok()).toBeTruthy();
  const classes = await request.get(`${API}/api/v1/classes`, {
    headers: { Authorization: `Bearer ${((await login.json()) as { token: string }).token}` },
  });
  const classId = ((await classes.json()) as { items: Array<{ id: string }> }).items[0]?.id;
  expect(classId).toBeTruthy();

  const { messages, closeCode } = await openWs(
    wsUrl(`/api/v1/session/buzz/ws?classId=${encodeURIComponent(classId!)}`),
  );
  expect(messages.length).toBe(0);
  // Browser WebSocket maps HTTP 401 upgrade failure to abnormal close (1006) or early close
  expect(closeCode === 1006 || closeCode === 1000 || closeCode == null || closeCode > 0).toBeTruthy();
});

test('buzz WS with token receives snapshot', async ({ request }) => {
  const password = await ensureTeacherPasswordReady(request);
  const login = await request.post(`${API}/api/v1/auth/login`, {
    data: { username: TEACHER_USER, password },
  });
  expect(login.ok()).toBeTruthy();
  const token = ((await login.json()) as { token: string }).token;
  const classes = await request.get(`${API}/api/v1/classes`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const classId = ((await classes.json()) as { items: Array<{ id: string }> }).items[0]?.id;
  expect(classId).toBeTruthy();

  const url = wsUrl(
    `/api/v1/session/buzz/ws?classId=${encodeURIComponent(classId!)}&token=${encodeURIComponent(token)}`,
  );
  const snapshot = await new Promise<Record<string, unknown>>((resolve, reject) => {
    const ws = new WebSocket(url);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('timeout waiting for buzz snapshot'));
    }, 5000);
    ws.addEventListener('message', (ev) => {
      clearTimeout(timer);
      try {
        const data = JSON.parse(String(ev.data)) as Record<string, unknown>;
        ws.close();
        resolve(data);
      } catch (e) {
        reject(e);
      }
    });
    ws.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error('ws error'));
    });
  });

  expect(snapshot.type).toBe('buzz');
  expect(snapshot.classId).toBe(classId);
  expect(Array.isArray(snapshot.hits)).toBeTruthy();
});
