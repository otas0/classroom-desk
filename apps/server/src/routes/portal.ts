import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import { openDb } from '../db/client.js';
import { requireAuth, requireRoles, type AuthedRequest } from '../middleware/auth.js';
import { MANAGER_ROLES, STAFF_ROLES } from '../middleware/roles.js';
import {
  admitPortalClient,
  findStudentByNo,
  getPortalSharedCode,
  issuePortalOtp,
  parseCookies,
  portalClearCookieHeader,
  portalSetCookieHeader,
  PORTAL_COOKIE_NAME,
  productCapabilities,
  setPortalSharedCode,
  signPortalSession,
  verifyPortalOtp,
  verifyPortalSession,
} from '../services/portalAuth.js';
import { writeAudit } from '../services/audit.js';
import { notifyPortalOtp, notifyPortalOtpSms } from '../services/notifyEmail.js';
import {
  verifyPortalSsid,
  portalSsidQuery,
  portalSsidRequireSig,
  KEY_PORTAL_SSID_REQUIRE_SIG,
} from '../services/portalSsidSign.js';
import {
  isGatewayAllowed,
  listGatewayAccess,
  walledGardenHint,
} from '../services/gatewayAllowlist.js';
import { getGatewayPolicySnapshot } from '../services/gatewayPolicy.js';
import { listShieldAdapterIds, getShieldConnector } from '../services/shield/registry.js';
import { getSetting } from '../db/migrate.js';
import { upsertSetting } from '../services/exitLock.js';

export const portalRouter = Router();

const portalDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../public/portal');
const portalI18nCandidates = [
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../packages/i18n/locales/portal'),
  path.join(portalDir, 'i18n'),
];

function loadPortalI18n(locale: string): Record<string, string> | null {
  const safe = String(locale || 'zh-CN').replace(/[^a-zA-Z0-9_-]/g, '');
  for (const dir of portalI18nCandidates) {
    const file = path.join(dir, `${safe}.json`);
    if (!fs.existsSync(file)) continue;
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, string>;
    } catch {
      /* try next */
    }
  }
  return null;
}

portalRouter.get('/api/v1/product/capabilities', (_req, res) => {
  res.json({
    ...productCapabilities(),
    netShieldAdapters: listShieldAdapterIds(),
    netShieldActive: getShieldConnector().id,
  });
});

/** Portal copy synced with packages/i18n/locales/portal/*.json */
portalRouter.get('/api/v1/portal/i18n/:locale', (req, res) => {
  const locale = String(req.params.locale ?? 'zh-CN');
  const catalog = loadPortalI18n(locale) ?? loadPortalI18n('zh-CN');
  if (!catalog) {
    res.status(404).json({ error: 'portal_i18n_missing' });
    return;
  }
  const db = openDb();
  res.setHeader('Cache-Control', 'public, max-age=60');
  res.json({ locale, messages: catalog, requireSsidSig: portalSsidRequireSig(db) });
});

/** Hosted class QR (PNG) — no third-party CDN; works on locked exam nets. */
portalRouter.get('/api/v1/portal/class-qr', async (req, res) => {
  const classId = String(req.query.classId ?? '').trim();
  if (!classId) {
    res.status(400).type('text/plain').send('classId required');
    return;
  }
  const target = `${req.protocol}://${req.get('host') || 'localhost'}/portal?classId=${encodeURIComponent(classId)}`;
  try {
    const QRCode = (await import('qrcode')).default;
    const png = await QRCode.toBuffer(target, { type: 'png', width: 148, margin: 1 });
    res.setHeader('Cache-Control', 'no-store');
    res.type('image/png').send(png);
  } catch (e) {
    res.status(500).type('text/plain').send(e instanceof Error ? e.message : 'qr_failed');
  }
});

portalRouter.get('/api/v1/portal/bootstrap', async (req, res) => {
  const db = openDb();
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[PORTAL_COOKIE_NAME] ?? '';
  const session = token ? await verifyPortalSession(token, db) : null;
  const requireSsidSig = portalSsidRequireSig(db);
  const ssidCheck = verifyPortalSsid({
    ssid: String(req.query.ssid ?? ''),
    ts: String(req.query.ssid_ts ?? ''),
    sig: String(req.query.ssid_sig ?? ''),
    requireSig: requireSsidSig,
  });
  const ipv4 = String(req.query.ipv4 ?? '').trim();
  res.json({
    ok: true,
    authenticated: Boolean(session),
    session: session
      ? {
          displayName: session.displayName,
          studentNo: session.studentNo,
          classId: session.classId,
        }
      : null,
    hint: { ssid: ssidCheck.ok ? ssidCheck.ssid : '', ipv4 },
    ssidTrust: ssidCheck.ok ? ssidCheck.reason ?? 'ok' : ssidCheck.reason,
    requireSsidSig,
    capabilities: productCapabilities(),
  });
});

