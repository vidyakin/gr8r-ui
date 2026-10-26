/* Остаток НЗП (задача 1137): что сделали промежуточные этапы и ещё не принял финальный этап.
   Группировка участок → заказ → изделие; на выбранную дату (по умолчанию сегодня), фильтр по участку.
   Суммы видят admin и owner — остальным сервер отдаёт null. */
import * as React from 'react';
import { Link } from 'react-router';
import { CircleAlert, Layers } from 'lucide-react';
import { Alert, Button, EmptyState, Field, Input, Select, Skeleton } from '@/components/ui';
import { fmtAmount, fmtNumber, useT } from '@/i18n';
import { fmtDate } from '../lib/dates';
import { useSnapshot } from './data';
import { useWipBalance } from './wip-data';

const ALL = 'all';
const today = () => new Date().toISOString().slice(0, 10);
/** Сумма или прочерк у роли без доступа к себестоимости */
const money = (v: string | null) => (v === null ? '—' : fmtAmount(v));

export function WipBalancePage() {
  const tt = useT();
  const [date, setDate] = React.useState(today());
  const [center, setCenter] = React.useState(ALL);
  const snap = useSnapshot();
  const wip = useWipBalance(date, center === ALL ? '' : center);
  const data = wip.data;
  const masked = !!data && data.total === null;

  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>{tt('production.wip.title')}</h1>
          <p>{tt('production.wip.subtitle')}</p>
        </div>
      </div>

      <section className="panel plain" style={{ margin: '0 var(--gutter) 16px' }}>
        <div className="row" style={{ gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Field label={tt('production.wip.date')}>{p => <Input {...p} type="date" value={date} onChange={e => setDate(e.target.value || today())} />}</Field>
          <Field label={tt('production.wip.workCenter')}>
            {p => (
              <Select
                id={p.id}
                value={center}
                onValueChange={setCenter}
                options={[{ value: ALL, label: tt('production.wip.allCenters') }, ...(snap.data?.workCenters ?? []).map(w => ({ value: w.id, label: w.name }))]}
                aria-label={tt('production.wip.workCenter')}
              />
            )}
          </Field>
        </div>
        {masked && <Alert tone="info" className="mt-3">{tt('production.wip.amountsRestricted')}</Alert>}
      </section>

      {wip.isError ? (
        <EmptyState icon={<CircleAlert size={20} />} error title={tt('production.wip.loadFailed')} action={<Button size="sm" onClick={() => wip.refetch()}>{tt('production.common.retry')}</Button>}>
          {(wip.error as Error).message}
        </EmptyState>
      ) : wip.isPending ? (
        <div style={{ padding: 16 }}>
          <Skeleton w="100%" h={36} />
        </div>
      ) : !data?.centers.length ? (
        <EmptyState icon={<Layers size={20} />} title={tt('production.wip.empty')}>
          {tt('production.wip.emptyHint')}
        </EmptyState>
      ) : (
        <section className="panel plain" style={{ margin: '0 var(--gutter) 24px' }}>
          <table className="dtbl" aria-label={tt('production.wip.table')}>
            <thead>
              <tr>
                <th>{tt('production.wip.product')}</th>
                <th>{tt('production.wip.stages')}</th>
                <th style={{ width: 110 }} className="r">{tt('production.wip.qty')}</th>
                <th style={{ width: 130 }} className="r">{tt('production.wip.amount')}</th>
              </tr>
            </thead>
            {data.centers.map(c => (
              <tbody key={c.workCenterId ?? 'none'}>
                <tr>
                  <th colSpan={4} style={{ textAlign: 'left', background: 'var(--surface-2, transparent)' }}>{c.workCenterName ?? tt('production.wip.noCenter')}</th>
                </tr>
                {c.orders.map(o => (
                  <React.Fragment key={o.orderId ?? 'direct'}>
                    <tr>
                      <td colSpan={3} className="muted" style={{ paddingLeft: 20 }}>
                        {o.orderId ? <Link to={`/production/orders/${o.orderId}`}>{o.number ?? tt('production.common.draft')}</Link> : tt('production.wip.order')}
                        {o.date ? ` · ${fmtDate(o.date)}` : ''}
                      </td>
                      <td className="r num muted">{money(o.amount)}</td>
                    </tr>
                    {o.items.map(i => (
                      <tr key={i.key}>
                        <td className="trunc" style={{ paddingLeft: 40 }}>{i.itemName}</td>
                        <td className="muted">{i.stages.map(s => `${s.name}: ${fmtNumber(s.done)}`).join(' · ')}</td>
                        <td className="r num">{fmtNumber(i.qty)}</td>
                        <td className="r num">{money(i.amount)}</td>
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
                <tr>
                  <td colSpan={3} className="r"><strong>{tt('production.wip.centerTotal', { name: c.workCenterName ?? tt('production.wip.noCenter') })}</strong></td>
                  <td className="r num"><strong>{money(c.amount)}</strong></td>
                </tr>
              </tbody>
            ))}
            <tfoot>
              <tr>
                <td colSpan={3} className="r"><strong>{tt('production.wip.total')}</strong></td>
                <td className="r num"><strong>{money(data.total)}</strong></td>
              </tr>
            </tfoot>
          </table>
        </section>
      )}
    </div>
  );
}
