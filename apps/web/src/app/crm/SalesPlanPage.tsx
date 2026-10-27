/* Планирование продаж (задача 1133): /crm/sales-plan. Вкладки: «Планы» (журнал документов «План продаж»), «План-факт»
   (План-фактный анализ продаж по сценарию: график, таблица с группировкой, CSV) и «Сценарии» (справочник «Сценарии планирования»).
   Документы и сценарии правят admin и owner, видят все. */
import * as React from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { CircleAlert, FilePlus, FileText, Plus } from 'lucide-react';
import { dec, fmt, div, mul } from '@gr8r/shared';
import { Badge, Button, EmptyState, Field, Input, Select, Skeleton, toast } from '@/components/ui';
import { fmtAmount, fmtNumber, monthShort, useT } from '@/i18n';
import { errorMessage } from '../data/api';
import { useSession } from '../data/session';
import { fmtDate, today } from '../lib/dates';
import { useOrganizations, useWarehouses } from '../docs/data';
import { BarChart, type BarGroup } from '../production/reports/BarChart';
import { ReportTable, type GroupLevel, type ReportColumn } from '../production/reports/ReportTable';
import { ChartPanel, ReportState } from '../production/reports/shared';
import { useAnalysis, usePlans, useSalesPlanMutation, useScenarios, type PlanDetail, type PlanFactCell, type Periodicity, type SalesPlanDimension, type Scenario } from './sales-plan-data';

const ALL = 'all';

export const useCanEditPlan = () => {
  const { active } = useSession();
  return active?.role === 'owner' || active?.role === 'admin';
};

/** Подпись периода сценария: «окт. 2027», «4 кв. 2027», «2027 г.» */
export function usePeriodLabel() {
  const t = useT();
  return (periodicity: Periodicity, start: string) => {
    const [y, m] = start.split('-').map(Number) as [number, number];
    if (periodicity === 'month') return `${monthShort(m - 1)} ${y}`;
    if (periodicity === 'quarter') return t('repeat.plan.quarter', { n: Math.floor((m - 1) / 3) + 1, year: y });
    return t('repeat.plan.year', { year: y });
  };
}

export function SalesPlanPage() {
  const tt = useT();
  const [sp, setSp] = useSearchParams();
  const tab = (['plans', 'analysis', 'scenarios'] as const).find(x => x === sp.get('tab')) ?? 'plans';
  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>{tt('repeat.plan.title')}</h1>
          <p>{tt('repeat.plan.subtitle')}</p>
        </div>
      </div>
      <nav className="tabs doc-tabs" aria-label={tt('repeat.plan.tabs')}>
        {(['plans', 'analysis', 'scenarios'] as const).map(id => (
          <button key={id} type="button" className={`tab${id === tab ? ' on' : ''}`} aria-current={id === tab ? 'page' : undefined} onClick={() => setSp({ tab: id }, { replace: true })}>
            {tt(`repeat.plan.tab.${id}`)}
          </button>
        ))}
      </nav>
      {tab === 'plans' ? <PlansTab /> : tab === 'analysis' ? <AnalysisTab /> : <ScenariosTab />}
    </div>
  );
}

/* ---------------- журнал планов ---------------- */

