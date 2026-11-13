import { useState } from 'react';
import { t } from '@classroom-desk/i18n';
import { api } from '../api';

/** OPNsense / UniFi first-run: connect → alias → dry-run → acceptance note. */
export function ShieldSetupWizard() {
  const [step, setStep] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  const [adapter, setAdapter] = useState<'opnsense' | 'unifi'>('opnsense');

  async function runStep() {
    const next = [...log];
    try {
      if (step === 0) {
        const r = await api<{ ok?: boolean; detail?: string }>('/api/v1/shield/wizard/ping', {
          method: 'POST',
          body: JSON.stringify({ adapter }),
        });
        next.push(`连通：${r.ok ? 'OK' : r.detail || 'fail'}`);
      } else if (step === 1) {
        const r = await api<{ ok?: boolean; detail?: string }>('/api/v1/shield/wizard/alias', {
          method: 'POST',
          body: JSON.stringify({ adapter }),
        });
        next.push(`写 alias：${r.ok ? 'OK' : r.detail || 'fail'}`);
      } else if (step === 2) {
        const r = await api<{ ok?: boolean; detail?: string }>('/api/v1/shield/wizard/dry-run', {
          method: 'POST',
          body: JSON.stringify({ adapter }),
        });
        next.push(`干跑：${r.ok ? 'OK' : r.detail || 'fail'}`);
      } else {
        next.push(t('请打印/导出 docs/SCHOOL_ACCEPTANCE.md 勾选网关项（脱敏证据）。'));
      }
      setLog(next);
      setStep((s) => Math.min(3, s + 1));
    } catch (e) {
      next.push(e instanceof Error ? e.message : t('失败'));
      setLog(next);
    }
  }

  return (
    <section data-testid="shield-setup-wizard">
      <h3>{t('Shield 首次配置向导')}</h3>
      <label>
        {t('适配器')}
        <select value={adapter} onChange={(e) => setAdapter(e.target.value as 'opnsense' | 'unifi')}>
          <option value="opnsense">OPNsense</option>
          <option value="unifi">UniFi</option>
        </select>
      </label>
      <ol>
        <li className={step === 0 ? 'hint' : undefined}>{t('测连通')}</li>
        <li className={step === 1 ? 'hint' : undefined}>{t('写 alias')}</li>
        <li className={step === 2 ? 'hint' : undefined}>{t('干跑测试 MAC/IP')}</li>
        <li className={step === 3 ? 'hint' : undefined}>{t('验收页 / PDF')}</li>
      </ol>
      <button type="button" onClick={() => void runStep()}>
        {step >= 3 ? t('完成') : t('下一步')}
      </button>
      <pre className="hint" style={{ whiteSpace: 'pre-wrap' }}>
        {log.join('\n')}
      </pre>
    </section>
  );
}
