import { Router } from 'express';
import { requireAuth, requireRoles, type AuthedRequest } from '../middleware/auth.js';
import { HttpShieldConnector } from '../services/shield/httpConnector.js';
import { OffShieldConnector } from '../services/shield/offConnector.js';
import { OpnsenseShieldConnector } from '../services/shield/opnsenseConnector.js';
import {
  getShieldConnector,
  LAB_SHIELD_DEFAULT_URL,
  reloadShieldConnectorFromEnv,
} from '../services/shield/registry.js';
import { UnifiShieldConnector } from '../services/shield/unifiConnector.js';
import type { ShieldConnector } from '../services/shield/types.js';

export const shieldWizardRouter = Router();

function connectorForProbe(adapter: string, httpUrl?: string): ShieldConnector {
  const kind = String(adapter || '').trim().toLowerCase();
  if (kind === 'opnsense') return new OpnsenseShieldConnector();
  if (kind === 'unifi') return new UnifiShieldConnector();
  if (kind === 'http' || kind === 'lab') {
    const url = String(httpUrl || process.env.CLASSROOM_DESK_SHIELD_URL || LAB_SHIELD_DEFAULT_URL).trim();
    return new HttpShieldConnector(url, process.env.CLASSROOM_DESK_SHIELD_TOKEN ?? '');
  }
  if (kind === 'off' || !kind) return new OffShieldConnector();
  return getShieldConnector();
}

/** Ping active (or requested) Shield adapter health — lab or school controller. */
shieldWizardRouter.post(
  '/api/v1/shield/wizard/ping',
  requireAuth,
  requireRoles('teacher', 'admin'),
  async (req: AuthedRequest, res) => {
    const adapter = String(req.body?.adapter ?? '').trim().toLowerCase();
    const httpUrl = String(req.body?.httpUrl ?? '').trim();
    const useActive = !adapter || adapter === 'active';
    if (!useActive && (adapter === 'http' || adapter === 'lab' || adapter === 'opnsense' || adapter === 'unifi' || adapter === 'off')) {
      const c = connectorForProbe(adapter, httpUrl || undefined);
      const health = c.health ? await c.health() : { ok: false, detail: 'no_health' };
      res.json({
        ok: health.ok,
        step: 'ping',
        adapter: c.id,
        displayName: c.displayName,
        detail: health.detail,
        hint:
          c.id === 'off'
            ? 'shield_not_configured — 深锁不会断网；选 http/opnsense/unifi 并保存后再测'
            : health.ok
              ? undefined
              : '连通失败：检查 lab 进程或学校凭据（npm run lab:shield|lab:opnsense|lab:unifi）',
      });
      return;
    }
    reloadShieldConnectorFromEnv();
    const c = getShieldConnector();
    const health = c.health ? await c.health() : { ok: false, detail: 'no_health' };
    res.json({
      ok: health.ok,
      step: 'ping',
      adapter: c.id,
      displayName: c.displayName,
      detail: health.detail,
      hint:
        c.id === 'off'
          ? 'shield_not_configured — 深锁不会断网；选 http/opnsense/unifi 并保存后再测'
          : undefined,
    });
  },
);

for (const step of ['alias', 'dry-run'] as const) {
  shieldWizardRouter.post(
    `/api/v1/shield/wizard/${step}`,
    requireAuth,
    requireRoles('teacher', 'admin'),
    (req: AuthedRequest, res) => {
      const adapter = String(req.body?.adapter ?? 'opnsense').toLowerCase();
      const live =
        adapter === 'opnsense'
          ? process.env.OPNSENSE_LIVE === '1' &&
            Boolean(process.env.OPNSENSE_URL && process.env.OPNSENSE_API_KEY)
          : adapter === 'unifi'
            ? process.env.UNIFI_LIVE === '1' &&
              Boolean(process.env.UNIFI_URL && process.env.UNIFI_USER)
            : false;
      if (!live) {
        res.json({
          ok: false,
          step,
          adapter,
          detail:
            adapter === 'unifi'
              ? 'SKIPPED: set UNIFI_LIVE=1 and UNIFI_URL/USER/PASS（学校凭据）'
              : 'SKIPPED: set OPNSENSE_LIVE=1 and OPNSENSE_URL/API_KEY/SECRET（学校凭据）',
        });
        return;
      }
      res.json({
        ok: true,
        step,
        adapter,
        detail: `${step}_ready — run npm run test:opnsense-acceptance / test:unifi-acceptance + archive:live-shield`,
      });
    },
  );
}
