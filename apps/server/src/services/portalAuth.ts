import { createHash, randomInt } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { SignJWT, jwtVerify } from 'jose';
import { config } from '../config.js';
import { openDb } from '../db/client.js';
import { getSetting } from '../db/migrate.js';
import { nowIso } from '../utils/id.js';
import { upsertSetting } from './exitLock.js';
import {
  enforceStudentZonePolicy,
  getEverStudentZone,
  markEverStudentZone,
  resolveZoneForHint,
} from './networkZones.js';
import type { NetworkHint } from '@classroom-desk/shared';
import { studentUnauthorizedOnZone } from '@classroom-desk/shared';
import { getDeskDnsStatus } from './deskDns.js';
import { getShieldConnector, listShieldAdapterIds } from './shield/registry.js';

const encoder = new TextEncoder();
const COOKIE = 'cd_portal_sess';
const KEY_SHARED = 'portal_shared_code';
const KEY_OTP_BUCKET = 'portal_otp_bucket';

export { COOKIE as PORTAL_COOKIE_NAME };

type OtpRow = {
  studentId: string;
  codeHash: string;
  expiresAt: number;
  createdAt: string;
};

type OtpBucket = Record<string, OtpRow>;

function hashCode(code: string): string {
  return createHash('sha256').update(`portal:${code}`).digest('hex');
}

function readBucket(db: DatabaseSync): OtpBucket {
  const raw = getSetting(db, KEY_OTP_BUCKET);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as OtpBucket;
  } catch {
    return {};
  }
}

function writeBucket(db: DatabaseSync, bucket: OtpBucket) {
  const now = Date.now();
  const cleaned: OtpBucket = {};
  for (const [k, v] of Object.entries(bucket)) {
    if (v.expiresAt > now) cleaned[k] = v;
  }
  upsertSetting(db, KEY_OTP_BUCKET, JSON.stringify(cleaned));
}

export function getPortalSharedCode(db: DatabaseSync): string {
  return String(getSetting(db, KEY_SHARED) ?? '').trim();
}

export function setPortalSharedCode(db: DatabaseSync, code: string) {
  upsertSetting(db, KEY_SHARED, String(code ?? '').trim().slice(0, 32));
}

export type PortalStudentRow = {
  id: string;
  displayName: string;
  classId: string | null;
  studentNo: string;
  contactEmail: string | null;
  contactPhone: string | null;
};

export function findStudentByNo(
  db: DatabaseSync,
  studentNo: string,
  classId?: string | null,
): PortalStudentRow | null {
  const no = String(studentNo ?? '').trim();
  if (!no) return null;
  const cid = String(classId ?? '').trim();
  const row = (
    cid
      ? db
          .prepare(
            `SELECT id, display_name AS displayName, class_id AS classId, student_no AS studentNo,
                    contact_email AS contactEmail, contact_phone AS contactPhone
             FROM users
             WHERE role = 'student' AND student_no = ? AND class_id = ?
               AND (deleted_at IS NULL OR deleted_at = '')
             LIMIT 1`,
          )
          .get(no, cid)
      : db
          .prepare(
            `SELECT id, display_name AS displayName, class_id AS classId, student_no AS studentNo,
                    contact_email AS contactEmail, contact_phone AS contactPhone
             FROM users
             WHERE role = 'student' AND student_no = ?
               AND (deleted_at IS NULL OR deleted_at = '')
             LIMIT 1`,
          )
          .get(no)
  ) as PortalStudentRow | undefined;
  return row ?? null;
}

/** Issue per-student OTP (TTL 10 min). Production never returns debugCode. */
export function issuePortalOtp(
  db: DatabaseSync,
  studentId: string,
): { expiresInSec: number; debugCode?: string; codePlainForNotify: string } {
  const code = String(randomInt(100000, 999999));
  const bucket = readBucket(db);
  bucket[studentId] = {
    studentId,
    codeHash: hashCode(code),
    expiresAt: Date.now() + 10 * 60_000,
    createdAt: nowIso(),
  };
  writeBucket(db, bucket);
  const out: { expiresInSec: number; debugCode?: string; codePlainForNotify: string } = {
    expiresInSec: 600,
    codePlainForNotify: code,
  };
  // E2E only — never in production even if mis-set NODE_ENV.
  if (process.env.CLASSROOM_DESK_E2E === '1' && process.env.NODE_ENV !== 'production') {
    out.debugCode = code;
  }
  return out;
}

export function verifyPortalOtp(db: DatabaseSync, studentId: string, code: string): boolean {
  const shared = getPortalSharedCode(db);
  if (shared && String(code).trim() === shared) return true;
  const bucket = readBucket(db);
  const row = bucket[studentId];
  if (!row || row.expiresAt < Date.now()) return false;
  if (row.codeHash !== hashCode(String(code).trim())) return false;
  delete bucket[studentId];
  writeBucket(db, bucket);
  return true;
}

