/* Документ «План продаж» (задача 1133): /crm/sales-plan/:id. Шапка: сценарий, начало, организация, склад, комментарий;
   строки: период сценария × значение разреза (менеджер, категория или товар), сумма без НДС, у товара — количество.
   Черновик правят admin и owner, проведённый план только читается. */
import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { dec, fmt, planDocPeriods } from '@gr8r/shared';
import { Badge, Button, EmptyState, Field, IconButton, Input, Select, Skeleton, toast } from '@/components/ui';
import { fmtAmount, useT } from '@/i18n';
import { errorMessage } from '../data/api';
import { useWorkspace } from '../data/store';
import { useCategories, useProducts } from '../catalog/data';
import { useOrganizations, useWarehouses } from '../docs/data';
import { useCanEditPlan, usePeriodLabel } from './SalesPlanPage';
import { usePlan, useSalesPlanMutation, useScenarios, type PlanDetail, type PlanLine } from './sales-plan-data';

const NONE = 'none';
type Row = { id?: string; periodStart: string; value: string; amount: string; qty: string };

export function SalesPlanDocumentPage() {
  const { id } = useParams();
  const q = usePlan(id);
  const tt = useT();
  if (q.isPending) return <div style={{ padding: 16 }}><Skeleton w="100%" h={160} /></div>;
  if (q.isError || !q.data) return <EmptyState icon={<ArrowLeft size={20} />} error title={tt('repeat.doc.notFound')}>{q.isError ? errorMessage(q.error) : ''}</EmptyState>;
  return <PlanForm key={`${q.data.id}${q.data.status}${q.dataUpdatedAt}`} plan={q.data} />;
}

const valueOf = (dimension: string, l: Pick<PlanLine, 'memberId' | 'categoryId' | 'productId'>) => (dimension === 'manager' ? l.memberId : dimension === 'category' ? l.categoryId : l.productId) ?? NONE;