portalRouter.post('/api/v1/portal/challenge', async (req, res) => {
  const db = openDb();
  const studentNo = String(req.body?.studentNo ?? '').trim();
  const classId = String(req.body?.classId ?? '').trim();
  const student = findStudentByNo(db, studentNo, classId || null);
  if (!student) {
    res.status(404).json({ error: 'student_not_found', message: '未找到该学号' });
    return;
  }
  const issued = issuePortalOtp(db, student.id);
  // Prefer roster-bound contact; body override only for lab/E2E when roster empty.
  const emailTo =
    String(student.contactEmail ?? '').trim() || String(req.body?.email ?? '').trim();
  const phone =
    String(student.contactPhone ?? '').trim() || String(req.body?.phone ?? '').trim();
  const mail = await notifyPortalOtp({
    to: emailTo || null,
    code: issued.codePlainForNotify,
    studentNo,
    displayName: student.displayName,
  });
  const sms = await notifyPortalOtpSms({
    phone: phone || null,
    code: issued.codePlainForNotify,
    studentNo,
  });
  res.json({
    ok: true,
    studentId: student.id,
    displayName: student.displayName,
    expiresInSec: issued.expiresInSec,
    emailDelivered: mail.emailDelivered,
    mailtoUrl: mail.mailtoUrl,
    smsDelivered: sms.delivered,
    contactEmailBound: Boolean(String(student.contactEmail ?? '').trim()),
    contactPhoneBound: Boolean(String(student.contactPhone ?? '').trim()),
    ...(issued.debugCode ? { debugCode: issued.debugCode } : {}),
    hint: '生产环境请查邮件/短信；也可使用教师门户共用码',
  });
});

portalRouter.post('/api/v1/portal/verify', async (req, res) => {
  const db = openDb();
  const studentNo = String(req.body?.studentNo ?? '').trim();
  const classId = String(req.body?.classId ?? '').trim();
  const code = String(req.body?.code ?? req.body?.otp ?? '').trim();
  const student = findStudentByNo(db, studentNo, classId || null);
  if (!student) {
    res.status(404).json({ error: 'student_not_found', message: '未找到该学号' });
    return;
  }
  if (!verifyPortalOtp(db, student.id, code)) {
    res.status(401).json({ error: 'invalid_code', message: '验证码或共用码错误' });
    return;
  }
  const token = await signPortalSession({
    studentId: student.id,
    classId: student.classId,
    displayName: student.displayName,
    studentNo: String(student.studentNo ?? studentNo),
  });
  writeAudit(
    {
      action: 'portal.verify',
      actorUserId: student.id,
      actorRole: 'student',
      classId: student.classId,
      detail: 'portal_session_issued',
      clientIp: req.ip,
    },
    db,
  );
  res.setHeader('Set-Cookie', portalSetCookieHeader(token));
  res.json({
    ok: true,
    session: {
      displayName: student.displayName,
      studentNo: student.studentNo,
      classId: student.classId,
    },
  });
});

portalRouter.post('/api/v1/portal/admit', async (req, res) => {
  const db = openDb();
  const cookies = parseCookies(req.headers.cookie);
  const token =
    cookies[PORTAL_COOKIE_NAME] ??
    String(req.body?.portalToken ?? req.headers['x-portal-token'] ?? '').trim();
  const session = token ? await verifyPortalSession(token, db) : null;
  if (!session) {
    res.status(401).json({ error: 'portal_auth_required', message: '请先完成门户认证' });
    return;
  }
  const ssidRaw = String(req.body?.ssid ?? req.body?.hint?.ssid ?? '').trim();
  const requireSsidSig = portalSsidRequireSig(db);
  const ssidCheck = verifyPortalSsid({
    ssid: ssidRaw,
    ts: String(req.body?.ssid_ts ?? req.query.ssid_ts ?? ''),
    sig: String(req.body?.ssid_sig ?? req.query.ssid_sig ?? ''),
    requireSig: requireSsidSig,
  });
  if (!ssidCheck.ok && (ssidRaw || ssidCheck.reason === 'ssid_unsigned_rejected')) {
    res.status(400).json({
      error: 'ssid_untrusted',
      reason: ssidCheck.reason,
      message:
        ssidCheck.reason === 'ssid_unsigned_rejected'
          ? '已启用强制签名：请从网关 Captive Portal 跳转进入（需 ssid_ts/ssid_sig）'
          : 'SSID 签名无效，请从网关跳转进入',
    });
    return;
  }
  const hint = {
    ssid: ssidCheck.ssid || String(req.body?.ssid ?? req.body?.hint?.ssid ?? '').trim(),
    ipv4: String(req.body?.ipv4 ?? req.body?.hint?.ipv4 ?? req.ip ?? '')
      .trim()
      .replace(/^::ffff:/, ''),
    gateway: String(req.body?.gateway ?? req.body?.hint?.gateway ?? '').trim(),
  };
  const clientKey =
    String(req.body?.clientKey ?? '').trim() || hint.ipv4 || `portal:${session.studentId}`;
  const decision = await admitPortalClient(db, { session, hint, clientKey });
  writeAudit(
    {
      action: `portal.admit.${decision.decision}`,
      actorUserId: session.studentId,
      actorRole: 'student',
      classId: session.classId,
      detail: `${decision.reason ?? 'ok'} · ${hint.ssid || hint.ipv4 || 'no_hint'}`,
      clientIp: req.ip,
    },
    db,
  );
  res.status(decision.decision === 'block' ? 403 : 200).json({ ok: decision.decision === 'allow', ...decision });
});