export type PortalSession = {
  studentId: string;
  classId: string | null;
  displayName: string;
  studentNo: string;
};

export async function signPortalSession(session: PortalSession): Promise<string> {
  return new SignJWT({
    typ: 'portal',
    classId: session.classId,
    displayName: session.displayName,
    studentNo: session.studentNo,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(session.studentId)
    .setIssuedAt()
    .setExpirationTime('12h')
    .sign(encoder.encode(config.jwtSecret));
}

export async function verifyPortalSession(
  token: string,
  db?: DatabaseSync,
): Promise<PortalSession | null> {
  try {
    const { payload } = await jwtVerify(token, encoder.encode(config.jwtSecret));
    if (payload.typ !== 'portal' || !payload.sub) return null;
    const classId = (payload.classId as string | null) ?? null;
    if (db) {
      const { getPortalSessionEpoch } = await import('./portalSessionRevoke.js');
      const epoch = getPortalSessionEpoch(db, classId);
      const iat = Number(payload.iat ?? 0);
      if (epoch > 0 && iat > 0 && iat <= epoch) return null;
    }
    return {
      studentId: payload.sub,
      classId,
      displayName: String(payload.displayName ?? ''),
      studentNo: String(payload.studentNo ?? ''),
    };
  } catch {
    return null;
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of String(header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export function portalSetCookieHeader(token: string): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${12 * 3600}${secure}`;
}

export function portalClearCookieHeader(): string {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export type PortalAdmitDecision = {
  decision: 'allow' | 'block';
  reason: string | null;
  zoneId: string | null;
  zoneLabel: string | null;
  everStudentZone: boolean;
  requirePortal: boolean;
  message: string;
};

/**
 * Zero-install admit: after portal identity, apply zone + never_student_net rules.
 */
export async function admitPortalClient(
  db: DatabaseSync,
  opts: {
    session: PortalSession;
    hint: NetworkHint;
    clientKey?: string;
  },
): Promise<PortalAdmitDecision> {
  const zone = resolveZoneForHint(db, opts.hint);
  const clientId = String(opts.clientKey ?? `portal:${opts.session.studentId}`).trim();

  // On student-allowed zone → stamp ever + allow (deep-lock may still limit later via shield).
  if (zone && zone.allowedRoles.includes('student')) {
    markEverStudentZone(db, opts.session.studentId);
    await enforceStudentZonePolicy(db, {
      studentId: opts.session.studentId,
      classId: opts.session.classId ?? '',
      clientId,
      hint: opts.hint,
    });
    const { grantGatewayAccess } = await import('./gatewayAllowlist.js');
    grantGatewayAccess(db, {
      clientKey: clientId,
      studentId: opts.session.studentId,
      classId: opts.session.classId,
      ip: String(opts.hint.ipv4 ?? '').trim() || undefined,
      ttlSec: 12 * 3600,
    });
    return {
      decision: 'allow',
      reason: null,
      zoneId: zone.id,
      zoneLabel: zone.label,
      everStudentZone: true,
      requirePortal: zone.requirePortal,
      message: '已认证：学生网会话有效',
    };
  }

  const unauthorized = studentUnauthorizedOnZone(zone);
  if (zone && unauthorized) {
    const r = await enforceStudentZonePolicy(db, {
      studentId: opts.session.studentId,
      classId: opts.session.classId ?? '',
      clientId,
      hint: opts.hint,
    });
    const ever = getEverStudentZone(db, opts.session.studentId);
    if (r.unauthorized && (r.action === 'deny' || r.action === 'kick' || r.reason === 'never_student_net')) {
      return {
        decision: 'block',
        reason: r.reason,
        zoneId: zone.id,
        zoneLabel: zone.label,
        everStudentZone: ever,
        requirePortal: true,
        message:
          r.reason === 'never_student_net'
            ? '已拦截：检测到教工/受限网络，且本账号从未在学生网上完成认证。请改连学生网后再试。'
            : '已拦截：学生不可使用此网络配置档。请改连学校指定的学生网。',
      };
    }
  }

  // Unknown / unmatched zone: default hold (avoid silent SSID mix-up). Opt-in soft-allow:
  // CLASSROOM_DESK_PORTAL_UNMAPPED=allow
  const ever = getEverStudentZone(db, opts.session.studentId);
  if (!zone) {
    const soft =
      process.env.CLASSROOM_DESK_PORTAL_UNMAPPED === 'allow' ||
      process.env.CLASSROOM_DESK_PORTAL_UNMAPPED === '1';
    if (!soft) {
      return {
        decision: 'block',
        reason: 'unmapped_zone',
        zoneId: null,
        zoneLabel: null,
        everStudentZone: ever,
        requirePortal: true,
        message:
          '已拦截：当前网未匹配任何网络配置档（SSID/CIDR）。请学校在「网络档」补全后再认证，或设 CLASSROOM_DESK_PORTAL_UNMAPPED=allow 临时软放行。',
      };
    }
    const { grantGatewayAccess } = await import('./gatewayAllowlist.js');
    grantGatewayAccess(db, {
      clientKey: clientId,
      studentId: opts.session.studentId,
      classId: opts.session.classId,
      ip: String(opts.hint.ipv4 ?? '').trim() || undefined,
      ttlSec: 12 * 3600,
    });
    return {
      decision: 'allow',
      reason: 'unmapped_zone',
      zoneId: null,
      zoneLabel: null,
      everStudentZone: ever,
      requirePortal: false,
      message: '已认证（软放行）：当前网未映射 Zone — 请尽快补全 SSID/CIDR。',
    };
  }

  const { grantGatewayAccess } = await import('./gatewayAllowlist.js');
  grantGatewayAccess(db, {
    clientKey: clientId,
    studentId: opts.session.studentId,
    classId: opts.session.classId,
    ip: String(opts.hint.ipv4 ?? '').trim() || undefined,
    ttlSec: 12 * 3600,
  });
  return {
    decision: 'allow',
    reason: null,
    zoneId: zone.id,
    zoneLabel: zone.label,
    everStudentZone: ever,
    requirePortal: zone.requirePortal ?? false,
    message: '已认证',
  };
}

function examBoxHardwareAccepted(): boolean {
  if (
    process.env.CLASSROOM_DESK_EXAM_BOX_HARDWARE === '1' ||
    process.env.CLASSROOM_DESK_EXAM_BOX_HARDWARE === 'true'
  ) {
    return true;
  }
  try {
    const db = openDb();
    const accepted = (getSetting(db, 'exam_box_hardware_accepted') ?? '0') === '1';
    const serial = String(getSetting(db, 'exam_box_serial') ?? '').trim();
    const tag = String(getSetting(db, 'exam_box_image_tag') ?? '').trim();
    return accepted && Boolean(serial) && Boolean(tag);
  } catch {
    return false;
  }
}

/**
 * Product capability flags for UI / open-api.
 * salesPhase stays `pilot` and gaReady stays false until PILOT_SKU.md GA gates are met
 * (live-shield evidence, contract page rename, optional hardware SKU). Do not bump to GA here.
 */
export function productCapabilities() {
  const deskDns = getDeskDnsStatus();
  const shieldId = getShieldConnector().id;
  const shieldProd =
    shieldId === 'http' || shieldId === 'opnsense' || shieldId === 'unifi';
  return {
    /** Contract track: Pilot 可售；不是 1.0 GA（见 docs/PILOT_SKU.md）. */
    salesPhase: 'pilot' as const,
    /** Always false on Pilot track — flip only when GA checklist is done in docs + Release. */
    gaReady: false,
    labAgent: true,
    deepLock: true,
    networkZones: true,
    netPortal: true,
    netDns: true,
    netDnsRunning: deskDns.enabled && deskDns.running,
    /** Feature exists in product; not “currently enforcing”. */
    netShield: true,
    /** True only when a real gateway adapter is active (not off/mock). */
    netShieldEnforcing: shieldProd,
    netShieldAdapters: listShieldAdapterIds(),
    netShieldActive: shieldId,
    examBox: true, // SKU docs + compose shipped; hardware optional
    /**
     * Default false（灰显）. True only after BOM/镜像验收登记
     * （序列号+镜像 tag+勾选，或 CLASSROOM_DESK_EXAM_BOX_HARDWARE=1）. 见 deploy/exam-box/HARDWARE.md.
     */
    examBoxHardware: examBoxHardwareAccepted(),
    enterprise8021x: true,
    deviceFingerprinting: false,
    portalCookieSession: true,
    /**
     * Product never silent-blocks students outside teacher deep-lock / Shield path.
     * Not a claim that the lab is currently sealed.
     */
    neverStudentNetBlock: true,
    portalSignedSsid: true,
    portalSsidRequireSig:
      process.env.CLASSROOM_DESK_PORTAL_SSID_REQUIRE_SIG === '1' ||
      process.env.CLASSROOM_DESK_PORTAL_SSID_REQUIRE_SIG === 'true',
    gatewayAllowlist: true,
    privateDevicePortalOnly: true,
    principalDashboard: true,
  };
}
