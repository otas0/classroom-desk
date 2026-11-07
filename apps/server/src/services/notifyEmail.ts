export type RestoreConfirmDelivery = {
  emailDelivered: boolean;
  mailtoUrl: string | null;
};

/**
 * Deliver a restore confirm code.
 * Webhook (env) wins. Otherwise a one-shot mailto URL when an address is configured.
 * Callers must not echo the code into UI placeholders.
 */
export async function notifyRestoreConfirm(opts: {
  to?: string | null;
  code: string;
  sha256: string;
  fileName: string;
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
    try {
      const res = await fetch(webhook, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(8_000),
      });
      return { emailDelivered: res.ok, mailtoUrl: null };
    } catch {
      return { emailDelivered: false, mailtoUrl: null };
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
