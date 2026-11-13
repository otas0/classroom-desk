import { useEffect, useState, type ReactNode } from 'react';
import { t } from '@classroom-desk/i18n';
import { api } from '../api';

/** Greys out UI when a product capability is not shipped/running. */
export function useProductCapabilities() {
  const [caps, setCaps] = useState<Record<string, unknown>>({});
  useEffect(() => {
    void api<Record<string, unknown>>('/api/v1/product/capabilities')
      .then(setCaps)
      .catch(() => setCaps({}));
  }, []);
  return caps;
}

export function CapabilityGate({
  flag,
  children,
  label,
  offHint,
}: {
  flag: string;
  children: ReactNode;
  label?: string;
  /** Shown instead of greyed children when the flag is off (e.g. Pilot hardware lock). */
  offHint?: ReactNode;
}) {
  const caps = useProductCapabilities();
  const on = caps[flag] === true;
  if (on) return <>{children}</>;
  return (
    <div className="capability-gate-off" data-testid={`gate-off-${flag}`}>
      <p className="hint">
        {label || flag}
        {t(' · 能力未启用（见校长看板 / 环境变量）')}
      </p>
      {offHint != null ? (
        <div data-testid={`gate-off-hint-${flag}`}>{offHint}</div>
      ) : (
        <div style={{ opacity: 0.45, pointerEvents: 'none' }}>{children}</div>
      )}
    </div>
  );
}
