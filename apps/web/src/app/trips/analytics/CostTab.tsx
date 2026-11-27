/* Вкладка «Стоимость и экономика» аналитики транспорта (задача 1216). */
import type { TransportAnalyticsReport, TransportCostDayRow } from '@erp/shared';
import { fmtAmount, fmtNumber, useT } from '@/i18n';
import { fmtDate, parse } from '../../lib/dates';
import { BarChart, type BarGroup } from '../../production/reports/BarChart';
import { ReportTable, type ReportColumn } from '../../production/reports/ReportTable';
import { ChartPanel } from '../../production/reports/shared';

const money = { format: (v: string) => fmtAmount(v), scale: 2 };
const count = { format: (v: string) => fmtNumber(v, { maximumFractionDigits: 0 }), scale: 0 };
const kmFmt = { format: (v: string) => fmtNumber(v, { maximumFractionDigits: 1 }), scale: 1 };

function BreakdownCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel plain" style={{ padding: 12, minWidth: 160, flex: '1 1 160px', border: '1px solid var(--border)', borderRadius: 'var(--r-lg)' }}>
      <div className="muted" style={{ fontSize: 12 }}>{label}</div>
      <div className="num" style={{ fontSize: 18, fontWeight: 600, marginTop: 2 }}>{value}</div>
    </div>
  );
}

export function CostTab({ data }: { data: TransportAnalyticsReport }) {
  const tt = useT();
  const seeCost = data.canSeeCost;
  const costCols: ReportColumn<TransportCostDayRow>[] = seeCost
    ? [
        { id: 'cost', header: tt('transport.analytics.cost.col.cost'), align: 'r', value: r => r.cost, render: r => fmtAmount(r.cost), total: money },
        { id: 'revenue', header: tt('transport.analytics.cost.col.revenue'), align: 'r', value: r => r.revenue, render: r => fmtAmount(r.revenue), total: money },
      ]
    : [];
  const columns: ReportColumn<TransportCostDayRow>[] = [
    { id: 'date', header: tt('transport.analytics.cost.col.date'), value: r => r.date, render: r => fmtDate(parse(r.date)) },
    { id: 'orders', header: tt('transport.analytics.cost.col.orders'), align: 'r', value: r => r.orders, total: count },
    { id: 'trips', header: tt('transport.analytics.cost.col.trips'), align: 'r', value: r => r.trips, total: count },
    { id: 'km', header: tt('transport.analytics.cost.col.km'), align: 'r', value: r => r.km, render: r => fmtNumber(r.km, { maximumFractionDigits: 1 }), total: kmFmt },
    ...costCols,
  ];
  const chart: BarGroup[] = data.byDay.slice(-31).map(r => ({
    label: fmtDate(parse(r.date)),
    values: (seeCost
      ? { cost: Number(r.cost ?? 0), revenue: Number(r.revenue ?? 0) }
      : { orders: r.orders, km: Number(r.km) }) as Record<string, number>,
  }));
  return (
    <>
      {seeCost && (
        <section style={{ margin: '0 var(--gutter) 16px' }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 13 }}>{tt('transport.analytics.cost.breakdown')}</h3>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
            <BreakdownCard label={tt('transport.analytics.cost.fuel')} value={fmtAmount(data.cost.fuelCost)} />
            <BreakdownCard label={tt('transport.analytics.cost.repairs')} value={fmtAmount(data.cost.repairCost)} />
            <BreakdownCard label={tt('transport.analytics.cost.fines')} value={fmtAmount(data.cost.finesCost)} />
            <BreakdownCard label={tt('transport.analytics.cost.driverPay')} value={fmtAmount(data.cost.driverPayCost)} />
            <BreakdownCard label={tt('transport.analytics.cost.carrier')} value={fmtAmount(data.cost.carrierCost)} />
            <BreakdownCard label={tt('transport.analytics.cost.otherTrip')} value={fmtAmount(data.cost.otherTripCost)} />
            <BreakdownCard label={tt('transport.analytics.cost.delivery')} value={fmtAmount(data.cost.deliveryCost)} />
            <BreakdownCard label={tt('transport.analytics.cost.costPerTrip')} value={data.cost.costPerTrip ? fmtAmount(data.cost.costPerTrip) : '—'} />
          </div>
        </section>
      )}
      {chart.length > 0 && (
        <ChartPanel title={seeCost ? tt('transport.analytics.cost.chart') : tt('transport.analytics.cost.chartOps')}>
          <BarChart
            groups={chart}
            title={seeCost ? tt('transport.analytics.cost.chart') : tt('transport.analytics.cost.chartOps')}
            series={
              seeCost
                ? [
                    { id: 'revenue', label: tt('transport.analytics.cost.revenue'), color: 'var(--blue)' },
                    { id: 'cost', label: tt('transport.analytics.cost.totalCost'), color: 'var(--amber)' },
                  ]
                : [
                    { id: 'orders', label: tt('transport.analytics.cost.col.orders'), color: 'var(--blue)' },
                    { id: 'km', label: tt('transport.analytics.cost.col.km'), color: 'var(--green)' },
                  ]
            }
          />
        </ChartPanel>
      )}
      <ReportTable rows={data.byDay} columns={columns} groups={[]} rowKey={r => r.date} filename={`transport-cost-${data.from}-${data.to}`} label={tt('transport.analytics.tab.cost')} />
    </>
  );
}
