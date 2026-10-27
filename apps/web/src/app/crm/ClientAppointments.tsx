/* Вкладка «Записи» у контакта и компании (задача 1171): будущие и прошлые записи, неявки; из неё можно записать клиента. */
import * as React from 'react';
import { Badge, Button, EmptyState, Skeleton } from '@/components/ui';
import { CalendarCheck, Plus } from 'lucide-react';
import { fmtAmount, fmtDateTimeIntl, useT } from '@/i18n';
import { useCanWrite } from '../meta/custom-fields';
import { parse } from '../lib/dates';
import { ApptDialog, BookDialog, fmtMin, isoToday, STATUS_TONE } from './appointments-ui';
import { useClientAppointments, type Appt } from './appointments-data';

export function ClientAppointments({ contactId, companyId }: { contactId?: string; companyId?: string }) {
  const t = useT();
  const canWrite = useCanWrite();
  const q = useClientAppointments({ ...(contactId ? { contactId } : {}), ...(companyId ? { companyId } : {}) });
  const [book, setBook] = React.useState(false);
  const [card, setCard] = React.useState<Appt | null>(null);
  const today = isoToday();
  const items = q.data ?? [];
  const noShows = items.filter(a => a.status === 'no_show').length;
  const upcoming = items.filter(a => a.date >= today && (a.status === 'booked' || a.status === 'confirmed'));
  const past = items.filter(a => !upcoming.includes(a)).reverse();
  const group = (title: string, list: Appt[]) =>
    list.length > 0 && (
      <section>
        <h4 style={{ margin: '12px 0 4px', fontSize: 13 }}>{title}</h4>
        {list.map(a => (
          <button key={a.id} type="button" className="row" onClick={() => setCard(a)} style={{ width: '100%', gap: 10, minHeight: 36, fontSize: 13, background: 'none', border: 0, textAlign: 'left', cursor: 'pointer', flexWrap: 'wrap' }}>
            <span className="num">{fmtDateTimeIntl(parse(a.date), { dateStyle: 'medium' })} {fmtMin(a.startMin)}</span>
            <span className="grow trunc" style={{ flex: 1 }}>{a.productName} · {a.specialistName}</span>
            <span className="num muted">{fmtAmount(a.price)}</span>
            <Badge tone={STATUS_TONE[a.status]} dot>{t(`appt.status.${a.status}`)}</Badge>
          </button>
        ))}
      </section>
    );
  return (
    <div style={{ padding: '0 0 12px' }}>
      <div className="row" style={{ gap: 12, alignItems: 'center', margin: '8px 0' }}>
        <strong style={{ fontSize: 13 }}>{t('appt.client.title')}</strong>
        {noShows > 0 && <Badge tone="red">{t('appt.client.noShows', { count: noShows })}</Badge>}
        <span style={{ flex: 1 }} />
        {canWrite && <Button size="sm" onClick={() => setBook(true)}><Plus size={13} /> {t('appt.page.new')}</Button>}
      </div>
      {q.isPending ? <Skeleton w="100%" h={60} /> : !items.length ? <EmptyState icon={<CalendarCheck size={20} />} title={t('appt.client.empty')}>{t('appt.client.emptyHint')}</EmptyState> : <>{group(t('appt.client.upcoming'), upcoming)}{group(t('appt.client.past'), past)}</>}
      {book && <BookDialog open onOpenChange={v => !v && setBook(false)} preset={{ ...(contactId ? { contactId } : {}), ...(companyId ? { companyId } : {}) }} />}
      <ApptDialog appt={card} onClose={() => setCard(null)} onMove={() => setCard(null)} />
    </div>
  );
}
