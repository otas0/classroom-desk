import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { encodeRoomCode } from '@classroom-desk/shared';
import { RoomJoinQr } from './RoomJoinQr';
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
  const [advertiseLanIp, setAdvertiseLanIp] = useState('');
  const [nicOptions, setNicOptions] = useState<Array<{ name: string; address: string; internal: boolean }>>(
    [],
  );
  const [healthHint, setHealthHint] = useState('');
  const [copyMsg, setCopyMsg] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [easyJoin, setEasyJoin] = useState(false);
  const [easyJoinBusy, setEasyJoinBusy] = useState(false);
  const [easyJoinAutoOff, setEasyJoinAutoOff] = useState(true);
  const [ttlMinutes, setTtlMinutes] = useState(0);
  const [followSchedule, setFollowSchedule] = useState(false);
  const [roomId, setRoomId] = useState('');
  const [openedAt, setOpenedAt] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [joinPinDraft, setJoinPinDraft] = useState('');
  const [joinPinConfigured, setJoinPinConfigured] = useState(false);
  const [joinRequireApproval, setJoinRequireApproval] = useState(false);
  const [pullJoin, setPullJoin] = useState(false);
  const [pullJoinBusy, setPullJoinBusy] = useState(false);
  const [pendingDevices, setPendingDevices] = useState<
    Array<{ id: string; deviceId: string; hostname: string; clientIp?: string | null; createdAt: string }>
  >([]);
  const klass = classes.find((c) => c.id === classId);

  const roomCodeIp = useMemo(() => {
    if (advertiseLanIp) return advertiseLanIp;
    let ip = '';
    try {
      if (apiBase) ip = new URL(apiBase).hostname;
    } catch {
      ip = '';
    }
    if (!ip || /127\.0\.0\.1|localhost/i.test(ip)) ip = lanIps[0] ?? '';
    return ip;
  }, [apiBase, lanIps, advertiseLanIp]);

  const roomCode = useMemo(() => (roomCodeIp ? encodeRoomCode(roomCodeIp) : null), [roomCodeIp]);

  useEffect(() => {
    void (async () => {
      const [settings, pendingRes, health, nics] = await Promise.all([
        api<{
          classroomApiBase?: string;
          advertiseLanIp?: string;
          studentEasyJoin?: boolean;
          studentEasyJoinClassId?: string;
          studentEasyJoinAutoOff?: boolean;
          studentEasyJoinTtlMinutes?: number;
          studentEasyJoinFollowSchedule?: boolean;
          studentEasyJoinOpenedAt?: string;
          classroomDisplayName?: string;
          classroomRoomId?: string;
          studentJoinPinConfigured?: boolean;
          studentJoinRequireApproval?: boolean;
          classListPullEnabled?: boolean;
          classListPullClassId?: string;
        }>('/api/v1/settings'),
        api<{ items: typeof pendingDevices }>('/api/v1/classroom/join/pending-devices').catch(
          () => ({ items: [] as typeof pendingDevices }),
        ),
        fetch(`${API_BASE}/health`, { cache: 'no-store' }).then((r) => r.json()) as Promise<{
          lanIps?: string[];
          advertiseLanIp?: string | null;
          suggestedApiBase?: string;
          studentHealthUrl?: string;
        }>,
        api<{
          interfaces?: Array<{ name: string; address: string; internal: boolean }>;
          advertiseLanIp?: string | null;
        }>('/api/v1/network/interfaces').catch(() => ({
          interfaces: [] as Array<{ name: string; address: string; internal: boolean }>,
          advertiseLanIp: null,
        })),
      ]);
      setEasyJoin(
        settings.studentEasyJoin === true &&
          Boolean(settings.studentEasyJoinClassId) &&
          settings.studentEasyJoinClassId === classId,
      );
      setEasyJoinAutoOff(settings.studentEasyJoinAutoOff !== false);
      setTtlMinutes(Number(settings.studentEasyJoinTtlMinutes ?? 0) || 0);
      setFollowSchedule(settings.studentEasyJoinFollowSchedule === true);
      setOpenedAt(String(settings.studentEasyJoinOpenedAt ?? '').trim());
      setDisplayName(String(settings.classroomDisplayName ?? '').trim());
      setRoomId(String(settings.classroomRoomId ?? '').trim());
      setJoinPinConfigured(settings.studentJoinPinConfigured === true);
      setJoinPinDraft('');
      setJoinRequireApproval(settings.studentJoinRequireApproval === true);
      setPullJoin(
        settings.classListPullEnabled === true &&
          Boolean(settings.classListPullClassId) &&
          settings.classListPullClassId === classId,
      );
      setPendingDevices(pendingRes.items ?? []);
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
      const adv =
        String(settings.advertiseLanIp ?? nics.advertiseLanIp ?? health.advertiseLanIp ?? '').trim();
      setAdvertiseLanIp(adv);
      setNicOptions(
        (nics.interfaces ?? []).filter((i) => !i.internal).map((i) => ({
          name: i.name,
          address: i.address,
          internal: i.internal,
        })),
      );
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
      setCopyMsg(
        on ? t('已开放本班一键连班：学生「查找教室」后确认即可') : t('已关闭一键连班'),
      );
      window.setTimeout(() => setCopyMsg(''), 3500);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : t('保存失败'));
    } finally {
      setEasyJoinBusy(false);
    }
  }

  async function refreshPendingDevices() {
    try {
      const r = await api<{ items: typeof pendingDevices }>('/api/v1/classroom/join/pending-devices');
      setPendingDevices(r.items ?? []);
    } catch {
      setPendingDevices([]);
    }
  }

  async function saveJoinPin() {
    const pin = joinPinDraft.trim();
    try {
      await api('/api/v1/settings', {
        method: 'PATCH',
        body: JSON.stringify({ studentJoinPin: pin }),
      });
      setJoinPinConfigured(Boolean(pin));
      setJoinPinDraft('');
      setCopyMsg(
        pin ? t('已保存连班 PIN（学生连接时须填写）') : t('已清除连班 PIN'),
      );
      window.setTimeout(() => setCopyMsg(''), 3500);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : t('保存失败'));
    }
  }

  async function setJoinApproval(on: boolean) {
    try {
      await api('/api/v1/settings', {
        method: 'PATCH',
        body: JSON.stringify({ studentJoinRequireApproval: on }),
      });
      setJoinRequireApproval(on);
      setCopyMsg(on ? t('已开启：陌生设备须教师批准后才能连班') : t('已关闭设备批准'));
      window.setTimeout(() => setCopyMsg(''), 3500);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : t('保存失败'));
    }
  }

  async function setPullJoinOn(on: boolean) {
    if (!classId && on) {
      window.alert(t('请先选班'));
      return;
    }
    setPullJoinBusy(true);
    try {
      await api('/api/v1/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          classListPullEnabled: on,
          classListPullClassId: on ? classId : '',
        }),
      });
      setPullJoin(on);
      setCopyMsg(
        on
          ? t('已开启名单拉取连班：本班已登录学生会自动同步课堂（无需扫网）')
          : t('已关闭名单拉取连班'),
      );
      window.setTimeout(() => setCopyMsg(''), 3500);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : t('保存失败'));
    } finally {
      setPullJoinBusy(false);
    }
  }

  async function decideDevice(id: string, decision: 'approved' | 'denied') {
    try {
      await api(`/api/v1/classroom/join/devices/${encodeURIComponent(id)}/decision`, {
        method: 'POST',
        body: JSON.stringify({ decision }),
      });
      await refreshPendingDevices();
      setCopyMsg(decision === 'approved' ? t('已批准设备连班') : t('已拒绝设备连班'));
      window.setTimeout(() => setCopyMsg(''), 2500);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : t('操作失败'));
    }
  }

  async function setAutoOff(on: boolean) {
    try {
      await api('/api/v1/settings', {
        method: 'PATCH',
        body: JSON.stringify({ studentEasyJoinAutoOff: on }),
      });
      setEasyJoinAutoOff(on);
      setCopyMsg(
        on
          ? t('已开启：下课结束深锁或切班时自动关一键连班')
          : t('已关闭自动关一键连班（需手动关）'),
      );
      window.setTimeout(() => setCopyMsg(''), 3500);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : t('保存失败'));
    }
  }

  async function saveDisplayName() {
    const name = displayName.trim().slice(0, 64);
    try {
      await api('/api/v1/settings', {
        method: 'PATCH',
        body: JSON.stringify({ classroomDisplayName: name }),
      });
      setCopyMsg(t('已保存讲台显示名'));
      window.setTimeout(() => setCopyMsg(''), 2500);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : t('保存失败'));
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
      <label className="row" data-testid="easy-join-auto-off">
        <input
          type="checkbox"
          checked={easyJoinAutoOff}
          onChange={(e) => void setAutoOff(e.target.checked)}
        />
        {t('下课自动关一键连班（结束深锁 / 切班时，防幽灵讲台）')}
      </label>
      <label className="row" data-testid="easy-join-follow-schedule">
        <input
          type="checkbox"
          checked={followSchedule}
          onChange={(e) => {
            const on = e.target.checked;
            setFollowSchedule(on);
            void api('/api/v1/settings', {
              method: 'PATCH',
              body: JSON.stringify({ studentEasyJoinFollowSchedule: on }),
            }).catch((err) => window.alert(String(err)));
          }}
        />
        {t('按课表节次自动开/关一键连班')}
      </label>
      <label>
        {t('一键连班倒计时（分钟，0=不限）')}
        <input
          type="number"
          min={0}
          max={480}
          value={ttlMinutes}
          data-testid="easy-join-ttl"
          onChange={(e) => setTtlMinutes(Number(e.target.value) || 0)}
          onBlur={() => {
            void api('/api/v1/settings', {
              method: 'PATCH',
              body: JSON.stringify({ studentEasyJoinTtlMinutes: ttlMinutes }),
            }).catch((err) => window.alert(String(err)));
          }}
        />
      </label>
      {easyJoin && ttlMinutes > 0 && openedAt ? (
        <p className="hint" data-testid="easy-join-ttl-hint">
          {t('已开于 {v0}，约 {v1} 分钟后自动关', {
            v0: new Date(openedAt).toLocaleTimeString(),
            v1: String(ttlMinutes),
          })}
        </p>
      ) : null}
      <label>
        {t('教室号（房间模式，如 302）')}
        <input
          value={roomId}
          onChange={(e) => setRoomId(e.target.value)}
          maxLength={32}
          placeholder="302"
          data-testid="classroom-room-id"
        />
      </label>
      <button
        type="button"
        className="secondary"
        onClick={() => {
          void api('/api/v1/settings', {
            method: 'PATCH',
            body: JSON.stringify({ classroomRoomId: roomId.trim() }),
          })
            .then(() => {
              setCopyMsg(t('已保存教室号'));
              window.setTimeout(() => setCopyMsg(''), 2500);
            })
            .catch((e) => window.alert(String(e)));
        }}
      >
        {t('保存教室号')}
      </button>
      {easyJoin ? (
        <p className="hint" role="status">
          {t(
            '已开放：学生「查找教室」或输入房间码 → 认准显示名/班名 →「确认连接」。',
          )}
        </p>
      ) : null}
      <h3>{t('连班鉴权')}</h3>
      <p className="hint">
        {t('可选：连班 PIN + 陌生设备批准；连班失败过多会按 IP 限流（10 次/5 分钟）。')}
      </p>
      <label>
        {t('连班 PIN（留空并保存可清除）')}
        <input
          type="password"
          value={joinPinDraft}
          onChange={(e) => setJoinPinDraft(e.target.value)}
          placeholder={joinPinConfigured ? t('已设置（输入新值覆盖）') : t('未设置')}
          maxLength={32}
          autoComplete="new-password"
          data-testid="join-pin-input"
        />
      </label>{' '}
      <button type="button" className="secondary" onClick={() => void saveJoinPin()}>
        {t('保存 PIN')}
      </button>
      <label className="row" data-testid="join-require-approval">
        <input
          type="checkbox"
          checked={joinRequireApproval}
          onChange={(e) => void setJoinApproval(e.target.checked)}
        />
        {t('陌生设备须批准后才能连班')}
      </label>
      {pendingDevices.length ? (
        <fieldset className="field" data-testid="join-pending-devices">
          <legend>{t('待批准设备')}</legend>
          <ul>
            {pendingDevices.map((d) => (
              <li key={d.id}>
                <code>{d.deviceId}</code> · {d.hostname || '—'} · {d.clientIp || '—'}{' '}
                <button type="button" className="secondary" onClick={() => void decideDevice(d.id, 'approved')}>
                  {t('批准')}
                </button>{' '}
                <button type="button" className="secondary" onClick={() => void decideDevice(d.id, 'denied')}>
                  {t('拒绝')}
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="linkish" onClick={() => void refreshPendingDevices()}>
            {t('刷新列表')}
          </button>
        </fieldset>
      ) : null}
      <label className="row" data-testid="class-list-pull-join">
        <input
          type="checkbox"
          checked={pullJoin}
          disabled={!classId || pullJoinBusy}
          onChange={(e) => void setPullJoinOn(e.target.checked)}
        />
        {t('名单拉取连班（本班已登录学生自动加入，无需扫网）')}
      </label>
      <label data-testid="advertise-lan-ip">
        {t('广播用网卡（房间码 / mDNS / 信标）')}
        <select
          value={advertiseLanIp}
          onChange={(e) => {
            const ip = e.target.value;
            setAdvertiseLanIp(ip);
            void api('/api/v1/settings', {
              method: 'PATCH',
              body: JSON.stringify({ advertiseLanIp: ip }),
            })
              .then(() => {
                setCopyMsg(ip ? t('已选择广播 IP {v0}', { v0: ip }) : t('已恢复自动选择网卡'));
                window.setTimeout(() => setCopyMsg(''), 2500);
              })
              .catch((err) => window.alert(err instanceof Error ? err.message : t('保存失败')));
          }}
        >
          <option value="">{t('自动（首选局域网 IP）')}</option>
          {nicOptions.map((n) => (
            <option key={`${n.name}:${n.address}`} value={n.address}>
              {n.name} · {n.address}
            </option>
          ))}
        </select>
      </label>
      {roomCode ? (
        <p className="hint" data-testid="classroom-room-code">
          {t('房间码（访客隔离 / 跨网段时给学生手输）：')}{' '}
          <code style={{ fontSize: '1.25rem', letterSpacing: '0.06em' }}>{roomCode}</code>{' '}
          {roomCodeIp ? (
            <span className="hint">
              {' '}
              ({t('来自')} {roomCodeIp})
            </span>
          ) : null}{' '}
          <button
            type="button"
            className="secondary"
            onClick={() => void copyText(t('房间码'), roomCode)}
          >
            {t('复制房间码')}
          </button>
        </p>
      ) : null}
      {roomCode ? (
        <RoomJoinQr
          payload={roomCode}
          width={200}
          label={t('房间码二维码（学生端扫码填码）')}
          testId="classroom-room-code-qr"
        />
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
      <label>
        {t('讲台显示名（学生查找列表）')}
        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder={t('例如：高一3班讲台')}
          maxLength={64}
          data-testid="classroom-display-name"
        />
      </label>
      <button type="button" onClick={() => void saveApiBase().catch((e) => window.alert(String(e)))}>
        {t('保存为教室地址')}
      </button>{' '}
      <button type="button" className="secondary" onClick={() => void saveDisplayName()}>
        {t('保存显示名')}
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

      <FederationHubWizard />
    </section>
  );
}

function randomHubToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function FederationHubWizard() {
  const [hubIngestUrl, setHubIngestUrl] = useState('');
  const [hubTokenDraft, setHubTokenDraft] = useState('');
  const [hasSavedToken, setHasSavedToken] = useState(false);
  const [copyMsg, setCopyMsg] = useState('');
  const [saveMsg, setSaveMsg] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void api<{ federationHubUrl?: string; hasFederationHubToken?: boolean }>('/api/v1/settings')
      .then((s) => {
        if (cancelled) return;
        setHubIngestUrl(String(s.federationHubUrl ?? '').trim());
        setHasSavedToken(Boolean(s.hasFederationHubToken));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  async function copyText(label: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopyMsg(t('已复制{v0}', { v0: label }));
      window.setTimeout(() => setCopyMsg(''), 2500);
    } catch {
      window.prompt(t('复制{v0}：', { v0: label }), text);
    }
  }

  async function saveHubSettings() {
    setBusy(true);
    setSaveMsg('');
    try {
      const body: { federationHubUrl: string; federationHubToken?: string } = {
        federationHubUrl: hubIngestUrl.trim(),
      };
      const tok = hubTokenDraft.trim();
      if (tok) body.federationHubToken = tok;
      await api('/api/v1/settings', { method: 'PATCH', body: JSON.stringify(body) });
      if (tok) {
        setHasSavedToken(true);
        setHubTokenDraft('');
      }
      setSaveMsg(t('已保存 Hub 设置（优先于环境变量）'));
    } catch (e) {
      setSaveMsg(e instanceof Error ? e.message : t('保存失败'));
    } finally {
      setBusy(false);
    }
  }

  const tokenForEnv =
    hubTokenDraft.trim() || (hasSavedToken ? '<已保存，未回显>' : '<token>');
  const hubEnv = hubIngestUrl.trim()
    ? `CLASSROOM_DESK_FEDERATION_HUB='${hubIngestUrl.trim()}'`
    : `CLASSROOM_DESK_FEDERATION_HUB='https://<hub-host>:8790/api/v1/federation/ingest'`;
  const tokenEnv = `CLASSROOM_DESK_FEDERATION_HUB_TOKEN='${tokenForEnv}'`;

  return (
    <fieldset className="field" data-testid="federation-hub-wizard">
      <legend>{t('校区 Federation Hub（可选）')}</legend>
      <p className="hint">
        {t('多讲台汇聚发现：默认写入本页设置（数据库）；未填时回退进程环境变量。部署说明见 ')}
        <code>deploy/federation-hub/README.md</code>。
        {' '}
        <a
          href="https://github.com/otas0/classroom-desk/blob/main/deploy/federation-hub/README.md"
          target="_blank"
          rel="noreferrer"
        >
          {t('在线打开')}
        </a>
      </p>
      {copyMsg ? <p className="toast-inline">{copyMsg}</p> : null}
      {saveMsg ? <p className="toast-inline">{saveMsg}</p> : null}
      <label>
        {t('Hub ingest URL（HTTPS 推荐）')}
        <input
          value={hubIngestUrl}
          onChange={(e) => setHubIngestUrl(e.target.value)}
          placeholder="https://hub.school.edu:8790/api/v1/federation/ingest"
          data-testid="federation-hub-url"
        />
      </label>
      <label>
        {t('Hub 令牌（Bearer，留空不修改已保存值）')}
        <input
          type="password"
          autoComplete="off"
          value={hubTokenDraft}
          onChange={(e) => setHubTokenDraft(e.target.value)}
          placeholder={hasSavedToken ? t('已配置 · 输入新值以轮换') : t('未配置')}
          data-testid="federation-hub-token"
        />
      </label>{' '}
      <button
        type="button"
        className="secondary"
        onClick={() => setHubTokenDraft(randomHubToken())}
        data-testid="federation-hub-regen-token"
      >
        {t('生成新令牌草稿')}
      </button>{' '}
      <button type="button" disabled={busy} onClick={() => void saveHubSettings()}>
        {t('保存 Hub 设置')}
      </button>
      <p className="hint">
        {t('Hub 端同步设置 ')}
        <code>FEDERATION_HUB_TOKEN</code>
        {t('（与教师端令牌相同）。')}
      </p>
      <details>
        <summary>{t('可选：复制环境变量（与数据库二选一或作备份）')}</summary>
        <pre className="code-block" data-testid="federation-hub-env-block">
          {`${hubEnv}\n${tokenEnv}`}
        </pre>
        <button
          type="button"
          className="secondary"
          onClick={() => void copyText(t('环境变量'), `${hubEnv}\n${tokenEnv}`)}
        >
          {t('复制两行 export')}
        </button>{' '}
        <button
          type="button"
          className="secondary"
          onClick={() => void copyText('CLASSROOM_DESK_FEDERATION_HUB', hubEnv)}
        >
          {t('复制 HUB 行')}
        </button>{' '}
        <button
          type="button"
          className="secondary"
          onClick={() => void copyText('CLASSROOM_DESK_FEDERATION_HUB_TOKEN', tokenEnv)}
        >
          {t('复制 TOKEN 行')}
        </button>
      </details>
    </fieldset>
  );
}
