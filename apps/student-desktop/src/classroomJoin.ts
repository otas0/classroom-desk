import { getOrCreatePresenceClientId } from './inputLock';

export type ClassroomJoinInfo = {
  ok?: boolean;
  enabled?: boolean;
  easyJoinOpen?: boolean;
  attachRequired?: boolean;
  joinPinRequired?: boolean;
  requireDeviceApproval?: boolean;
  attachOk?: boolean;
  classId?: string | null;
  className?: string | null;
  apiBase?: string | null;
  displayName?: string | null;
  hostName?: string;
  label?: string;
  error?: string;
  message?: string;
  retryAfterSec?: number;
};

export async function fetchClassroomJoin(apiBase: string): Promise<ClassroomJoinInfo> {
  const base = apiBase.replace(/\/$/, '');
  const res = await fetch(`${base}/api/v1/classroom/join`, { cache: 'no-store' });
  if (res.status === 429) {
    const body = (await res.json()) as ClassroomJoinInfo;
    throw new Error(body.message ?? '尝试过多，请稍后再试');
  }
  return (await res.json()) as ClassroomJoinInfo;
}

export async function attachClassroomJoin(
  apiBase: string,
  opts?: { pin?: string },
): Promise<ClassroomJoinInfo> {
  const base = apiBase.replace(/\/$/, '');
  const deviceId = getOrCreatePresenceClientId();
  let hostname = '';
  try {
    hostname = window.classroomDesk?.getClientHostName
      ? await window.classroomDesk.getClientHostName()
      : '';
  } catch {
    hostname = '';
  }
  const res = await fetch(`${base}/api/v1/classroom/join/attach`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pin: opts?.pin?.trim() || undefined,
      deviceId,
      hostname,
    }),
  });
  const body = (await res.json()) as ClassroomJoinInfo;
  if (!res.ok) {
    const err = new Error(body.message ?? body.error ?? `HTTP ${res.status}`);
    (err as Error & { code?: string; retryAfterSec?: number }).code = body.error;
    (err as Error & { retryAfterSec?: number }).retryAfterSec = body.retryAfterSec;
    throw err;
  }
  return body;
}

export async function resolveClassroomJoin(
  apiBase: string,
  preview?: ClassroomJoinInfo,
  pin?: string,
): Promise<ClassroomJoinInfo & { classId: string; apiBase: string }> {
  let join = preview ?? (await fetchClassroomJoin(apiBase));
  if (
    preview &&
    preview.attachRequired === undefined &&
    preview.joinPinRequired === undefined &&
    preview.requireDeviceApproval === undefined
  ) {
    join = await fetchClassroomJoin(apiBase);
  }
  const base = String(join.apiBase ?? apiBase).replace(/\/$/, '');
  const hasClass = Boolean(String(join.classId ?? '').trim());
  const needsAttach = Boolean(
    join.attachRequired || join.joinPinRequired || join.requireDeviceApproval || !hasClass,
  );
  if (!needsAttach && hasClass) {
    return {
      ...join,
      apiBase: base,
      classId: String(join.classId),
    };
  }
  if (!join.ok || !join.enabled) {
    throw new Error('教师未开放一键连班');
  }
  const attached = await attachClassroomJoin(base, { pin });
  const classId = String(attached.classId ?? '').trim();
  if (!classId) throw new Error('连班鉴权未返回 classId');
  return {
    ...attached,
    apiBase: String(attached.apiBase ?? base).replace(/\/$/, ''),
    classId,
  };
}
