import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { API_BASE, api } from '../api';
import type { ClassItem } from '../types';
import { t } from '@classroom-desk/i18n';

export function ClassroomConnect({
  classId,
  classes,
  onApiBaseSaved,
}: {
  classId: string;
  classes: ClassItem[];
  onApiBaseSaved?: () => void;
}) {
  const [apiBase, setApiBase] = useState('');
  const [lanIps, setLanIps] = useState<string[]>([]);
  const [healthHint, setHealthHint] = useState('');
  const [copyMsg, setCopyMsg] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const klass = classes.find((c) => c.id === classId);

  useEffect(() => {
    void (async () => {
      const [settings, health] = await Promise.all([
        api<{ classroomApiBase?: string }>('/api/v1/settings'),
        fetch(`${API_BASE}/health`, { cache: 'no-store' }).then((r) => r.json()) as Promise<{
          lanIps?: string[];
          suggestedApiBase?: string;
          studentHealthUrl?: string;
        }>,
      ]);
      const stored = String(settings.classroomApiBase ?? '')
        .trim()
        .replace(/\/$/, '');
      const lanSuggested = String(health.suggestedApiBase ?? '')
        .trim()
        .replace(/\/$/, '');
      const storedIsLoopback = !stored || /127\.0\.0\.1|localhost/i.test(stored);
      const lanOk = Boolean(lanSuggested) && !/127\.0\.0\.1|localhost/i.test(lanSuggested);
      // Default-write LAN apiBase when unset or still loopback (students cannot use 127.0.0.1).
      let next = stored;
      if (storedIsLoopback && lanOk) {
        next = lanSuggested;
        await api('/api/v1/settings', {
          method: 'PATCH',
          body: JSON.stringify({ classroomApiBase: next }),
        });
        onApiBaseSaved?.();
      } else if (!next) {
        next =
          lanSuggested ||
          (typeof window !== 'undefined' ? window.location.origin.replace(/\/$/, '') : '');
      }
      setApiBase(next);
      setLanIps(health.lanIps ?? []);
      setHealthHint(health.studentHealthUrl ?? `${next}/health`);
    })().catch(() => {
      if (typeof window !== 'undefined') setApiBase(window.location.origin);
    });
  }, [onApiBaseSaved]);

  async function saveApiBase() {
    const base = apiBase.replace(/\/$/, '');
    if (/127\.0\.0\.1|localhost/i.test(base)) {
      window.alert(t('禁止使用 127.0.0.1 / localhost，请填教师机局域网 IP'));
      return;
    }
    await api('/api/v1/settings', {
      method: 'PATCH',
      body: JSON.stringify({ classroomApiBase: base }),
    });
    setHealthHint(`${base}/health`);
    onApiBaseSaved?.();
  }

  function configObject() {
    const base = apiBase.replace(/\/$/, '');
    return {
      apiBase: base,
      classId,
      comment: `本教室 ${klass?.name ?? classId}。学生机专用，禁止 127.0.0.1。`,
    };
  }

  function downloadConfig() {
    const base = apiBase.replace(/\/$/, '');
    if (/127\.0\.0\.1|localhost/i.test(base)) {
      window.alert('禁止使用 127.0.0.1 / localhost，请填教师机局域网 IP');
      return;
    }
    const cfg = configObject();
    const blob = new Blob([JSON.stringify(cfg, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `classroom-${klass?.name ?? 'class'}-config.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function copyText(label: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopyMsg(`已复制${label}`);
      window.setTimeout(() => setCopyMsg(''), 2500);
    } catch {
      window.prompt(`复制${label}：`, text);
    }
  }

  useEffect(() => {
    const base = apiBase.replace(/\/$/, '');
    if (!base || !classId) {
      setQrDataUrl('');
      return;
    }
    const payload = JSON.stringify({ apiBase: base, classId });
    void QRCode.toDataURL(payload, { width: 220, margin: 1 })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(''));
  }, [apiBase, classId]);

  return (
    <section>
      <h2>{t('上课前指派学生机')}</h2>
      {copyMsg ? <p className="toast-inline">{copyMsg}</p> : null}
      <div className="help-bubble">
        每台学生机必须配置<strong>{t('本教师机局域网地址')}</strong>{t('与本班')} <code>classId</code>。禁止 127.0.0.1。
        学生浏览器先打开下方 /health；通过后再装客户端或写入 config。
      </div>
      <p>
        当前班级：<strong>{klass?.name ?? '—'}</strong>
      </p>
      <p>
        classId：<code>{classId || t('（请先选班）')}</code>{' '}
        <button
          type="button"
          className="secondary"
          disabled={!classId}
          onClick={() => void copyText('classId', classId)}
        >
          复制 classId
        </button>
      </p>
      <p>
        apiBase：<code>{apiBase || '—'}</code>{' '}
        <button
          type="button"
          className="secondary"
          disabled={!apiBase}
          onClick={() => void copyText('apiBase', apiBase.replace(/\/$/, ''))}
        >
          复制 apiBase
        </button>
      </p>
      {lanIps.length ? (
        <p className="hint">
          本机检测到局域网 IP：{lanIps.map((ip) => (
            <button
              key={ip}
              type="button"
              className="linkish"
              onClick={() => setApiBase(`http://${ip}:8787`)}
            >
              {ip}
            </button>
          ))}
          （点击填入）
        </p>
      ) : null}
      <label>
        教师机 apiBase（学生机用）
        <input value={apiBase} onChange={(e) => setApiBase(e.target.value)} placeholder="http://192.168.x.x:8787" />
      </label>
      <button type="button" onClick={() => void saveApiBase().catch((e) => window.alert(String(e)))}>
        保存为教室地址
      </button>{' '}
      <button type="button" disabled={!classId || !apiBase} onClick={downloadConfig}>
        下载本教室 config.json
      </button>{' '}
      <button
        type="button"
        className="secondary"
        disabled={!classId || !apiBase}
        onClick={() => void copyText('config.json', JSON.stringify(configObject(), null, 2))}
      >
        复制 config.json
      </button>
      {qrDataUrl ? (
        <div className="qr-block">
          <p className="hint">{t('手机扫码查看 apiBase + classId（离线本地生成）')}</p>
          <img src={qrDataUrl} alt={t('学生机配置二维码')} width={220} height={220} />
        </div>
      ) : null}
      <p className="hint">
        学生浏览器强制检测：{' '}
        <a href={healthHint} target="_blank" rel="noreferrer">
          {healthHint || '—'}
        </a>
      </p>
      <p className="hint">
        打本教室安装包：
        <code>
          node scripts/pack-classroom-config.mjs --apiBase {apiBase || t('http://教师IP:8787')} --classId{' '}
          {classId || '<id>'}
        </code>
      </p>
      <pre className="code-block">{`{\n  "apiBase": "${apiBase.replace(/\/$/, '')}",\n  "classId": "${classId}"\n}`}</pre>
    </section>
  );
}