function PlanForm({ plan }: { plan: PlanDetail }) {
  const tt = useT();
  const navigate = useNavigate();
  const label = usePeriodLabel();
  const canEdit = useCanEditPlan() && plan.status === 'draft';
  const scenarios = useScenarios();
  const orgs = useOrganizations();
  const whs = useWarehouses();
  const members = useWorkspace().data.members.filter(m => m.status === 'active');
  const cats = useCategories();
  const prods = useProducts({ active: true });
  const save = useSalesPlanMutation<PlanDetail>('PATCH');
  const act = useSalesPlanMutation<PlanDetail>('POST');
  const del = useSalesPlanMutation<unknown>('DELETE');

  const [scenarioId, setScenarioId] = React.useState(plan.scenario.id);
  const [start, setStart] = React.useState(plan.periodStart);
  const [org, setOrg] = React.useState(plan.organizationId);
  const [wh, setWh] = React.useState(plan.warehouseId ?? NONE);
  const [comment, setComment] = React.useState(plan.comment);
  const [rows, setRows] = React.useState<Row[]>(plan.lines.map(l => ({ ...(l.id ? { id: l.id } : {}), periodStart: l.periodStart, value: valueOf(plan.scenario.dimension, l), amount: String(Number(l.amount)), qty: String(Number(l.qty)) })));

  const scenario = (scenarios.data ?? []).find(s => s.id === scenarioId) ?? plan.scenario;
  const dimension = scenario.dimension;
  const periods = React.useMemo(() => planDocPeriods(scenario.periodicity, start || plan.periodStart).periods, [scenario.periodicity, start, plan.periodStart]);
  const options = dimension === 'manager' ? members.map(m => ({ value: m.id as string, label: m.name })) : dimension === 'category' ? (cats.data ?? []).map(c => ({ value: c.id, label: c.name })) : (prods.data ?? []).map(p => ({ value: p.id, label: p.name }));
  const valueOptions = [{ value: NONE, label: tt('repeat.doc.noValue') }, ...options];
  const total = rows.reduce((s, r) => s + dec(r.amount || '0'), 0n);

  const setRow = (i: number, patch: Partial<Row>) => setRows(list => list.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const changedHead = scenarioId !== plan.scenario.id || planDocPeriods(scenario.periodicity, start || plan.periodStart).periods[0] !== plan.periodStart;
  const body = () => ({
    scenarioId,
    periodStart: start,
    organizationId: org,
    warehouseId: wh === NONE ? null : wh,
    comment,
    lines: rows.map(r => ({ ...(r.id && !changedHead ? { id: r.id } : {}), periodStart: r.periodStart, memberId: dimension === 'manager' && r.value !== NONE ? r.value : null, categoryId: dimension === 'category' && r.value !== NONE ? r.value : null, productId: dimension === 'product' && r.value !== NONE ? r.value : null, amount: r.amount || '0', qty: dimension === 'product' ? r.qty || '0' : '0' })),
  });
  const onSave = () => save.mutate({ path: `/plans/${plan.id}`, body: body() }, { onSuccess: () => toast(tt('repeat.doc.saved')), onError: e => toast.error(errorMessage(e)) });
  const onPost = () =>
    save.mutate(
      { path: `/plans/${plan.id}`, body: body() },
      { onSuccess: () => act.mutate({ path: `/plans/${plan.id}/post` }, { onSuccess: () => toast(tt('repeat.doc.posted')), onError: e => toast.error(errorMessage(e)) }), onError: e => toast.error(errorMessage(e)) },
    );
  const onScenario = (v: string) => {
    setScenarioId(v);
    setRows([]); // строки прежнего сценария не подходят
  };

  return (
    <div className="page" style={{ maxWidth: 1100 }}>
      <div className="ph">
        <div>
          <Link to="/crm/sales-plan" className="crm-link"><ArrowLeft size={13} /> {tt('repeat.doc.back')}</Link>
          <h1>{plan.number ?? tt('repeat.doc.title')}</h1>
          <p><Badge tone={plan.status === 'posted' ? 'green' : 'gray'}>{tt(`repeat.doc.status.${plan.status}`)}</Badge></p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          {canEdit && <Button size="sm" onClick={onSave} disabled={save.isPending}>{tt('repeat.doc.save')}</Button>}
          {canEdit && <Button size="sm" variant="primary" onClick={onPost} disabled={save.isPending || act.isPending}>{tt('repeat.doc.post')}</Button>}
          {useCanEditPlan() && plan.status === 'posted' && <Button size="sm" onClick={() => act.mutate({ path: `/plans/${plan.id}/unpost` }, { onSuccess: () => toast(tt('repeat.doc.unposted')), onError: e => toast.error(errorMessage(e)) })}>{tt('repeat.doc.unpost')}</Button>}
          {canEdit && <Button size="sm" variant="ghost" onClick={() => del.mutate({ path: `/plans/${plan.id}` }, { onSuccess: () => { toast(tt('repeat.doc.deleted')); navigate('/crm/sales-plan'); }, onError: e => toast.error(errorMessage(e)) })}>{tt('repeat.doc.delete')}</Button>}
        </div>
      </div>
      {!canEdit && <p className="muted" style={{ fontSize: 12.5, margin: '0 var(--gutter)' }}>{plan.status === 'posted' ? tt('repeat.doc.postedHint') : tt('repeat.doc.readOnly')}</p>}
      <section className="panel plain" style={{ margin: '0 var(--gutter) 16px' }}>
        <div className="row" style={{ gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Field label={tt('repeat.doc.scenario')}>
            {p => <Select id={p.id} value={scenarioId} disabled={!canEdit} onValueChange={onScenario} options={(scenarios.data ?? []).filter(s => !s.archivedAt || s.id === scenarioId).map(s => ({ value: s.id, label: s.name }))} aria-label={tt('repeat.doc.scenario')} />}
          </Field>
          <Field label={tt('repeat.doc.start')}>{p => <Input {...p} type="date" value={start} disabled={!canEdit} onChange={e => { setStart(e.target.value); setRows([]); }} />}</Field>
          <Field label={tt('repeat.doc.organization')}>
            {p => <Select id={p.id} value={org} disabled={!canEdit} onValueChange={setOrg} options={(orgs.data ?? []).map(o => ({ value: o.id, label: o.name }))} aria-label={tt('repeat.doc.organization')} />}
          </Field>
          <Field label={tt('repeat.doc.warehouse')}>
            {p => <Select id={p.id} value={wh} disabled={!canEdit} onValueChange={setWh} options={[{ value: NONE, label: tt('repeat.doc.anyWarehouse') }, ...(whs.data ?? []).map(w => ({ value: w.id, label: w.name }))]} aria-label={tt('repeat.doc.warehouse')} />}
          </Field>
          <Field label={tt('repeat.doc.comment')}>{p => <Input {...p} value={comment} disabled={!canEdit} maxLength={5000} onChange={e => setComment(e.target.value)} />}</Field>
        </div>
        {canEdit && changedHead && <p className="faint" style={{ margin: '8px 0 0', fontSize: 12 }}>{tt('repeat.doc.scenarioChanged')}</p>}
      </section>

      <div className="toolbar" style={{ margin: '0 var(--gutter)' }}>
        <strong>{tt('repeat.doc.lines')}</strong>
        <span className="sp" />
        {canEdit && (
          <>
            <Button size="sm" variant="ghost" onClick={() => setRows(list => [...list, ...periods.filter(p => !list.some(r => r.periodStart === p && r.value === NONE)).map(p => ({ periodStart: p, value: NONE, amount: '', qty: '' }))])}>{tt('repeat.doc.fillPeriods')}</Button>
            <Button size="sm" onClick={() => setRows(list => [...list, { periodStart: periods[0]!, value: NONE, amount: '', qty: '' }])}>
              <Plus size={13} />
              {tt('repeat.doc.addRow')}
            </Button>
          </>
        )}
      </div>
      <div style={{ overflowX: 'auto', padding: '0 var(--gutter) 16px' }}>
        <table className="tbl" aria-label={tt('repeat.doc.lines')}>
          <thead>
            <tr>
              <th>{tt('repeat.doc.period')}</th>
              <th>{tt(`repeat.scenario.dimensionName.${dimension}`)}</th>
              <th className="r">{tt('repeat.doc.amount')}</th>
              {dimension === 'product' && <th className="r">{tt('repeat.doc.qty')}</th>}
              {canEdit && <th />}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={`${r.id ?? 'new'}${i}`}>
                <td>
                  {canEdit ? <Select value={r.periodStart} onValueChange={v => setRow(i, { periodStart: v })} options={periods.map(p => ({ value: p, label: label(scenario.periodicity, p) }))} aria-label={tt('repeat.doc.period')} /> : label(scenario.periodicity, r.periodStart)}
                </td>
                <td>{canEdit ? <Select value={r.value} onValueChange={v => setRow(i, { value: v })} options={valueOptions} aria-label={tt(`repeat.scenario.dimensionName.${dimension}`)} /> : valueOptions.find(o => o.value === r.value)?.label}</td>
                <td className="r">{canEdit ? <Input type="number" min={0} step="0.01" style={{ width: 120, textAlign: 'right' }} value={r.amount} aria-label={tt('repeat.doc.amount')} onChange={e => setRow(i, { amount: e.target.value })} /> : <span className="num">{fmtAmount(r.amount)}</span>}</td>
                {dimension === 'product' && <td className="r">{canEdit ? <Input type="number" min={0} step="0.001" style={{ width: 100, textAlign: 'right' }} value={r.qty} aria-label={tt('repeat.doc.qty')} onChange={e => setRow(i, { qty: e.target.value })} /> : <span className="num">{r.qty}</span>}</td>}
                {canEdit && <td><IconButton label={tt('repeat.doc.removeRow')} onClick={() => setRows(list => list.filter((_, k) => k !== i))}><Trash2 size={14} /></IconButton></td>}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2}><strong>{tt('repeat.doc.total')}</strong></td>
              <td className="r num"><strong>{fmtAmount(fmt(total, 2))}</strong></td>
              {dimension === 'product' && <td />}
              {canEdit && <td />}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
