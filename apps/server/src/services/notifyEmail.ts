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

/** Portal OTP delivery — webhook first, else mailto. Never required to echo code in UI. */
export async function notifyPortalOtp(opts: {
  to?: string | null;
  code: string;
  studentNo: string;
  displayName?: string;
}): Promise<RestoreConfirmDelivery> {
  const to = String(opts.to ?? process.env.CLASSROOM_DESK_PORTAL_OTP_TO ?? '').trim();
  const webhook = process.env.CLASSROOM_DESK_EMAIL_WEBHOOK?.trim();
  const payload = {
    type: 'portal_otp' as const,
    to,
    code: opts.code,
    studentNo: opts.studentNo,
    displayName: opts.displayName ?? '',
  };
  if (webhook) {
    try {
      const res = await fetch(webhook, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(8_000),
      });
      return {
        emailDelivered: res.ok,
        mailtoUrl: null,
        webhookStatus: res.status,
        webhookError: res.ok ? null : `http_${res.status}`,
      };
    } catch (e) {
      return {
        emailDelivered: false,
        mailtoUrl: null,
        webhookError: e instanceof Error ? e.message : 'fetch_failed',
      };
    }
  }
  if (!to) return { emailDelivered: false, mailtoUrl: null };
  const subject = encodeURIComponent('校园网认证验证码');
  const body = encodeURIComponent(
    `学号 ${opts.studentNo} 的验证码：${opts.code}\n10 分钟内有效。`,
  );
  return { emailDelivered: false, mailtoUrl: `mailto:${to}?subject=${subject}&body=${body}` };
}

/** Optional SMS webhook (same envelope, channel=sms). */
export async function notifyPortalOtpSms(opts: {
  phone?: string | null;
  code: string;
  studentNo: string;
}): Promise<{ delivered: boolean; detail?: string }> {
  const webhook = process.env.CLASSROOM_DESK_SMS_WEBHOOK?.trim();
  const phone = String(opts.phone ?? '').trim();
  if (!webhook || !phone) return { delivered: false, detail: 'sms_unconfigured' };
  try {
    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'portal_otp_sms',
        phone,
        code: opts.code,
        studentNo: opts.studentNo,
      }),
      signal: AbortSignal.timeout(8_000),
    });
    return { delivered: res.ok, detail: `http_${res.status}` };
  } catch (e) {
    return { delivered: false, detail: e instanceof Error ? e.message : 'fetch_failed' };
  }
}
