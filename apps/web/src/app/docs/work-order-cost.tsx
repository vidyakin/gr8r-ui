/* Вкладка «Себестоимость» карточки заказ-наряда (задача 1096): план и факт по видам затрат, труд по исполнителям,
   материалы и товары, выручка и маржа. Только admin и owner. Себестоимость «живая»: считается сервером при каждом запросе. */
import { CircleAlert } from 'lucide-react';
import { Alert, Badge, EmptyState, Skeleton } from '@/components/ui';
import { fmtAmount, fmtNumber, useT } from '@/i18n';
import { errorMessage } from '../data/api';
import { useWorkOrderCost, type WorkOrderCostItemView } from './data';

const pct = (v: string | null) => (v === null ? '—' : `${fmtNumber(v)} %`);

export function WorkOrderCostPanel({ documentId }: { documentId: string }) {
  const t = useT();
  const q = useWorkOrderCost(documentId, true);
  if (q.isError) return <EmptyState icon={<CircleAlert size={20} />} error title={t('docs.workOrders.cost.loadFailed')}>{errorMessage(q.error)}</EmptyState>;
  if (q.isPending) return <div style={{ padding: 16 }}><Skeleton w="100%" h={36} /></div>;
  const c = q.data;
  const items: WorkOrderCostItemView[] = [...c.materials.rows, ...c.goods.rows];
  const est = <Badge tone="amber">{t('docs.workOrders.cost.estimated')}</Badge>;
  const kinds: { id: string; label: string; plan: string; fact: string; estimated?: boolean }[] = [
    { id: 'labor', label: t('docs.workOrders.cost.labor'), ...c.labor },
    { id: 'materials', label: t('docs.workOrders.cost.materials'), plan: c.materials.plan, fact: c.materials.fact, estimated: c.materials.estimated },
    { id: 'goods', label: t('docs.workOrders.cost.goods'), plan: c.goods.plan, fact: c.goods.fact, estimated: c.goods.estimated },
    { id: 'other', label: t('docs.workOrders.cost.otherCosts'), ...c.other },
    { id: 'indirect', label: t('docs.workOrders.cost.indirect'), ...c.indirect },
  ];
  return (
    <section className="doc-lines panel" aria-label={t('docs.workOrders.cost.aria')}>
      {c.warnings.map(w => (
        <Alert key={w.kind} tone="warn">{t('docs.workOrders.cost.noCenter', { hours: fmtNumber(Number(w.actualHours) > 0 ? w.actualHours : w.plannedHours) })}</Alert>
      ))}
      {c.estimated && <Alert tone="info">{t('docs.workOrders.cost.estimatedHint')}</Alert>}
      <div className="table-wrap">
        <table className="dtbl" aria-label={t('docs.workOrders.cost.aria')}>
          <thead>
            <tr>
              <th>{t('docs.workOrders.cost.kind')}</th>
              <th style={{ width: 140 }} className="r">{t('docs.workOrders.cost.plan')}</th>
              <th style={{ width: 160 }} className="r">{t('docs.workOrders.cost.fact')}</th>
            </tr>
          </thead>
          <tbody>
            {kinds.map(k => (
              <tr key={k.id}>
                <td>{k.label}</td>
                <td className="r num">{fmtAmount(k.plan)}</td>
                <td className="r num">{k.estimated && est} {fmtAmount(k.fact)}</td>
              </tr>
            ))}
            <tr>
              <td><strong>{t('docs.workOrders.cost.cost')}</strong></td>
              <td className="r num"><strong>{fmtAmount(c.cost.plan)}</strong></td>
              <td className="r num"><strong>{fmtAmount(c.cost.fact)}</strong></td>
            </tr>
            <tr>
              <td>{t('docs.workOrders.cost.revenue')}</td>
              <td className="r num">{fmtAmount(c.revenue)}</td>
              <td className="r num">{fmtAmount(c.revenue)}</td>
            </tr>
            <tr>
              <td><strong>{t('docs.workOrders.cost.margin')}</strong></td>
              <td className="r num"><strong>{fmtAmount(c.margin.plan)}</strong></td>
              <td className="r num"><strong>{fmtAmount(c.margin.fact)}</strong></td>
            </tr>
            <tr>
              <td>{t('docs.workOrders.cost.marginPct')}</td>
              <td className="r num">{pct(c.marginPct.plan)}</td>
              <td className="r num">{pct(c.marginPct.fact)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {c.indirectMonths.length > 0 && <p className="muted" style={{ margin: '8px 12px', fontSize: 12 }}>{t('docs.workOrders.cost.indirectMonths', { months: c.indirectMonths.join(', ') })}</p>}

      {c.labor.rows.length > 0 && (
        <>
          <h3 style={{ margin: '16px 12px 8px', fontSize: 13 }}>{t('docs.workOrders.cost.laborTitle')}</h3>
          <div className="table-wrap">
            <table className="dtbl" aria-label={t('docs.workOrders.cost.laborTitle')}>
              <thead>
                <tr>
                  <th>{t('docs.workOrders.cost.assignee')}</th>
                  <th>{t('docs.workOrders.cost.center')}</th>
                  <th style={{ width: 110 }} className="r">{t('docs.workOrders.cost.rate')}</th>
                  <th style={{ width: 90 }} className="r">{t('docs.workOrders.cost.planHours')}</th>
                  <th style={{ width: 90 }} className="r">{t('docs.workOrders.cost.factHours')}</th>
                  <th style={{ width: 120 }} className="r">{t('docs.workOrders.cost.planAmount')}</th>
                  <th style={{ width: 120 }} className="r">{t('docs.workOrders.cost.factAmount')}</th>
                </tr>
              </thead>
              <tbody>
                {c.labor.rows.map(r => (
                  <tr key={`${r.assigneeId ?? ''}:${r.workCenterId ?? ''}`}>
                    <td>{r.assigneeName ?? t('docs.workOrders.cost.noAssignee')}</td>
                    <td>{r.workCenterName ?? '—'}</td>
                    <td className="r num">{r.rate === null ? '—' : fmtAmount(r.rate)}</td>
                    <td className="r num">{fmtNumber(r.plannedHours)}</td>
                    <td className="r num">{fmtNumber(r.actualHours)}</td>
                    <td className="r num">{fmtAmount(r.planAmount)}</td>
                    <td className="r num">{fmtAmount(r.factAmount)}</td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={3}><strong>{t('docs.workOrders.cost.labor')}</strong></td>
                  <td className="r num"><strong>{fmtNumber(c.labor.plannedHours)}</strong></td>
                  <td className="r num"><strong>{fmtNumber(c.labor.actualHours)}</strong></td>
                  <td className="r num"><strong>{fmtAmount(c.labor.plan)}</strong></td>
                  <td className="r num"><strong>{fmtAmount(c.labor.fact)}</strong></td>
                </tr>
              </tbody>
            </table>
          </div>
        </>
      )}

      {items.length > 0 && (
        <>
          <h3 style={{ margin: '16px 12px 8px', fontSize: 13 }}>{t('docs.workOrders.cost.itemsTitle')}</h3>
          <div className="table-wrap">
            <table className="dtbl" aria-label={t('docs.workOrders.cost.itemsTitle')}>
              <thead>
                <tr>
                  <th>{t('docs.workOrders.cost.item')}</th>
                  <th style={{ width: 100 }} className="r">{t('docs.workOrders.cost.qty')}</th>
                  <th style={{ width: 120 }} className="r">{t('docs.workOrders.cost.planAmount')}</th>
                  <th style={{ width: 160 }} className="r">{t('docs.workOrders.cost.factAmount')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map(i => (
                  <tr key={i.key}>
                    <td>{i.name}</td>
                    <td className="r num">{fmtNumber(i.qty)}</td>
                    <td className="r num">{fmtAmount(i.planCost)}</td>
                    <td className="r num">{i.estimated && est} {fmtAmount(i.factCost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <p className="muted" style={{ margin: '8px 12px 12px', fontSize: 12 }}>{t('docs.workOrders.cost.servicesNote')}</p>
    </section>
  );
}
