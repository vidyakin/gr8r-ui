/* Вкладка «Загрузка машин» аналитики транспорта (задача 1216). */
import type { TransportAnalyticsReport, TransportVehicleUtilizationRow } from '@erp/shared';
import { fmtAmount, fmtNumber, useT } from '@/i18n';
import { BarChart, type BarGroup } from '../../production/reports/BarChart';
import { ReportTable, type ReportColumn } from '../../production/reports/ReportTable';
import { ChartPanel } from '../../production/reports/shared';

const money = { format: (v: string) => fmtAmount(v), scale: 2 };
const count = { format: (v: string) => fmtNumber(v, { maximumFractionDigits: 0 }), scale: 0 };
const kmFmt = { format: (v: string) => fmtNumber(v, { maximumFractionDigits: 1 }), scale: 1 };
const pct = (v: string | null) => (v === null ? '—' : `${fmtNumber(v, { maximumFractionDigits: 1 })} %`);

export function VehiclesTab({ data }: { data: TransportAnalyticsReport }) {
  const tt = useT();
  const costCols: ReportColumn<TransportVehicleUtilizationRow>[] = data.canSeeCost
    ? [
        { id: 'totalCost', header: tt('transport.analytics.vehicles.col.totalCost'), align: 'r', value: r => r.totalCost, render: r => fmtAmount(r.totalCost), total: money },
        { id: 'costPerKm', header: tt('transport.analytics.vehicles.col.costPerKm'), align: 'r', value: r => r.costPerKm ?? '', render: r => (r.costPerKm ? fmtAmount(r.costPerKm) : '—') },
      ]
    : [];
  const columns: ReportColumn<TransportVehicleUtilizationRow>[] = [
    { id: 'plate', header: tt('transport.analytics.vehicles.col.plate'), value: r => r.plate, render: r => <b>{r.plate}</b> },
    { id: 'name', header: tt('transport.analytics.vehicles.col.name'), value: r => r.name || '—' },
    { id: 'trips', header: tt('transport.analytics.vehicles.col.trips'), align: 'r', value: r => r.tripsCount, total: count },
    { id: 'activeDays', header: tt('transport.analytics.vehicles.col.activeDays'), align: 'r', value: r => r.activeDays, render: r => `${r.activeDays}/${r.periodDays}` },
    { id: 'timeUtil', header: tt('transport.analytics.vehicles.col.timeUtil'), align: 'r', value: r => r.timeUtilizationPct, render: r => pct(r.timeUtilizationPct) },
    { id: 'km', header: tt('transport.analytics.vehicles.col.km'), align: 'r', value: r => r.distanceKm, render: r => fmtNumber(r.distanceKm, { maximumFractionDigits: 1 }), total: kmFmt },
    { id: 'fuel', header: tt('transport.analytics.vehicles.col.fuelLiters'), align: 'r', value: r => r.fuelLiters, render: r => fmtNumber(r.fuelLiters, { maximumFractionDigits: 1 }), total: kmFmt },
    { id: 'avgWeight', header: tt('transport.analytics.vehicles.col.avgWeight'), align: 'r', value: r => r.avgWeightKg, render: r => (r.capacityKg ? `${fmtNumber(r.avgWeightKg, { maximumFractionDigits: 0 })} / ${fmtNumber(r.capacityKg, { maximumFractionDigits: 0 })}` : fmtNumber(r.avgWeightKg, { maximumFractionDigits: 0 })) },
    { id: 'weightUtil', header: tt('transport.analytics.vehicles.col.weightUtil'), align: 'r', value: r => r.weightUtilizationPct ?? '', render: r => pct(r.weightUtilizationPct) },
    { id: 'volumeUtil', header: tt('transport.analytics.vehicles.col.volumeUtil'), align: 'r', value: r => r.volumeUtilizationPct ?? '', render: r => pct(r.volumeUtilizationPct) },
    { id: 'overloads', header: tt('transport.analytics.vehicles.col.overloads'), align: 'r', value: r => r.overloadsCount, total: count },
    ...costCols,
  ];
  const chart: BarGroup[] = data.vehicles.slice(0, 15).map(v => ({
    label: v.plate,
    values: { weight: Number(v.weightUtilizationPct ?? 0), time: Number(v.timeUtilizationPct) },
    flag: v.overloadsCount > 0,
  }));
  return (
    <>
      {chart.length > 0 && (
        <ChartPanel title={tt('transport.analytics.vehicles.chart')}>
          <BarChart
            groups={chart}
            title={tt('transport.analytics.vehicles.chart')}
            reference={{ value: 100, label: '100 %' }}
            series={[
              { id: 'weight', label: tt('transport.analytics.vehicles.col.weightUtil'), color: 'var(--blue)' },
              { id: 'time', label: tt('transport.analytics.vehicles.col.timeUtil'), color: 'var(--green)' },
            ]}
          />
        </ChartPanel>
      )}
      <ReportTable
        rows={data.vehicles}
        columns={columns}
        groups={[]}
        rowKey={r => r.vehicleId}
        rowTone={r => (r.overloadsCount > 0 ? 'danger' : undefined)}
        filename={`transport-vehicles-${data.from}-${data.to}`}
        label={tt('transport.analytics.tab.vehicles')}
      />
    </>
  );
}
