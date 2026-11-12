import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { t } from '@classroom-desk/i18n';

/** QR for projection / connect: room code text, join URL, or config JSON. */
export function RoomJoinQr({
  payload,
  width = 200,
  label,
  testId,
  className = 'qr-block',
}: {
  payload: string;
  width?: number;
  label?: string;
  testId?: string;
  className?: string;
}) {
  const [dataUrl, setDataUrl] = useState('');

  useEffect(() => {
    const text = String(payload ?? '').trim();
    if (!text) {
      setDataUrl('');
      return;
    }
    void QRCode.toDataURL(text, { width, margin: 1 })
      .then(setDataUrl)
      .catch(() => setDataUrl(''));
  }, [payload, width]);

  if (!dataUrl) return null;

  return (
    <div className={className} data-testid={testId}>
      {label ? <p className="hint">{label}</p> : null}
      <img
        src={dataUrl}
        alt={t('教室连接二维码')}
        width={width}
        height={width}
        data-testid={testId ? `${testId}-img` : undefined}
      />
    </div>
  );
}
