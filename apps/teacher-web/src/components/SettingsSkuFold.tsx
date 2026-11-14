import type { ReactNode } from 'react';
import { t } from '@classroom-desk/i18n';
import { useProductCapabilities } from './CapabilityGates';

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
  const caps = useProductCapabilities();
  const phase = caps.salesPhase === 'pilot' || caps.gaReady !== true ? 'Pilot' : 'GA';
  const examHwOn = caps.examBoxHardware === true;
  return (
    <details className="settings-sku-fold" data-testid={`settings-sku-${pack}`} open={defaultOpen}>
      <summary>
        {title}
        <span className="hint"> · {phase} SKU</span>
      </summary>
      <p className="hint">
        {pack === 'lab'
          ? t('机房包：labAgent + 深锁。勿与私人设备门户开关混淆。')
          : pack === 'campus'
            ? t('校园网包：门户 / Zones；网关三项可选。见 docs/CAMPUS_MINIMAL.md')
            : pack === 'dns'
              ? t('单网校包：DeskDNS。DHCP 指向本机。')
              : pack === 'exam'
                ? examHwOn
                  ? t('考场包：compose + 量产硬件已验收亮起。')
                  : t('考场 compose 包：量产硬件灰显（examBoxHardware=false），须 BOM/镜像验收登记后亮起。')
                : t('企业包：802.1X 白皮书 + 签名 SSID。')}
      </p>
      {phase === 'Pilot' && pack === 'lab' ? (
        <p className="hint" data-testid="settings-sku-pilot-note">
          {t('对外仍是 Pilot（gaReady=false），不是 1.0 GA。见 docs/PILOT_SKU.md。')}
        </p>
      ) : null}
      {children}
    </details>
  );
}
