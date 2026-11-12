import type { ReactNode } from 'react';
import { t } from '@classroom-desk/i18n';

/** Fold settings by Pilot SKU pack to reduce mis-clicks (lab-agent / portal). */
export function SettingsSkuFold({
  pack,
  title,
  children,
  defaultOpen,
}: {
  pack: 'lab' | 'campus' | 'dns' | 'exam' | 'enterprise';
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details className="settings-sku-fold" data-testid={`settings-sku-${pack}`} open={defaultOpen}>
      <summary>
        {title}
        <span className="hint"> · Pilot SKU</span>
      </summary>
      <p className="hint">
        {pack === 'lab'
          ? t('机房包：labAgent + 深锁。勿与私人设备门户开关混淆。')
          : pack === 'campus'
            ? t('校园网包：门户 / Zones / Shield。需网关凭据。')
            : pack === 'dns'
              ? t('单网校包：DeskDNS。DHCP 指向本机。')
              : pack === 'exam'
                ? t('考场 compose 包：无量产硬件（examBoxHardware=false）。')
                : t('企业包：802.1X 白皮书 + 签名 SSID。')}
      </p>
      {children}
    </details>
  );
}
