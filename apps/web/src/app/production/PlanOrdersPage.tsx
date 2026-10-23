/* Рабочее место «Заказы по плану»: период и строки утверждённых планов → черновики заказов на производство
   на остаток «план − уже заказано». Финиш заказа = дата выпуска, старт = дата запуска; повторный запуск не дублирует. */
import * as React from 'react';
import { Link, useNavigate } from 'react-router';
import { CircleAlert, ClipboardList, Factory } from 'lucide-react';
import { Badge, Button, EmptyState, Skeleton, toast } from '@/components/ui';
import { fmtDate, parse } from '../lib/dates';
import { useCanWrite } from '../meta/custom-fields';
import { useWorkCenters } from '../catalog/data';
import { usePlanWorkbench, useProductionPlanApi, type PlanLine } from './plans-data';
import { useT } from '@/i18n';

export function PlanOrdersPage() {
  const navigate = useNavigate();
  const canWrite = useCanWrite();
  const api = useProductionPlanApi();
  const tt = useT();
  const centers = useWorkCenters();
  const [period, setPeriod] = React.useState<string>('');
  const [center, setCenter] = React.useState<string>('');
  const [sel, setSel] = React.useState<Record<string, boolean>>({});
  const workbench = usePlanWorkbench({ periodStart: period || undefined, workCenterId: center || undefined });
  const rows = workbench.data?.items ?? [];
  const periods = [...new Set(rows.flatMap(r => r.periods))].sort();

  const selected = rows.flatMap(r => r.lines.filter(l => sel[`${r.plan.id}:${l.id}`]));
  const create = async () => {
    if (!selected.length) return;
    // группируем выбранные строки по плану и периоду: заказ на производство создаётся на каждую группу
    const grouped = new Map<string, { planId: string; periodStart: string; lineIds: string[] }>();
    for (const r of rows)
      for (const l of r.lines)
        if (sel[`${r.plan.id}:${l.id}`]) {
          const key = `${r.plan.id}:${l.periodStart}`;
          const cur = grouped.get(key) ?? { planId: r.plan.id, periodStart: l.periodStart, lineIds: [] };
          cur.lineIds.push(l.id);
          grouped.set(key, cur);
        }
    let created = 0;
    let skipped = 0;
    for (const g of grouped.values()) {
      const res = await api.orders.mutateAsync({ id: g.planId, periodStart: g.periodStart, lineIds: g.lineIds });
      created += res?.created.length ?? 0;
      skipped += res?.skipped.length ?? 0;
    }
    toast(tt('production.planOrders.result', { created, skipped }));
    setSel({});
  };

  const lineRow = (planId: string, l: PlanLine & { remainder: string }) => (
    <tr key={`${planId}:${l.id}`} data-row={Number(l.remainder) > 0 ? 'deficit' : undefined}>
      <td style={{ width: 34 }}>
        {Number(l.remainder) > 0 && canWrite && <input type="checkbox" className="check" aria-label={tt('production.planOrders.selectRow', { name: l.itemName })} checked={!!sel[`${planId}:${l.id}`]} onChange={() => setSel(s => ({ ...s, [`${planId}:${l.id}`]: !s[`${planId}:${l.id}`] }))} />}
      </td>
      <td className="trunc">{l.itemName}</td>
      <td className="num muted">{fmtDate(parse(l.periodStart))}</td>
      <td className="r num">{l.qty}</td>
      <td className="r num">{l.ordered}</td>
      <td className="r num">
        {Number(l.remainder) > 0 ? <Badge tone="amber" dot>{l.remainder}</Badge> : <span className="faint">—</span>}
      </td>
      <td className="num muted">{fmtDate(parse(l.startDate))}</td>
    </tr>
  );

  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>{tt('production.planOrders.title')}</h1>
          <p>{tt('production.planOrders.subtitle')}</p>
        </div>
        <div className="acts">
          <Button onClick={() => navigate('/production/plans')}>{tt('production.planOrders.toPlans')}</Button>
          {canWrite && (
            <Button variant="primary" disabled={!selected.length} onClick={() => void create()}>
              <ClipboardList size={14} />
              {tt('production.planOrders.createOrders')}
            </Button>
          )}
        </div>
      </div>
      <div className="panel" style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <label className="fld" style={{ maxWidth: 200 }}>
          <span className="lbl">{tt('production.planOrders.period')}</span>
          <select className="select" aria-label={tt('production.planOrders.period')} value={period} onChange={e => setPeriod(e.target.value)}>
            <option value="">{tt('production.planOrders.allPeriods')}</option>
            {periods.map(p => (
              <option key={p} value={p}>
                {fmtDate(parse(p))}
              </option>
            ))}
          </select>
        </label>
        <label className="fld" style={{ maxWidth: 220 }}>
          <span className="lbl">{tt('production.planOrders.workCenter')}</span>
          <select className="select" aria-label={tt('production.planOrders.workCenter')} value={center} onChange={e => setCenter(e.target.value)}>
            <option value="">{tt('production.planOrders.anyWorkCenter')}</option>
            {(centers.data?.items ?? []).map(c => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {workbench.isError ? (
        <EmptyState icon={<CircleAlert size={20} />} error title={tt('production.planOrders.loadFailed')} action={<Button size="sm" onClick={() => workbench.refetch()}>{tt('production.common.retry')}</Button>}>
          {(workbench.error as Error).message}
        </EmptyState>
      ) : workbench.isPending ? (
        <div style={{ padding: 16 }}>
          <Skeleton w="100%" h={36} />
        </div>
      ) : !rows.length ? (
        <EmptyState icon={<Factory size={20} />} title={tt('production.planOrders.noApproved')}>
          {tt('production.planOrders.noApprovedHint')}
        </EmptyState>
      ) : (
        rows.map(r => (
          <section key={r.plan.id} className="panel" aria-label={r.plan.name}>
            <div className="ph" style={{ padding: '12px 14px 8px' }}>
              <div>
                <h2 style={{ fontSize: 15 }}>
                  <Link to={`/production/plans/${r.plan.id}`} className="crm-link">
                    {r.plan.name}
                  </Link>
                </h2>
                <span className="faint" style={{ fontSize: 12 }}>
                  {r.plan.warehouseName}
                  {r.plan.workCenterId ? ` · ${centers.data?.items.find(c => c.id === r.plan.workCenterId)?.name ?? ''}` : ''}
                </span>
              </div>
            </div>
            <div className="table-wrap">
              <table className="dtbl" aria-label={r.plan.name}>
                <thead>
                  <tr>
                    <th style={{ width: 34 }} />
                    <th>{tt('production.planOrders.col.product')}</th>
                    <th style={{ width: 110 }}>{tt('production.planOrders.col.period')}</th>
                    <th style={{ width: 90 }} className="r">
                      {tt('production.planOrders.col.planned')}
                    </th>
                    <th style={{ width: 90 }} className="r">
                      {tt('production.planOrders.col.ordered')}
                    </th>
                    <th style={{ width: 100 }} className="r">
                      {tt('production.planOrders.col.left')}
                    </th>
                    <th style={{ width: 110 }}>{tt('production.planOrders.col.start')}</th>
                  </tr>
                </thead>
                <tbody>{r.lines.map(l => lineRow(r.plan.id, l))}</tbody>
              </table>
            </div>
          </section>
        ))
      )}
    </div>
  );
}
