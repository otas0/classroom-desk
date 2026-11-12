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
  const [easyJoin, setEasyJoin] = useState(false);
  const [easyJoinBusy, setEasyJoinBusy] = useState(false);
  const klass = classes.find((c) => c.id === classId);

  useEffect(() => {
    void (async () => {
      const [settings, health] = await Promise.all([
        api<{
          classroomApiBase?: string;
          studentEasyJoin?: boolean;
          studentEasyJoinClassId?: string;
        }>('/api/v1/settings'),
        fetch(`${API_BASE}/health`, { cache: 'no-store' }).then((r) => r.json()) as Promise<{
          lanIps?: string[];
          suggestedApiBase?: string;
          studentHealthUrl?: string;
        }>,
      ]);
      setEasyJoin(
        settings.studentEasyJoin === true &&
          Boolean(settings.studentEasyJoinClassId) &&
          settings.studentEasyJoinClassId === classId,
      );
      const stored = String(settings.classroomApiBase ?? '')
        .trim()
        .replace(/\/$/, '');
      const lanSuggested = String(health.suggestedApiBase ?? '')
        .trim()
        .replace(/\/$/, '');
      const storedIsLoopback = !stored || /127\.0\.0\.1|localhost/i.test(stored);
      const lanOk = Boolean(lanSuggested) && !/127\.0\.0\.1|localhost/i.test(lanSuggested);
      // Only auto-write when unset/loopback. A saved non-loopback value must survive refresh.
      let next = stored;
      if (storedIsLoopback && lanOk) {
        next = lanSuggested;
        await api('/api/v1/settings', {
          method: 'PATCH',
          body: JSON.stringify({ classroomApiBase: next }),
        });
        onApiBaseSaved?.();
      } else if (!storedIsLoopback) {
        next = stored;
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
  }, [onApiBaseSaved, classId]);

  async function setEasyJoinOn(on: boolean) {
    if (!classId && on) {
      window.alert(t('请先选班'));
      return;
    }
    setEasyJoinBusy(true);
    try {
      await api('/api/v1/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          studentEasyJoin: on,
          studentEasyJoinClassId: on ? classId : '',
        }),
      });
      setEasyJoin(on);
      setCopyMsg(on ? t('已开放本班一键连班：学生点「一键连教室」即可') : t('已关闭一键连班'));
      window.setTimeout(() => setCopyMsg(''), 3500);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : t('保存失败'));
    } finally {
      setEasyJoinBusy(false);
    }
  }

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
      comment: t('本教室 {v0}。学生机专用，禁止 127.0.0.1。', { v0: klass?.name ?? classId }),
    };
  }

  function downloadConfig() {
    const base = apiBase.replace(/\/$/, '');
    if (/127\.0\.0\.1|localhost/i.test(base)) {
      window.alert(t('禁止使用 127.0.0.1 / localhost，请填教师机局域网 IP'));
      return;
    }
    const cfg = configObject();
    const blob = new Blob([JSON.stringify(cfg, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    // Prefer a stable USB filename so every student machine can one-click import.
    a.download = 'classroom-desk-config.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function copyText(label: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopyMsg(t('已复制{v0}', { v0: label }));
      window.setTimeout(() => setCopyMsg(''), 2500);
    } catch {
      window.prompt(t('复制{v0}：', { v0: label }), text);
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
        {t(
          '傻瓜批量：打开「一键连班」→ 学生「查找教室」并确认班名/教师机后再连。备选：U 盘 config / 扫码。禁止 127.0.0.1。',
        )}
      </div>
      <p>
        {t('当前班级：')}
        <strong>{klass?.name ?? '—'}</strong>
      </p>
      <label className="row" data-testid="easy-join-toggle">
        <input
          type="checkbox"
          checked={easyJoin}
          disabled={!classId || easyJoinBusy}
          onChange={(e) => void setEasyJoinOn(e.target.checked)}
        />
        {t('开放本班「一键连班」（学生端一键连教室）')}
      </label>
      {easyJoin ? (
        <p className="hint" role="status">
          {t(
            '已开放：学生「查找教室」→ 认准班名/本机名 →「确认连接」后才写入。下课可关掉。',
          )}
        </p>
      ) : null}
      <p>
        classId：<code>{classId || t('（请先选班）')}</code>{' '}
        <button
          type="button"
          className="secondary"
          disabled={!classId}
          onClick={() => void copyText('classId', classId)}
        >
          {t('复制 classId')}
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
          {t('复制 apiBase')}
        </button>
      </p>
      {lanIps.length ? (
        <p className="hint">
          {t('本机检测到局域网 IP：')}
          {lanIps.map((ip) => (
            <button
              key={ip}
              type="button"
              className="linkish"
              onClick={() => setApiBase(`http://${ip}:8787`)}
            >
              {ip}
            </button>
          ))}
          {t('（点击填入）')}
        </p>
      ) : null}
      <label>
        {t('教师机 apiBase（学生机用）')}
        <input value={apiBase} onChange={(e) => setApiBase(e.target.value)} placeholder="http://192.168.x.x:8787" />
      </label>
      <button type="button" onClick={() => void saveApiBase().catch((e) => window.alert(String(e)))}>
        {t('保存为教室地址')}
      </button>{' '}
      <button type="button" disabled={!classId || !apiBase} onClick={downloadConfig}>
        {t('下载 classroom-desk-config.json（U盘批量）')}
      </button>{' '}
      <button
        type="button"
        className="secondary"
        disabled={!classId || !apiBase}
        onClick={() => void copyText('config.json', JSON.stringify(configObject(), null, 2))}
      >
        {t('复制 config.json')}
      </button>
      {qrDataUrl ? (
        <div className="qr-block">
          <p className="hint">{t('手机扫码查看 apiBase + classId（离线本地生成）')}</p>
          <img src={qrDataUrl} alt={t('学生机配置二维码')} width={220} height={220} />
        </div>
      ) : null}
      <p className="hint">
        {t('学生浏览器强制检测：')}{' '}
        <a href={healthHint} target="_blank" rel="noreferrer">
          {healthHint || '—'}
        </a>
      </p>
      <p className="hint">
        {t('打本教室安装包：')}
        <code>
          node scripts/pack-classroom-config.mjs --apiBase {apiBase || t('http://教师IP:8787')} --classId{' '}
          {classId || '<id>'}
        </code>
      </p>
      <pre className="code-block">{`{\n  "apiBase": "${apiBase.replace(/\/$/, '')}",\n  "classId": "${classId}"\n}`}</pre>
    </section>
  );
}
