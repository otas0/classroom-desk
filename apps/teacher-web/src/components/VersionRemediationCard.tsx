import { useEffect, useState } from 'react';
import { t } from '@classroom-desk/i18n';
import { api } from '../api';

type Upgrades = {
  expectedVersion?: string;
  preferredLanUrl?: string | null;
  preferredLanSha256Url?: string | null;
  preferredLanName?: string | null;
  tipTemplate?: string;
  files?: Array<{ name: string; size: number }>;
};

/** Copyable classroom remediation card when force same-version seats still lag. */
export function VersionRemediationCard({
  classId,
  expectedVersion,
  behindCount,
}: {
  classId: string;
  expectedVersion: string;
  behindCount: number;
}) {
  const [text, setText] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    void (async () => {
      const u = await api<Upgrades>('/api/v1/upgrades').catch(() => ({} as Upgrades));
      let sha = '';
      if (u.preferredLanSha256Url) {
        try {
          sha = (await fetch(u.preferredLanSha256Url).then((r) => r.text())).trim().split(/\s+/)[0] ?? '';
        } catch {
          sha = '';
        }
      }
      const size = u.files?.find((f) => f.name === u.preferredLanName)?.size ?? 0;
      const etaMin = size > 0 ? Math.max(3, Math.ceil(size / (8 * 1024 * 1024)) + 2) : 5;
      const usbPath = `releases/<教师机LAN>/ClassroomDesk-Setup-${u.expectedVersion || expectedVersion}.exe`;
      const lines = [
        `【Classroom Desk 本班处置卡】classId=${classId}`,
        `强制同版未完成：仍有 ${behindCount} 台落后（期望 v${u.expectedVersion || expectedVersion}）`,
        `LAN：${u.preferredLanUrl || '（请教师上传 Setup）'}`,
        `USB 路径约定：${usbPath}`,
        `SHA256：${sha || '（上传 Setup 后自动生成 .sha256）'}`,
        `预计耗时：约 ${etaMin} 分钟/机（含下载与重装）`,
        u.tipTemplate ? `提示：${u.tipTemplate}` : '',
      ].filter(Boolean);
      setText(lines.join('\n'));
    })();
  }, [classId, expectedVersion, behindCount]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setMsg(t('已复制处置卡'));
    } catch {
      window.prompt(t('复制处置卡'), text);
      setMsg('');
    }
  }

  return (
    <div className="remediation-card" data-testid="version-remediation-card">
      <h3>{t('同版失败 · 教室处置卡')}</h3>
      <pre className="hint" style={{ whiteSpace: 'pre-wrap' }}>
        {text || t('加载中…')}
      </pre>
      <button type="button" className="secondary" onClick={() => void copy()} disabled={!text}>
        {t('复制处置卡')}
      </button>
      {msg ? <p className="hint">{msg}</p> : null}
    </div>
  );
}
