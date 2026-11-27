/* Вкладка «Водители и курьеры» аналитики транспорта (задача 1216). */
import type { TransportAnalyticsReport, TransportDriverOutputRow } from '@erp/shared';
import { fmtAmount, fmtNumber, useT } from '@/i18n';
import { BarChart, type BarGroup } from '../../production/reports/BarChart';
import { ReportTable, type ReportColumn } from '../../production/reports/ReportTable';
import { ChartPanel } from '../../production/reports/shared';

const money = { format: (v: string) => fmtAmount(v), scale: 2 };
const count = { format: (v: string) => fmtNumber(v, { maximumFractionDigits: 0 }), scale: 0 };
const kmFmt = { format: (v: string) => fmtNumber(v, { maximumFractionDigits: 1 }), scale: 1 };
const pct = (v: string | null) => (v === null ? '—' : `${fmtNumber(v, { maximumFractionDigits: 1 })} %`);

export function DriversTab({ data }: { data: TransportAnalyticsReport }) {
  const tt = useT();
  const roleLabel = (roles: ('driver' | 'courier')[]) =>
    roles.map(r => (r === 'driver' ? tt('transport.analytics.drivers.roleDriver') : tt('transport.analytics.drivers.roleCourier'))).join(', ') || '—';
  const costCols: ReportColumn<TransportDriverOutputRow>[] = data.canSeeCost
    ? [
        { id: 'payroll', header: tt('transport.analytics.drivers.col.payroll'), align: 'r', value: r => r.payrollAmount, render: r => fmtAmount(r.payrollAmount), total: money },
        { id: 'deliveryCost', header: tt('transport.analytics.drivers.col.deliveryCost'), align: 'r', value: r => r.deliveryCost, render: r => fmtAmount(r.deliveryCost), total: money },
        { id: 'totalCost', header: tt('transport.analytics.drivers.col.totalCost'), align: 'r', value: r => r.totalCost, render: r => <strong>{fmtAmount(r.totalCost)}</strong>, total: money },
        { id: 'costPerDelivery', header: tt('transport.analytics.drivers.col.costPerDelivery'), align: 'r', value: r => r.costPerDelivery ?? '', render: r => (r.costPerDelivery ? fmtAmount(r.costPerDelivery) : '—') },
        { id: 'costPerKm', header: tt('transport.analytics.drivers.col.costPerKm'), align: 'r', value: r => r.costPerKm ?? '', render: r => (r.costPerKm ? fmtAmount(r.costPerKm) : '—') },
      ]
    : [];
  const columns: ReportColumn<TransportDriverOutputRow>[] = [
    { id: 'name', header: tt('transport.analytics.drivers.col.name'), value: r => r.memberName, render: r => <b>{r.memberName}</b> },
    { id: 'roles', header: tt('transport.analytics.drivers.col.roles'), value: r => roleLabel(r.roles) },
    { id: 'deliveriesDone', header: tt('transport.analytics.drivers.col.deliveriesDone'), align: 'r', value: r => r.deliveriesCompleted, total: count },
    { id: 'deliveriesFailed', header: tt('transport.analytics.drivers.col.deliveriesFailed'), align: 'r', value: r => r.deliveriesFailed, total: count },
    { id: 'otd', header: tt('transport.analytics.drivers.col.otdPct'), align: 'r', value: r => r.otdPct ?? '', render: r => pct(r.otdPct) },
    { id: 'trips', header: tt('transport.analytics.drivers.col.trips'), align: 'r', value: r => r.tripsCount, total: count },
    { id: 'stopsDone', header: tt('transport.analytics.drivers.col.stopsDone'), align: 'r', value: r => r.stopsDone, total: count },
    { id: 'km', header: tt('transport.analytics.drivers.col.km'), align: 'r', value: r => r.distanceKm, render: r => fmtNumber(r.distanceKm, { maximumFractionDigits: 1 }), total: kmFmt },
    ...costCols,
  ];
  const chart: BarGroup[] = data.drivers.slice(0, 15).map(d => ({
    label: d.memberName,
    values: { deliveries: d.deliveriesCompleted, trips: d.tripsCount },
  }));
  return (
    <>
      {chart.length > 0 && (
        <ChartPanel title={tt('transport.analytics.drivers.chart')}>
          <BarChart
            groups={chart}
            title={tt('transport.analytics.drivers.chart')}
            integer
            series={[
              { id: 'deliveries', label: tt('transport.analytics.drivers.col.deliveriesDone'), color: 'var(--blue)' },
              { id: 'trips', label: tt('transport.analytics.drivers.col.trips'), color: 'var(--green)' },
            ]}
          />
        </ChartPanel>
      )}
      <ReportTable rows={data.drivers} columns={columns} groups={[]} rowKey={r => r.memberId} filename={`transport-drivers-${data.from}-${data.to}`} label={tt('transport.analytics.tab.drivers')} />
    </>
  );
}
