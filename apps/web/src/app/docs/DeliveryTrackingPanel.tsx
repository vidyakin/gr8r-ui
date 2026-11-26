/* Блок публичного отслеживания и истории уведомлений по доставке (задача 1217).
   Переиспользуется во вкладке документа (DeliveryTab) и в диалоге/карточке доставки (DeliveriesPage). */
import * as React from 'react';
import { Bell, Check, Copy, ExternalLink, RefreshCw } from 'lucide-react';
import type { DeliveryNotificationStatus } from '@erp/shared';
import { Badge, Button, Switch, toast, type Tone } from '@/components/ui';
import { useT } from '@/i18n';
import { useDocsApi } from './data';
import { deliveryTrackingUrl, useDeliveryNotifications, type DeliveryItem } from './delivery-data';

const NOTIFY_TONE: Record<DeliveryNotificationStatus, Tone> = {
  queued: 'neutral',
  sent: 'green',
  logged: 'accent',
  failed: 'red',
  skipped: 'amber',
};

export function DeliveryTrackingPanel({ item, canWrite }: { item: DeliveryItem; canWrite: boolean }) {
  const t = useT();
  const api = useDocsApi();
  const notifs = useDeliveryNotifications(item.id);
  const [busy, setBusy] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  const copyLink = async (token: string) => {
    const url = deliveryTrackingUrl(token);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
      toast(t('delivery.tracking.copied'));
    } catch {
      toast(url);
    }
  };

  const handleEnableAndCopy = async () => {
    if (item.trackingEnabled && item.trackingToken) {
      await copyLink(item.trackingToken);
      return;
    }
    setBusy(true);
    const updated = (await api('POST', `/deliveries/${item.id}/tracking`, { enabled: true })) as DeliveryItem | null;
    setBusy(false);
    if (updated?.trackingToken) await copyLink(updated.trackingToken);
  };

  const toggleTracking = async (enabled: boolean) => {
    setBusy(true);
    const r = await api('POST', `/deliveries/${item.id}/tracking`, { enabled });
    setBusy(false);
    if (r) toast(t(enabled ? 'delivery.tracking.enabled' : 'delivery.tracking.disabled'));
  };

  const rotateToken = async () => {
    setBusy(true);
    const r = await api('POST', `/deliveries/${item.id}/tracking`, { rotate: true });
    setBusy(false);
    if (r) toast(t('delivery.tracking.rotated'));
  };

  const notifyNow = async () => {
    setBusy(true);
    const r = await api('POST', `/deliveries/${item.id}/notify`, {});
    setBusy(false);
    if (r) {
      toast(t('delivery.notify.sentToast'));
      void notifs.refetch();
    }
  };

  const url = item.trackingEnabled && item.trackingToken ? deliveryTrackingUrl(item.trackingToken) : '';

  return (
    <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
      <div className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
        <strong style={{ fontSize: 13 }}>{t('delivery.tracking.title')}</strong>
        {canWrite && (
          <Switch
            checked={item.trackingEnabled}
            disabled={busy}
            aria-label={t('delivery.tracking.title')}
            onChange={e => void toggleTracking(e.target.checked)}
          />
        )}
        <span className="sp" />
        {(item.trackingEnabled || canWrite) && (
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void handleEnableAndCopy()}>
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {item.trackingEnabled && item.trackingToken ? t('delivery.tracking.copy') : t('delivery.tracking.enableAndCopy')}
          </Button>
        )}
        {url && (
          <Button size="sm" variant="ghost" asChild>
            <a href={url} target="_blank" rel="noreferrer">
              <ExternalLink size={13} />
              {t('delivery.tracking.open')}
            </a>
          </Button>
        )}
        {canWrite && item.trackingEnabled && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void rotateToken()}>
            <RefreshCw size={13} />
            {t('delivery.tracking.rotate')}
          </Button>
        )}
        {canWrite && (item.contactPhone || item.contactEmail) && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void notifyNow()}>
            <Bell size={13} />
            {t('delivery.notify.send')}
          </Button>
        )}
      </div>

      {url && (
        <p className="faint" style={{ fontSize: 12, margin: '0 0 8px', wordBreak: 'break-all' }}>
          {url}
        </p>
      )}

      <div>
        <div className="faint" style={{ fontSize: 12, fontWeight: 500, marginBottom: 6 }}>
          {t('delivery.notify.title')}
        </div>
        {!notifs.data?.length ? (
          <p className="faint" style={{ fontSize: 12, margin: 0 }}>{t('delivery.notify.empty')}</p>
        ) : (
          <div className="stack" style={{ gap: 6 }}>
            {notifs.data.slice(0, 10).map(n => (
              <div key={n.id} className="row" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 12, padding: '6px 8px', borderRadius: 'var(--r)', background: 'var(--surface-2)' }}>
                <Badge tone="neutral">{t(`delivery.notify.channel.${n.channel}`)}</Badge>
                <span>{t(`delivery.notify.event.${n.eventKind}`)}</span>
                <span className="muted">{n.recipient}</span>
                <span className="sp" />
                <Badge tone={NOTIFY_TONE[n.status]}>{t(`delivery.notify.status.${n.status}`)}</Badge>
                <span className="faint num">{new Date(n.sentAt ?? n.createdAt).toLocaleString()}</span>
                {n.error && <span style={{ color: 'var(--danger)' }}>{n.error}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
