import { useState, type ClipboardEvent } from 'react';
import { API_BASE, api, getToken } from '../api';
import { t } from '@classroom-desk/i18n';

async function loadTesseract(): Promise<{
  recognize: (img: File | Blob | string, langs: string) => Promise<{ data: { text: string } }>;
}> {
  const w = window as unknown as { Tesseract?: { recognize: Function } };
  if (!w.Tesseract) {
    await new Promise<void>((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error(t('Tesseract CDN 加载失败')));
      document.head.appendChild(s);
    });
  }
  if (!w.Tesseract) throw new Error(t('Tesseract 不可用'));
  return w.Tesseract as {
    recognize: (img: File | Blob | string, langs: string) => Promise<{ data: { text: string } }>;
  };
}

export function PacksPanel({
  classId,
  onGoSession,
}: {
  classId: string;
  onGoSession?: () => void;
}) {
  const [msg, setMsg] = useState('');
  const [month, setMonth] = useState(
    `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`,
  );
  const [shareUrl, setShareUrl] = useState('');
  const [ocrDraft, setOcrDraft] = useState(() => {
    try {
      return sessionStorage.getItem('cd_ocr_draft') ?? '';
    } catch {
      return '';
    }
  });
  const [ocrBusy, setOcrBusy] = useState(false);

  function persistDraft(next: string) {
    setOcrDraft(next);
    try {
      if (next.trim()) sessionStorage.setItem('cd_ocr_draft', next);
      else sessionStorage.removeItem('cd_ocr_draft');
    } catch {
      /* ignore */
    }
  }

  async function exportPack() {
    if (!classId) return;
    const token = getToken();
    const res = await fetch(
      `${API_BASE}/api/v1/packs/export?classId=${encodeURIComponent(classId)}`,
      { headers: token ? { Authorization: `Bearer ${token}` } : undefined },
    );
    if (!res.ok) throw new Error(`导出失败 HTTP ${res.status}`);
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `question-pack-${classId.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    setMsg(`已下载 ${a.download}`);
  }

  async function importFile(file: File | null) {
    if (!file || !classId) return;
    const text = await file.text();
    const pack = JSON.parse(text) as { items?: unknown[] };
    const r = await api<{ created: number }>('/api/v1/packs/import', {
      method: 'POST',
      body: JSON.stringify({ classId, pack, publish: true }),
    });
    setMsg(`已导入 ${r.created} 题`);
  }

  async function fromErrors() {
    if (!classId) return;
    const r = await api<{ pack: { items: unknown[] } }>('/api/v1/packs/from-errors', {
      method: 'POST',
      body: JSON.stringify({ classId, limit: 10 }),
    });
    const imp = await api<{ created: number }>('/api/v1/packs/import', {
      method: 'POST',
      body: JSON.stringify({ classId, pack: r.pack, publish: true }),
    });
    setMsg(`错题再练包已下发 ${imp.created} 题`);
  }

  async function parentShare() {
    if (!classId) return;
    const r = await api<{ url: string; expiresAt: string }>('/api/v1/reports/parent-month', {
      method: 'POST',
      body: JSON.stringify({ classId, month }),
    });
    setShareUrl(r.url);
    setMsg(`家长月报链接已生成，过期 ${new Date(r.expiresAt).toLocaleString()}`);
  }

  function pdfUrlFromShare(url: string): string {
    if (!url) return '';
    const u = new URL(url, window.location.origin);
    u.searchParams.set('format', 'pdf');
    return u.toString();
  }

  async function runOcrImage(file: File | null) {
    if (!file) return;
    setOcrBusy(true);
    setMsg(t('OCR 识别中…'));
    try {
      const T = await loadTesseract();
      const result = await T.recognize(file, 'chi_sim+eng');
      const text = (result.data?.text ?? '').trim();
      persistDraft(ocrDraft ? `${ocrDraft}\n\n${text}` : text);
      setMsg(`OCR 完成 · ${text.length} 字（本地 Tesseract）。可到「上课 → 快速发题」自动填入。`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : t('OCR 失败'));
    } finally {
      setOcrBusy(false);
    }
  }

  function onPasteDraft(e: ClipboardEvent<HTMLTextAreaElement>) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const blob = item.getAsFile();
        void runOcrImage(blob);
        return;
      }
    }
    // Word / plain text: let default paste happen; tip user
  }

  return (
    <section>
      <h2>{t('题库章节包 / 家长月报')}</h2>
      <p className="hint">{t('导出 JSON 跨班复用；错题再练一键下发；家长只读月报分享码 7 天有效。')}</p>
      <div className="row">
        <button type="button" disabled={!classId} onClick={() => void exportPack().catch((e) => setMsg(String(e)))}>
          导出题库包 JSON
        </button>
        <label className="secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          导入 JSON
          <input
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              void importFile(e.target.files?.[0] ?? null).catch((err) => setMsg(String(err)));
              e.target.value = '';
            }}
          />
        </label>
        <button type="button" disabled={!classId} onClick={() => void fromErrors().catch((e) => setMsg(String(e)))}>
          错题再练包下发
        </button>
      </div>
      <h3>{t('家长 / 教务只读月报')}</h3>
      <div className="row">
        <label>
          月份
          <input value={month} onChange={(e) => setMonth(e.target.value)} placeholder="YYYY-MM" />
        </label>
        <button type="button" disabled={!classId} onClick={() => void parentShare().catch((e) => setMsg(String(e)))}>
          生成分享链接
        </button>
        {shareUrl ? (
          <a className="button secondary" href={pdfUrlFromShare(shareUrl)} download={`parent-report-${month}.pdf`}>
            下载 PDF
          </a>
        ) : null}
      </div>
      {shareUrl ? (
        <p className="hint">
          <a href={shareUrl} target="_blank" rel="noreferrer">
            {shareUrl}
          </a>{' '}
          <button type="button" className="linkish" onClick={() => void navigator.clipboard.writeText(shareUrl)}>
            复制
          </button>
          {' · '}
          <a href={shareUrl} target="_blank" rel="noreferrer">
            HTML 可打印
          </a>
        </p>
      ) : null}

      <h3>{t('OCR 出题草稿（本地 Tesseract）')}</h3>
      <p className="hint">{t('粘贴 Word 文本或截图；选图走浏览器端识别，不上传服务器。草稿可复制到「快速发题」。')}</p>
      <div className="row">
        <label className="secondary" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          选图 OCR
          <input
            type="file"
            accept="image/*"
            hidden
            disabled={ocrBusy}
            onChange={(e) => {
              void runOcrImage(e.target.files?.[0] ?? null);
              e.target.value = '';
            }}
          />
        </label>
        <button
          type="button"
          className="secondary"
          disabled={!ocrDraft}
          onClick={() =>
            void navigator.clipboard.writeText(ocrDraft).then(() => setMsg(t('草稿已复制')))
          }
        >
          复制草稿
        </button>
        <button
          type="button"
          disabled={!ocrDraft}
          onClick={() => {
            if (!onGoSession) {
              setMsg(t('无上课权限，无法送到快发题'));
              return;
            }
            persistDraft(ocrDraft);
            setMsg(t('已写入上课快发题草稿'));
            onGoSession();
          }}
        >
          送到快发题
        </button>
        <button type="button" className="secondary" disabled={!ocrDraft} onClick={() => persistDraft('')}>
          清空
        </button>
      </div>
      {!onGoSession && ocrDraft.trim() ? (
        <div className="row" data-testid="ocr-no-session-actions">
          <button
            type="button"
            className="secondary"
            onClick={() =>
              void navigator.clipboard.writeText(ocrDraft).then(() => setMsg(t('草稿已复制（可粘贴给任课教师）')))
            }
          >
            复制草稿
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              const text =
                t('请开通上课权限，以便我将 OCR 草稿送到「快速发题」。班级可在教师后台「按班授权」外另开通上课入口。');
              void navigator.clipboard.writeText(text).then(() =>
                setMsg(t('已复制申请文案，请发给任课教师开通上课权限')),
              );
            }}
          >
            申请上课权限
          </button>
        </div>
      ) : null}
      <textarea
        rows={8}
        value={ocrDraft}
        onChange={(e) => persistDraft(e.target.value)}
        onPaste={onPasteDraft}
        placeholder={t('粘贴 Word 文本，或 Ctrl+V 粘贴截图自动 OCR…')}
        disabled={ocrBusy}
      />

      {msg ? (
        <p className={msg.includes(t('无上课权限')) || msg.includes(t('申请文案')) ? 'error' : 'hint'} role="status">
          {msg}
        </p>
      ) : null}
    </section>
  );
}