function PlansTab() {
  const tt = useT();
  const navigate = useNavigate();
  const canEdit = useCanEditPlan();
  const q = usePlans();
  const scenarios = useScenarios();
  const create = useSalesPlanMutation<PlanDetail>('POST');
  const active = (scenarios.data ?? []).filter(s => !s.archivedAt);
  const onNew = () => {
    const first = active[0];
    if (!first) return toast.error(tt('repeat.doc.list.needScenario'));
    create.mutate({ path: '/plans', body: { scenarioId: first.id, periodStart: `${new Date().getFullYear()}-01-01`, lines: [] } }, { onSuccess: d => navigate(`/crm/sales-plan/${d.id}`), onError: e => toast.error(errorMessage(e)) });
  };
  return (
    <>
      <div className="toolbar" style={{ margin: '0 var(--gutter)' }}>
        {!canEdit && <span className="muted" style={{ fontSize: 12.5 }}>{tt('repeat.doc.readOnly')}</span>}
        <span className="sp" />
        {canEdit && (
          <Button size="sm" variant="primary" onClick={onNew} disabled={create.isPending}>
            <Plus size={13} />
            {tt('repeat.doc.list.new')}
          </Button>
        )}
      </div>
      <ReportState q={q} isEmpty={d => !d.items.length}>
        {d => (
          <div style={{ overflowX: 'auto', padding: '0 var(--gutter) 16px' }}>
            <table className="tbl" aria-label={tt('repeat.plan.title')}>
              <thead>
                <tr>
                  <th>{tt('repeat.doc.list.col.number')}</th>
                  <th>{tt('repeat.doc.list.col.scenario')}</th>
                  <th>{tt('repeat.doc.list.col.start')}</th>
                  <th className="r">{tt('repeat.doc.list.col.total')}</th>
                  <th>{tt('repeat.doc.list.col.status')}</th>
                  <th>{tt('repeat.doc.list.col.comment')}</th>
                </tr>
              </thead>
              <tbody>
                {d.items.map(p => (
                  <tr key={p.id}>
                    <td><Link className="crm-link" to={`/crm/sales-plan/${p.id}`}>{p.number ?? tt('repeat.doc.title')}</Link></td>
                    <td>{p.scenarioName}</td>
                    <td className="num">{fmtDate(p.periodStart, true)}</td>
                    <td className="r num">{fmtAmount(p.total)}</td>
                    <td><Badge tone={p.status === 'posted' ? 'green' : 'gray'}>{tt(`repeat.doc.status.${p.status}`)}</Badge></td>
                    <td className="muted">{p.comment}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ReportState>
      {q.data && !q.data.items.length && (
        <EmptyState icon={<FileText size={20} />} title={tt('repeat.doc.list.empty')} action={canEdit ? <Button size="sm" variant="primary" onClick={onNew}><FilePlus size={14} />{tt('repeat.doc.list.new')}</Button> : undefined}>
          {tt('repeat.doc.list.emptyHint')}
        </EmptyState>
      )}
    </>
  );
}

/* ---------------- сценарии ---------------- */

function ScenariosTab() {
  const tt = useT();
  const canEdit = useCanEditPlan();
  const q = useScenarios();
  const create = useSalesPlanMutation<Scenario>('POST');
  const archive = useSalesPlanMutation<unknown>('DELETE');
  const [name, setName] = React.useState('');
  const [periodicity, setPeriodicity] = React.useState<Periodicity>('month');
  const [dimension, setDimension] = React.useState<SalesPlanDimension>('manager');
  const rows = (q.data ?? []).filter(s => !s.archivedAt);
  const onAdd = () =>
    create.mutate({ path: '/scenarios', body: { name: name.trim(), periodicity, dimension } }, { onSuccess: () => { setName(''); toast(tt('repeat.scenario.created')); }, onError: e => toast.error(errorMessage(e)) });
  return (
    <div style={{ padding: '0 var(--gutter) 16px' }}>
      <p className="muted" style={{ fontSize: 12.5 }}>{tt('repeat.scenario.hint')}</p>
      {!canEdit && <p className="muted" style={{ fontSize: 12.5 }}>{tt('repeat.scenario.readOnly')}</p>}
      {canEdit && (
        <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 16 }}>
          <Field label={tt('repeat.scenario.name')}>{p => <Input {...p} value={name} maxLength={200} placeholder={tt('repeat.scenario.namePlaceholder')} onChange={e => setName(e.target.value)} />}</Field>
          <Field label={tt('repeat.scenario.periodicity')}>
            {p => <Select id={p.id} value={periodicity} onValueChange={v => setPeriodicity(v as Periodicity)} options={(['month', 'quarter', 'year'] as const).map(v => ({ value: v, label: tt(`repeat.scenario.periodicityName.${v}`) }))} aria-label={tt('repeat.scenario.periodicity')} />}
          </Field>
          <Field label={tt('repeat.scenario.dimension')}>
            {p => <Select id={p.id} value={dimension} onValueChange={v => setDimension(v as SalesPlanDimension)} options={(['manager', 'category', 'product'] as const).map(v => ({ value: v, label: tt(`repeat.scenario.dimensionName.${v}`) }))} aria-label={tt('repeat.scenario.dimension')} />}
          </Field>
          <Button size="sm" variant="primary" disabled={!name.trim() || create.isPending} onClick={onAdd}>
            <Plus size={13} />
            {tt('repeat.scenario.add')}
          </Button>
        </div>
      )}
      {q.isPending ? (
        <Skeleton w="100%" h={80} />
      ) : !rows.length ? (
        <EmptyState icon={<FileText size={20} />} title={tt('repeat.scenario.empty')} />
      ) : (
        <table className="tbl" aria-label={tt('repeat.scenario.title')}>
          <thead>
            <tr>
              <th>{tt('repeat.scenario.name')}</th>
              <th>{tt('repeat.scenario.periodicity')}</th>
              <th>{tt('repeat.scenario.dimension')}</th>
              {canEdit && <th />}
            </tr>
          </thead>
          <tbody>
            {rows.map(s => (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td>{tt(`repeat.scenario.periodicityName.${s.periodicity}`)}</td>
                <td>{tt(`repeat.scenario.dimensionName.${s.dimension}`)}</td>
                {canEdit && (
                  <td className="r">
                    <Button size="sm" variant="ghost" onClick={() => archive.mutate({ path: `/scenarios/${s.id}` }, { onSuccess: () => toast(tt('repeat.scenario.archived')), onError: e => toast.error(errorMessage(e)) })}>{tt('repeat.scenario.archive')}</Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* ---------------- план-фактный анализ ---------------- */

interface FactRow extends PlanFactCell {
  key: string | null;
  valueName: string;
  periodIndex: number;
  period: string;
}

const money = { format: (v: string) => fmtAmount(v), scale: 2 };
const qtyTotal = { format: (v: string) => fmtNumber(v, { maximumFractionDigits: 3 }), scale: 3 };
const pctText = (v: string | null) => (v === null ? '—' : `${fmtNumber(v, { maximumFractionDigits: 1 })} %`);
const pctOf = (rows: FactRow[]) => {
  const plan = rows.reduce((s, r) => s + dec(r.plan), 0n);
  const fact = rows.reduce((s, r) => s + dec(r.fact), 0n);
  return plan > 0n ? fmt(div(mul(fact, dec('100')), plan), 1) : null;
};

function AnalysisTab() {
  const tt = useT();
  const label = usePeriodLabel();
  const scenarios = useScenarios();
  const orgs = useOrganizations();
  const whs = useWarehouses();
  const plans = usePlans();
  const list = (scenarios.data ?? []).filter(s => !s.archivedAt);
  const [scenarioId, setScenarioId] = React.useState('');
  // по умолчанию — сценарий последнего проведённого плана, иначе первый
  const lastPosted = plans.data?.items.find(p => p.status === 'posted')?.scenarioId;
  const [from, setFrom] = React.useState(`${today().getFullYear()}-01-01`);
  const [to, setTo] = React.useState(`${today().getFullYear()}-12-31`);
  const [warehouse, setWarehouse] = React.useState(ALL);
  const [org, setOrg] = React.useState(ALL);
  const sid = scenarioId || list.find(s => s.id === lastPosted)?.id || list[0]?.id || '';
  const q = useAnalysis(sid ? { scenarioId: sid, from, to, warehouseId: warehouse === ALL ? undefined : warehouse, organizationId: org === ALL ? undefined : org } : null);
  const scenario = list.find(s => s.id === sid);
  const dim = scenario?.dimension ?? 'manager';

  const columns: ReportColumn<FactRow>[] = [
    { id: 'period', header: tt('repeat.fact.col.period'), value: r => r.period, render: r => (scenario ? label(scenario.periodicity, r.period) : r.period) },
    { id: 'plan', header: tt('repeat.fact.col.plan'), align: 'r', value: r => r.plan, render: r => fmtAmount(r.plan), total: money },
    ...(dim === 'product' ? [{ id: 'planQty', header: tt('repeat.fact.col.planQty'), align: 'r' as const, value: (r: FactRow) => r.planQty, render: (r: FactRow) => fmtNumber(r.planQty, { maximumFractionDigits: 3 }), total: qtyTotal }] : []),
    { id: 'fact', header: tt('repeat.fact.col.fact'), align: 'r', value: r => r.fact, render: r => <strong>{fmtAmount(r.fact)}</strong>, total: money },
    ...(dim === 'product' ? [{ id: 'factQty', header: tt('repeat.fact.col.factQty'), align: 'r' as const, value: (r: FactRow) => r.factQty, render: (r: FactRow) => fmtNumber(r.factQty, { maximumFractionDigits: 3 }), total: qtyTotal }] : []),
    { id: 'pct', header: tt('repeat.fact.col.pct'), align: 'r', value: r => r.pct ?? '', render: r => pctText(r.pct), total: rows => pctText(pctOf(rows)), totalCsv: pctOf },
    { id: 'deviation', header: tt('repeat.fact.col.deviation'), align: 'r', value: r => r.deviation, render: r => fmtAmount(r.deviation), total: money },
    ...(dim === 'manager'
      ? [
          { id: 'won', header: tt('repeat.fact.col.won'), align: 'r' as const, value: (r: FactRow) => r.forecastWon, render: (r: FactRow) => fmtAmount(r.forecastWon), total: money },
          { id: 'forecast', header: tt('repeat.fact.col.forecast'), align: 'r' as const, value: (r: FactRow) => r.forecast, render: (r: FactRow) => fmtAmount(r.forecast), total: money },
          { id: 'weighted', header: tt('repeat.fact.col.weighted'), align: 'r' as const, value: (r: FactRow) => r.forecastWeighted, render: (r: FactRow) => fmtAmount(r.forecastWeighted), total: money },
        ]
      : []),
  ];
  const groups: GroupLevel<FactRow>[] = [{ key: r => r.key ?? '', label: rows => rows[0]!.valueName, csv: rows => rows[0]!.valueName, csvHeader: tt('repeat.fact.col.value') }];

  return (
    <>
      <section className="panel plain" style={{ margin: '0 var(--gutter) 16px' }}>
        <div className="row" style={{ gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Field label={tt('repeat.fact.scenario')}>
            {p => <Select id={p.id} value={sid} onValueChange={setScenarioId} options={list.map(s => ({ value: s.id, label: s.name }))} placeholder={tt('repeat.fact.pickScenario')} aria-label={tt('repeat.fact.scenario')} />}
          </Field>
          <Field label={tt('repeat.fact.from')}>{p => <Input {...p} type="date" value={from} max={to} onChange={e => setFrom(e.target.value || from)} />}</Field>
          <Field label={tt('repeat.fact.to')}>{p => <Input {...p} type="date" value={to} min={from} onChange={e => setTo(e.target.value || to)} />}</Field>
          <Field label={tt('repeat.fact.warehouse')}>
            {p => <Select id={p.id} value={warehouse} onValueChange={setWarehouse} options={[{ value: ALL, label: tt('repeat.fact.all') }, ...(whs.data ?? []).map(w => ({ value: w.id, label: w.name }))]} aria-label={tt('repeat.fact.warehouse')} />}
          </Field>
          <Field label={tt('repeat.fact.organization')}>
            {p => <Select id={p.id} value={org} onValueChange={setOrg} options={[{ value: ALL, label: tt('repeat.fact.all') }, ...(orgs.data ?? []).map(o => ({ value: o.id, label: o.name }))]} aria-label={tt('repeat.fact.organization')} />}
          </Field>
        </div>
      </section>
      {!sid ? (
        <EmptyState icon={<CircleAlert size={20} />} title={tt('repeat.fact.pickScenario')} />
      ) : (
        <ReportState q={q} isEmpty={d => !d.rows.length}>
          {d => {
            const rows: FactRow[] = d.rows.flatMap(r =>
              r.periods.map((c, i) => ({ ...c, key: r.key, valueName: r.name ?? tt(`repeat.fact.noValue.${d.scenario.dimension}`), periodIndex: i, period: d.periods[i]! })).filter(c => dec(c.plan) !== 0n || dec(c.fact) !== 0n || dec(c.forecast) !== 0n || dec(c.planQty) !== 0n || dec(c.factQty) !== 0n),
            );
            const chart: BarGroup[] = d.totals.map((c, i) => ({ label: label(d.scenario.periodicity, d.periods[i]!), values: { plan: Number(c.plan), fact: Number(c.fact), forecast: Number(c.forecastWeighted) } }));
            return (
              <>
                <p className="muted" style={{ margin: '0 var(--gutter) 8px', fontSize: 12 }}>{tt('repeat.fact.hint')}</p>
                <ChartPanel title={tt('repeat.fact.chart')}>
                  <BarChart groups={chart} title={tt('repeat.fact.chart')} series={[{ id: 'plan', label: tt('repeat.fact.series.plan'), color: 'var(--blue)' }, { id: 'fact', label: tt('repeat.fact.series.fact'), color: 'var(--green)' }, ...(d.scenario.dimension === 'manager' ? [{ id: 'forecast', label: tt('repeat.fact.series.forecast'), color: 'var(--amber)' }] : [])]} />
                </ChartPanel>
                <ReportTable rows={rows} columns={columns} groups={groups} rowKey={r => `${r.key ?? ''}|${r.period}`} filename={`sales-plan-analysis-${d.from}`} label={tt('repeat.plan.tab.analysis')} />
              </>
            );
          }}
        </ReportState>
      )}
    </>
  );
}
