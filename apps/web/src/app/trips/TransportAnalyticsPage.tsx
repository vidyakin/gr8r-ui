/* Аналитика транспорта (задача 1216): стоимость доставки на заказ и на км, OTD, загрузка машин, выработка водителей. */
import * as React from 'react';
import { useSearchParams } from 'react-router';
import type { TransportAnalyticsReport } from '@erp/shared';
import { PeriodInput } from '@/components/erp/period-input';
import { fmtAmount, fmtNumber, useT, type TKey } from '@/i18n';
import { FleetHead } from '../fleet/parts';
import { iso, today } from '../lib/dates';
import { ReportState } from '../production/reports/shared';
import { CostTab } from './analytics/CostTab';
import { DriversTab } from './analytics/DriversTab';
import { OtdTab } from './analytics/OtdTab';
import { VehiclesTab } from './analytics/VehiclesTab';
import { useTransportAnalytics } from './transport-analytics-data';

const TABS: { id: string; label: TKey; Component: React.ComponentType<{ data: TransportAnalyticsReport }> }[] = [
  { id: 'cost', label: 'transport.analytics.tab.cost', Component: CostTab },
  { id: 'otd', label: 'transport.analytics.tab.otd', Component: OtdTab },
  { id: 'vehicles', label: 'transport.analytics.tab.vehicles', Component: VehiclesTab },
  { id: 'drivers', label: 'transport.analytics.tab.drivers', Component: DriversTab },
];

const monthStart = () => iso(new Date(today().getFullYear(), today().getMonth(), 1));

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel plain" style={{ padding: 14, minWidth: 150, flex: '1 1 150px', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)' }}>
      <div className="muted" style={{ fontSize: 12 }}>{label}</div>
      <div className="num" style={{ fontSize: 22, fontWeight: 600, marginTop: 2 }}>{value}</div>
    </div>
  );
}

export function TransportAnalyticsPage() {
  const tt = useT();
  const [sp, setSp] = useSearchParams();
  const tab = TABS.find(x => x.id === sp.get('tab')) ?? TABS[0]!;
  const [from, setFrom] = React.useState(monthStart());
  const [to, setTo] = React.useState(iso(today()));
  const q = useTransportAnalytics(from, to);

  return (
    <div className="page flush">
      <FleetHead title={tt('transport.analytics.title')} lead={tt('transport.analytics.lead')} />

      <nav className="tabs doc-tabs" aria-label={tt('transport.analytics.tabs')}>
        {TABS.map(x => (
          <button key={x.id} type="button" className={`tab${x.id === tab.id ? ' on' : ''}`} aria-current={x.id === tab.id ? 'page' : undefined} onClick={() => setSp({ tab: x.id }, { replace: true })}>
            {tt(x.label)}
          </button>
        ))}
      </nav>

      <section className="panel plain" style={{ margin: '0 var(--gutter) 16px' }}>
        <PeriodInput from={from} to={to} aria-label={tt('transport.analytics.period')} onChange={(f, t) => { setFrom(f); setTo(t); }} />
      </section>

      <ReportState q={q} isEmpty={d => !d.byDay.length && !d.vehicles.length && !d.drivers.length && !d.otd.rows.length}>
        {d => {
          const s = d.summary;
          return (
            <>
              <div className="row" style={{ gap: 10, flexWrap: 'wrap', margin: '0 var(--gutter) 16px' }}>
                <Kpi label={tt('transport.analytics.kpi.orders')} value={fmtNumber(s.ordersCount, { maximumFractionDigits: 0 })} />
                <Kpi label={tt('transport.analytics.kpi.trips')} value={fmtNumber(s.tripsCount, { maximumFractionDigits: 0 })} />
                <Kpi label={tt('transport.analytics.kpi.km')} value={fmtNumber(s.totalKm, { maximumFractionDigits: 1 })} />
                <Kpi label={tt('transport.analytics.kpi.otd')} value={s.otdPct !== null ? `${fmtNumber(s.otdPct, { maximumFractionDigits: 1 })} %` : '—'} />
                <Kpi label={tt('transport.analytics.kpi.avgLoad')} value={s.avgVehicleLoadPct !== null ? `${fmtNumber(s.avgVehicleLoadPct, { maximumFractionDigits: 1 })} %` : '—'} />
                {d.canSeeCost && (
                  <>
                    <Kpi label={tt('transport.analytics.kpi.costPerOrder')} value={s.costPerOrder ? fmtAmount(s.costPerOrder) : '—'} />
                    <Kpi label={tt('transport.analytics.kpi.costPerKm')} value={s.costPerKm ? fmtAmount(s.costPerKm) : '—'} />
                    <Kpi label={tt('transport.analytics.kpi.totalCost')} value={fmtAmount(s.totalCost)} />
                    <Kpi label={tt('transport.analytics.kpi.margin')} value={fmtAmount(s.margin)} />
                  </>
                )}
              </div>
              {!d.canSeeCost && <p className="faint" style={{ margin: '0 var(--gutter) 12px', fontSize: 12 }}>{tt('transport.analytics.costHidden')}</p>}
              <tab.Component data={d} />
            </>
          );
        }}
      </ReportState>
    </div>
  );
}
