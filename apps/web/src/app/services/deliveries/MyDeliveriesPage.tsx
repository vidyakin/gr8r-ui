/* «Мои доставки» (задача 1100): экран курьера на телефонной ширине — доставки на день, адрес, контакт, телефон ссылкой tel:,
   сумма, отметки «в пути» / «доставлена» / «не доставлена» с комментарием. Курьер видит и меняет только свои. */
import * as React from 'react';
import { Link } from 'react-router';
import { Phone, Printer, Truck } from 'lucide-react';
import { Button, Dialog, DialogContent, EmptyState, Field, Input, Skeleton, Textarea, toast, Badge } from '@/components/ui';
import { fmtAmount, useT } from '@/i18n';
import { iso, today } from '../../lib/dates';
import { useDocsApi } from '../../docs/data';
import { typeLabel } from '../../docs/data';
import { DELIVERY_TONE } from '../../docs/DeliveryTab';
import { openRouteSheet, useMyDeliveries, type DeliveryItem } from '../../docs/delivery-data';
import { useWsId } from '../../meta/data';
import { dec, fmt } from '@gr8r/shared';

export function MyDeliveriesPage() {
  const t = useT();
  const ws = useWsId();
  const api = useDocsApi();
  const [date, setDate] = React.useState(iso(today()));
  const list = useMyDeliveries(date);
  const [failing, setFailing] = React.useState<DeliveryItem | null>(null);
  const [reason, setReason] = React.useState('');
  const items = list.data?.items ?? [];
  const total = fmt(items.filter(i => i.status !== 'failed').reduce((s, i) => s + dec(i.documentTotal), 0n), 2);

  const mark = async (d: DeliveryItem, status: string, comment?: string) => {
    const r = await api('POST', `/deliveries/${d.id}/status`, { status, ...(comment !== undefined ? { comment } : {}) });
    if (r) toast(t('delivery.mine.updated'));
    return !!r;
  };

  return (
    <div className="page my-deliveries" style={{ maxWidth: 560, margin: '0 auto', padding: '0 var(--gutter) 24px' }}>
      <div className="ph">
        <div>
          <h1>{t('delivery.mine.title')}</h1>
          <p>{t('delivery.mine.lead')}</p>
        </div>
      </div>
      <div className="row" style={{ gap: 8, alignItems: 'flex-end', marginBottom: 12 }}>
        <Field label={t('delivery.mine.date')}>{p => <Input {...p} type="date" value={date} onChange={e => setDate(e.target.value || iso(today()))} />}</Field>
        <Button size="sm" variant="ghost" disabled={!items.length} onClick={() => openRouteSheet(ws, null, date).catch(e => toast.error(String(e instanceof Error ? e.message : e)))}>
          <Printer size={13} />
          {t('delivery.mine.print')}
        </Button>
      </div>
      {list.isPending ? (
        <Skeleton w="100%" h={90} />
      ) : !items.length ? (
        <EmptyState icon={<Truck size={20} />} title={t('delivery.mine.empty')}>
          {t('delivery.mine.emptyHint')}
        </EmptyState>
      ) : (
        <div className="stack" style={{ gap: 12 }}>
          {items.map(d => (
            <section key={d.id} className="panel" aria-label={d.address} style={{ padding: 12 }}>
              <div className="row" style={{ justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
                <strong style={{ fontSize: 15 }}>{d.address || '—'}</strong>
                <Badge tone={DELIVERY_TONE[d.status]}>{t(`delivery.status.${d.status}`)}</Badge>
              </div>
              {(d.windowFrom || d.windowTo) && (
                <p className="muted" style={{ margin: '4px 0' }}>
                  {t('delivery.mine.window')}: {d.windowFrom?.slice(0, 5) ?? ''}–{d.windowTo?.slice(0, 5) ?? ''}
                </p>
              )}
              <p style={{ margin: '4px 0' }}>{d.contactName}</p>
              {d.contactPhone && (
                <p style={{ margin: '4px 0' }}>
                  <a className="crm-link" href={`tel:${d.contactPhone.replace(/[^\d+]/g, '')}`} style={{ display: 'inline-flex', gap: 6, alignItems: 'center', minHeight: 44 }}>
                    <Phone size={16} />
                    {d.contactPhone}
                  </a>
                </p>
              )}
              <p className="muted" style={{ margin: '4px 0' }}>
                <Link className="crm-link" to={`/documents/${d.documentId}`}>
                  {typeLabel(d.documentType as never)} {d.documentNumber ?? ''}
                </Link>
                {' · '}
                {t('delivery.mine.sum')}: <strong>{fmtAmount(d.documentTotal)}</strong>
              </p>
              {d.comment && <p className="faint" style={{ margin: '4px 0' }}>{d.comment}</p>}
              <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                {d.status !== 'in_transit' && d.status !== 'delivered' && (
                  <Button size="lg" variant="ghost" style={{ flex: 1, minHeight: 44 }} onClick={() => void mark(d, 'in_transit')}>
                    {t('delivery.mine.start')}
                  </Button>
                )}
                {d.status !== 'delivered' && (
                  <Button size="lg" style={{ flex: 1, minHeight: 44 }} onClick={() => void mark(d, 'delivered')}>
                    {t('delivery.mine.done')}
                  </Button>
                )}
                {d.status !== 'failed' && d.status !== 'delivered' && (
                  <Button size="lg" variant="ghost" style={{ flex: 1, minHeight: 44 }} onClick={() => { setReason(d.comment); setFailing(d); }}>
                    {t('delivery.mine.fail')}
                  </Button>
                )}
              </div>
            </section>
          ))}
          <p className="muted">{t('delivery.mine.total', { sum: fmtAmount(total) })}</p>
        </div>
      )}
      <Dialog open={!!failing} onOpenChange={o => !o && setFailing(null)}>
        <DialogContent
          size="sm"
          title={t('delivery.mine.failTitle')}
          description={t('delivery.mine.failHint')}
          footer={
            <>
              <span className="sp" />
              <Button variant="ghost" onClick={() => setFailing(null)}>
                {t('delivery.mine.cancel')}
              </Button>
              <Button
                onClick={async () => {
                  if (failing && (await mark(failing, 'failed', reason))) setFailing(null);
                }}
              >
                {t('delivery.mine.failConfirm')}
              </Button>
            </>
          }
        >
          <Field label={t('delivery.mine.comment')}>{p => <Textarea {...p} rows={3} value={reason} onChange={e => setReason(e.target.value)} />}</Field>
        </DialogContent>
      </Dialog>
    </div>
  );
}