portalRouter.post('/api/v1/portal/logout', (_req, res) => {
  res.setHeader('Set-Cookie', portalClearCookieHeader());
  res.json({ ok: true });
});

portalRouter.get(
  '/api/v1/portal/settings',
  requireAuth,
  requireRoles(...STAFF_ROLES),
  (_req, res) => {
    const db = openDb();
    const code = getPortalSharedCode(db);
    res.json({
      portalSharedCodeSet: Boolean(code),
      portalSharedCodePreview: code ? `${code.slice(0, 2)}***` : '',
      portalSsidRequireSig: portalSsidRequireSig(db),
      portalSsidRequireSigEnvForced:
        process.env.CLASSROOM_DESK_PORTAL_SSID_REQUIRE_SIG === '1' ||
        process.env.CLASSROOM_DESK_PORTAL_SSID_REQUIRE_SIG === 'true',
      capabilities: productCapabilities(),
    });
  },
);

portalRouter.put(
  '/api/v1/portal/settings',
  requireAuth,
  requireRoles(...MANAGER_ROLES),
  (req: AuthedRequest, res) => {
    const db = openDb();
    if (req.body?.portalSharedCode != null) {
      setPortalSharedCode(db, String(req.body.portalSharedCode));
    }
    if (req.body?.portalSsidRequireSig != null) {
      const on =
        req.body.portalSsidRequireSig === true ||
        req.body.portalSsidRequireSig === 1 ||
        req.body.portalSsidRequireSig === '1';
      upsertSetting(db, KEY_PORTAL_SSID_REQUIRE_SIG, on ? '1' : '0');
    }
    writeAudit(
      {
        action: 'portal.settings',
        actorUserId: req.user?.id,
        actorRole: req.user?.role,
        classId: null,
        detail: 'portal_settings_updated',
        clientIp: req.ip,
      },
      db,
    );
    res.json({
      ok: true,
      portalSharedCodeSet: Boolean(getPortalSharedCode(db)),
      portalSsidRequireSig: portalSsidRequireSig(db),
    });
  },
);

/** Captive portal landing (zero-install). */
portalRouter.get(['/portal', '/portal/', '/portal/index.html'], (_req, res) => {
  const index = path.join(portalDir, 'index.html');
  if (!fs.existsSync(index)) {
    res.status(500).type('html').send('<h1>portal missing</h1>');
    return;
  }
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(index);
});

/** Gateway: list IPs allowed after admit (for OPNsense/openNDS sync). */
portalRouter.get(
  '/api/v1/gateway/allowlist',
  requireAuth,
  requireRoles(...STAFF_ROLES),
  (_req, res) => {
    const db = openDb();
    const base = String(process.env.CLASSROOM_DESK_PUBLIC_BASE ?? '').trim() || 'http://teacher-host:8787';
    res.json({
      items: listGatewayAccess(db),
      walledGardenHint: walledGardenHint(base),
      signExample: portalSsidQuery('Student-WiFi'),
    });
  },
);

/**
 * Public policy (no JWT) — openNDS / Exam Box poll this like DeskDNS.
 * Prefer over /gateway/allowlist for sidecars.
 */
portalRouter.get('/api/v1/gateway/policy', (_req, res) => {
  res.json(getGatewayPolicySnapshot(openDb()));
});

portalRouter.get('/api/v1/gateway/check', (req, res) => {
  const db = openDb();
  const ip = String(req.query.ip ?? req.ip ?? '')
    .trim()
    .replace(/^::ffff:/, '');
  const clientKey = String(req.query.clientKey ?? '').trim();
  res.json({
    allowed: isGatewayAllowed(db, { ip, clientKey }),
    ip,
  });
});

