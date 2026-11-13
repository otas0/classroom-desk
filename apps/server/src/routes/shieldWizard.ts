import { Router } from 'express';
import { requireAuth, requireRoles, type AuthedRequest } from '../middleware/auth.js';

export const shieldWizardRouter = Router();

function adapterEnvReady(adapter: string): { ok: boolean; detail: string } {
  if (adapter === 'opnsense') {
    const ready =
      process.env.OPNSENSE_LIVE === '1' &&
      Boolean(process.env.OPNSENSE_URL && process.env.OPNSENSE_API_KEY);
    return ready
      ? { ok: true, detail: 'opnsense_env_ready' }
      : {
          ok: false,
          detail: 'SKIPPED: set OPNSENSE_LIVE=1 and OPNSENSE_URL/API_KEY/SECRET（学校凭据）',
        };
  }
  if (adapter === 'unifi') {
    const ready =
      process.env.UNIFI_LIVE === '1' && Boolean(process.env.UNIFI_URL && process.env.UNIFI_USER);
    return ready
      ? { ok: true, detail: 'unifi_env_ready' }
      : { ok: false, detail: 'SKIPPED: set UNIFI_LIVE=1 and UNIFI_URL/USER/PASS（学校凭据）' };
  }
  return { ok: false, detail: 'unsupported_adapter' };
}

for (const step of ['ping', 'alias', 'dry-run'] as const) {
  shieldWizardRouter.post(
    `/api/v1/shield/wizard/${step}`,
    requireAuth,
    requireRoles('teacher', 'admin'),
    (req: AuthedRequest, res) => {
      const adapter = String(req.body?.adapter ?? 'opnsense').toLowerCase();
      const ready = adapterEnvReady(adapter);
      if (!ready.ok) {
        res.json({ ok: false, step, adapter, detail: ready.detail });
        return;
      }
      // Live scripts remain CLI (`opnsense-alias-acceptance` / `unifi-auth-acceptance`);
      // wizard only gates env readiness then points to SCHOOL_ACCEPTANCE.md.
      res.json({
        ok: true,
        step,
        adapter,
        detail: `${step}_ready — run npm run test:opnsense-acceptance / unifi + archive:live-shield`,
      });
    },
  );
}
