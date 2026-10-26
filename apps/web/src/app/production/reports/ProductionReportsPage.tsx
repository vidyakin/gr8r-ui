/* Отчёты производства (задача 1091): один экран /production/reports, вкладка — в адресе (?tab=).
   Общие отборы: период, участок, изделие (где вкладка их использует). Чтобы добавить отчёт, допишите вкладку в REPORT_TABS. */
import * as React from 'react';
import { useSearchParams } from 'react-router';
import { Field, Input, Select } from '@/components/ui';
import { useT, type TKey } from '@/i18n';
import { iso, today } from '../../lib/dates';
import { useSnapshot } from '../data';
import { BomTab } from './BomTab';
import { CostPlanFactTab } from './CostPlanFactTab';
import { LoadTab } from './LoadTab';
import { OrdersTab } from './OrdersTab';
import { PlanFactTab } from './PlanFactTab';
import { ReleaseCostTab } from './ReleaseCostTab';
import { ReleaseTab } from './ReleaseTab';
import { WipMovementTab } from './WipMovementTab';
import { WorkOrderCostTab } from './WorkOrderCostTab';
import type { ReportFilter } from './reports-data';
import type { FilterKey, TabProps } from './shared';

interface ReportTabDef {
  id: string;
  label: TKey;
  /** Какие общие отборы показывать; пусто — вкладка сама рисует свои */
  filters: FilterKey[];
  Component: React.ComponentType<TabProps>;
}

/** Реестр вкладок: порядок — порядок в интерфейсе */
export const REPORT_TABS: ReportTabDef[] = [
  { id: 'release', label: 'production.reports.tab.release', filters: ['period', 'center', 'item'], Component: ReleaseTab },
  { id: 'orders', label: 'production.reports.tab.orders', filters: ['period', 'center', 'item'], Component: OrdersTab },
  { id: 'plan-fact', label: 'production.reports.tab.planFact', filters: ['period', 'item'], Component: PlanFactTab },
  { id: 'release-cost', label: 'production.reports.tab.releaseCost', filters: ['period', 'center', 'item'], Component: ReleaseCostTab },
  { id: 'cost-plan-fact', label: 'production.reports.tab.costPlanFact', filters: ['period', 'center', 'item'], Component: CostPlanFactTab },
  { id: 'wip-movement', label: 'production.reports.tab.wipMovement', filters: ['period', 'center'], Component: WipMovementTab },
  { id: 'work-order-cost', label: 'production.reports.tab.workOrderCost', filters: ['period'], Component: WorkOrderCostTab },
  { id: 'bom', label: 'production.reports.tab.bom', filters: [], Component: BomTab },
  { id: 'load', label: 'production.reports.tab.load', filters: ['period', 'center'], Component: LoadTab },
];

const ALL = 'all';
const monthStart = () => iso(new Date(today().getFullYear(), today().getMonth(), 1));

export function ProductionReportsPage() {
  const tt = useT();
  const [sp, setSp] = useSearchParams();
  const tab = REPORT_TABS.find(x => x.id === sp.get('tab')) ?? REPORT_TABS[0]!;
  const snap = useSnapshot();
  const [from, setFrom] = React.useState(monthStart());
  const [to, setTo] = React.useState(iso(today()));
  const [center, setCenter] = React.useState(ALL);
  const [item, setItem] = React.useState(ALL);
  const filter: ReportFilter = { from, to, workCenterId: center === ALL ? undefined : center, itemId: item === ALL ? undefined : item };
  const has = (k: FilterKey) => tab.filters.includes(k);

  return (
    <div className="page flush">
      <div className="ph">
        <div>
          <h1>{tt('production.reports.title')}</h1>
          <p>{tt('production.reports.subtitle')}</p>
        </div>
      </div>

      <nav className="tabs doc-tabs" aria-label={tt('production.reports.tabs')}>
        {REPORT_TABS.map(x => (
          <button key={x.id} type="button" className={`tab${x.id === tab.id ? ' on' : ''}`} aria-current={x.id === tab.id ? 'page' : undefined} onClick={() => setSp({ tab: x.id }, { replace: true })}>
            {tt(x.label)}
          </button>
        ))}
      </nav>

      {tab.filters.length > 0 && (
        <section className="panel plain" style={{ margin: '0 var(--gutter) 16px' }}>
          <div className="row" style={{ gap: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            {has('period') && (
              <>
                <Field label={tt('production.reports.from')}>{p => <Input {...p} type="date" value={from} max={to} onChange={e => setFrom(e.target.value || monthStart())} />}</Field>
                <Field label={tt('production.reports.to')}>{p => <Input {...p} type="date" value={to} min={from} onChange={e => setTo(e.target.value || iso(today()))} />}</Field>
              </>
            )}
            {has('center') && (
              <Field label={tt('production.reports.col.workCenter')}>
                {p => <Select id={p.id} value={center} onValueChange={setCenter} options={[{ value: ALL, label: tt('production.reports.allCenters') }, ...(snap.data?.workCenters ?? []).map(w => ({ value: w.id, label: w.name }))]} aria-label={tt('production.reports.col.workCenter')} />}
              </Field>
            )}
            {has('item') && (
              <Field label={tt('production.reports.col.product')}>
                {p => <Select id={p.id} value={item} onValueChange={setItem} options={[{ value: ALL, label: tt('production.reports.allItems') }, ...(snap.data?.items ?? []).map(i => ({ value: i.id, label: i.name }))]} aria-label={tt('production.reports.col.product')} />}
              </Field>
            )}
          </div>
        </section>
      )}

      <tab.Component filter={filter} />
    </div>
  );
}