/** Staff: mint signed SSID redirect for captive portal. */
portalRouter.post(
  '/api/v1/gateway/sign-ssid',
  requireAuth,
  requireRoles(...MANAGER_ROLES),
  (req, res) => {
    const ssid = String(req.body?.ssid ?? '').trim();
    if (!ssid) {
      res.status(400).json({ error: 'ssid_required' });
      return;
    }
    res.json({ ok: true, query: portalSsidQuery(ssid), path: `/portal?${portalSsidQuery(ssid)}` });
  },
);

/**
 * Self-check: force-SSID setting + sign/verify round-trip.
 * Used by teacher HealthNetCard / setup wizard.
 */
portalRouter.get(
  '/api/v1/gateway/sign-ssid/health',
  requireAuth,
  requireRoles(...STAFF_ROLES),
  (_req, res) => {
    const db = openDb();
    const requireSig = portalSsidRequireSig(db);
    const sampleSsid = 'HealthCheck-SSID';
    const query = portalSsidQuery(sampleSsid);
    const params = new URLSearchParams(query);
    const check = verifyPortalSsid({
      ssid: String(params.get('ssid') ?? ''),
      ts: String(params.get('ssid_ts') ?? ''),
      sig: String(params.get('ssid_sig') ?? ''),
      requireSig: true,
    });
    const unsigned = verifyPortalSsid({
      ssid: sampleSsid,
      requireSig,
    });
    res.json({
      ok: check.ok,
      requireSsidSig: requireSig,
      signRoundTrip: check.ok,
      unsignedRejectedWhenRequired: requireSig ? !unsigned.ok : null,
      samplePath: `/portal?${query}`,
      detail: check.ok ? 'sign_verify_ok' : check.reason,
    });
  },
);

/** Canonical walled-garden JSON template (compare with live OPNsense rules). */
portalRouter.get(
  '/api/v1/gateway/walled-garden-template',
  requireAuth,
  requireRoles(...STAFF_ROLES),
  (_req, res) => {
    const candidates = [
      path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        '../../../../deploy/opnsense/walled-garden.template.json',
      ),
      path.resolve(process.cwd(), 'deploy/opnsense/walled-garden.template.json'),
    ];
    for (const file of candidates) {
      if (!fs.existsSync(file)) continue;
      try {
        const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
        res.json({
          ok: true,
          source: file,
          template: raw,
          hint: walledGardenHint(
            String(process.env.CLASSROOM_DESK_PUBLIC_BASE ?? '').trim() || 'http://teacher-host:8787',
          ),
        });
        return;
      } catch {
        /* try next */
      }
    }
    res.status(404).json({ error: 'walled_garden_template_missing' });
  },
);

portalRouter.get(
  '/api/v1/settings/private-device-mode',
  requireAuth,
  requireRoles(...STAFF_ROLES),
  (_req, res) => {
    const db = openDb();
    res.json({
      privateDevicePortalOnly: getSetting(db, 'private_device_portal_only') === '1',
    });
  },
);

portalRouter.put(
  '/api/v1/settings/private-device-mode',
  requireAuth,
  requireRoles(...MANAGER_ROLES),
  (req: AuthedRequest, res) => {
    const db = openDb();
    const on = req.body?.privateDevicePortalOnly === true || req.body?.privateDevicePortalOnly === 1;
    upsertSetting(db, 'private_device_portal_only', on ? '1' : '0');
    writeAudit(
      {
        action: 'settings.private_device_mode',
        actorUserId: req.user?.id,
        actorRole: req.user?.role,
        classId: null,
        detail: on ? 'private_device_portal_only=1' : 'private_device_portal_only=0',
        clientIp: req.ip,
      },
      db,
    );
    res.json({ ok: true, privateDevicePortalOnly: on });
  },
);

/** One-shot campus BYOD preset: private-device portal + forced SSID signature. */
portalRouter.put(
  '/api/v1/settings/campus-preset',
  requireAuth,
  requireRoles(...MANAGER_ROLES),
  (req: AuthedRequest, res) => {
    const db = openDb();
    upsertSetting(db, 'private_device_portal_only', '1');
    upsertSetting(db, KEY_PORTAL_SSID_REQUIRE_SIG, '1');
    writeAudit(
      {
        action: 'settings.campus_preset',
        actorUserId: req.user?.id,
        actorRole: req.user?.role,
        classId: null,
        detail: 'private_device_portal_only=1;portal_ssid_require_sig=1',
        clientIp: req.ip,
      },
      db,
    );
    res.json({
      ok: true,
      privateDevicePortalOnly: true,
      portalSsidRequireSig: portalSsidRequireSig(db),
    });
  },
);
