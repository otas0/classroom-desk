import { writeAudit } from './audit.js';

export type RestoreConfirmDelivery = {
  emailDelivered: boolean;
  mailtoUrl: string | null;
  webhookStatus?: number | null;
  webhookError?: string | null;
};

/**
 * Deliver a restore confirm code.
 * Webhook (env) wins. Otherwise a one-shot mailto URL when an address is configured.
 * Callers must not echo the code into UI placeholders.
 * Non-2xx / timeout writes `notify.restore_confirm_fail` audit (no code in detail).
 */
export async function notifyRestoreConfirm(opts: {
  to?: string | null;
  code: string;
  sha256: string;
  fileName: string;
  /** Override webhook fetch timeout (ms). Default 8000. */
  timeoutMs?: number;
  actorUserId?: string | null;
  actorRole?: string | null;
}): Promise<RestoreConfirmDelivery> {
  const to = String(opts.to ?? '').trim();
  const payload = {
    type: 'restore_confirm' as const,
    to,
    code: opts.code,
    sha256: opts.sha256,
    fileName: opts.fileName,
  };
  const webhook = process.env.CLASSROOM_DESK_EMAIL_WEBHOOK?.trim();
  if (webhook) {
    const timeoutMs = Math.max(50, Math.min(30_000, Number(opts.timeoutMs) || 8_000));
    try {
      const res = await fetch(webhook, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        try {
          writeAudit({
            actorUserId: opts.actorUserId ?? null,
            actorRole: opts.actorRole ?? null,
            action: 'notify.restore_confirm_fail',
            detail: {
              channel: 'webhook',
              status: res.status,
              sha256: opts.sha256,
              fileName: opts.fileName,
              to: to || null,
            },
          });
        } catch {
          /* audit best-effort */
        }
        return {
          emailDelivered: false,
          mailtoUrl: null,
          webhookStatus: res.status,
          webhookError: `http_${res.status}`,
        };
      }
      return { emailDelivered: true, mailtoUrl: null, webhookStatus: res.status };
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      try {
        writeAudit({
          actorUserId: opts.actorUserId ?? null,
          actorRole: opts.actorRole ?? null,
          action: 'notify.restore_confirm_fail',
          detail: {
            channel: 'webhook',
            status: null,
            error: /aborted|timeout|Timeout/i.test(err) ? 'timeout' : 'fetch_failed',
            sha256: opts.sha256,
            fileName: opts.fileName,
            to: to || null,
          },
        });
      } catch {
        /* audit best-effort */
      }
      return {
        emailDelivered: false,
        mailtoUrl: null,
        webhookStatus: null,
        webhookError: /aborted|timeout|Timeout/i.test(err) ? 'timeout' : 'fetch_failed',
      };
    }
  }
  if (!to) return { emailDelivered: false, mailtoUrl: null };
  const subject = encodeURIComponent('Classroom Desk 恢复确认码');
  const body = encodeURIComponent(
    `确认码：${opts.code}\n文件：${opts.fileName}\nsha256：${opts.sha256}\n请在教师后台粘贴确认码后替换 live DB。`,
  );
  return {
    emailDelivered: false,
    mailtoUrl: `mailto:${to}?subject=${subject}&body=${body}`,
  };
}
