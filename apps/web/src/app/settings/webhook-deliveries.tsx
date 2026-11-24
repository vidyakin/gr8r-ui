/* Журнал доставок вебхука и кнопка ручного повтора (Settings → Integrations, задача 1392). */
import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { Badge, Button, Skeleton, toast } from '@/components/ui';
import { useT } from '@/i18n';
import { fmtDateTime } from '@/i18n/format';
import { errorMessage } from '../data/api';
import { call, useWsId } from '../meta/data';

export interface WebhookDeliveryItem {
  id: string;
  webhookId: string;
  eventId: string;
  eventType: string;
  entity: string;
  recordId: string | null;
  status: 'queued' | 'delivered' | 'failed';
  attempts: number;
  responseStatus: number | null;
  lastError: string | null;
  createdAt: string;
  deliveredAt: string | null;
}

const toneOf = (s: WebhookDeliveryItem['status']) => (s === 'delivered' ? 'green' : s === 'failed' ? 'red' : 'neutral');

export function WebhookDeliveriesLog({ webhookId }: { webhookId: string }) {
  const t = useT();
  const ws = useWsId();
  const qc = useQueryClient();
  const queryKey = ['ws', ws, 'webhooks', webhookId, 'deliveries'] as const;
  const q = useQuery({
    queryKey,
    queryFn: () => call<{ items: WebhookDeliveryItem[]; total: number }>(ws, 'GET', `/webhooks/${webhookId}/deliveries?limit=25`),
  });
  const [retrying, setRetrying] = React.useState<string | null>(null);

  const retry = async (deliveryId: string) => {
    setRetrying(deliveryId);
    try {
      await call(ws, 'POST', `/webhooks/${webhookId}/deliveries/${deliveryId}/retry`);
      toast(t('secrets.webhooks.retried'));
      void qc.invalidateQueries({ queryKey });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setRetrying(null);
    }
  };

  if (q.isPending) return <Skeleton w="100%" h={48} />;
  const items = q.data?.items ?? [];
  if (!items.length) return <div className="muted" style={{ fontSize: 12, paddingTop: 8 }}>{t('secrets.webhooks.noDeliveries')}</div>;

  return (
    <div className="stack" style={{ gap: 6, marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
      {items.map(d => (
        <div key={d.id} className="row" style={{ justifyContent: 'space-between', gap: 8, fontSize: 12, flexWrap: 'wrap' }}>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <Badge tone={toneOf(d.status)}>{t(`secrets.webhooks.status.${d.status}` as 'secrets.webhooks.status.queued')}</Badge>
            <code>{d.eventType}</code>
            {d.responseStatus !== null && <span className="muted">HTTP {d.responseStatus}</span>}
            <span className="muted">{t('secrets.webhooks.attempts', { n: d.attempts })}</span>
            <span className="muted">{fmtDateTime(d.deliveredAt ?? d.createdAt)}</span>
            {d.lastError && <span style={{ color: 'var(--danger)' }}>{d.lastError}</span>}
          </div>
          {d.status !== 'delivered' && (
            <Button size="sm" variant="ghost" disabled={retrying === d.id} onClick={() => void retry(d.id)}>
              <RefreshCw size={12} />
              {t('secrets.webhooks.retry')}
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}
