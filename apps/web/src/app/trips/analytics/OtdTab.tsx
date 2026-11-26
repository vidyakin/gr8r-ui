/* Вкладка «Доставки вовремя (OTD)» аналитики транспорта (задача 1216). */
import type { OtdStatus, TransportAnalyticsReport, TransportOtdRow } from '@erp/shared';
import { Badge } from '@/components/ui';
import { fmtNumber, useT } from '@/i18n';
import { fmtDate, parse } from '../../lib/dates';
import { BarChart, type BarGroup } from '../../production/reports/BarChart';
import { ReportTable, type ReportColumn } from '../../production/reports/ReportTable';
import { ChartPanel } from '../../production/reports/shared';

const TONE: Record<OtdStatus, 'green' | 'amber' | 'red' | 'gray'> = {
  on_time: 'green',
  late: 'amber',
  failed: 'red',
  no_window: 'gray',
};

export function OtdTab({ data }: { data: TransportAnalyticsReport }) {
  const tt = useT();
  const columns: ReportColumn<TransportOtdRow>[] = [
    { id: 'label', header: tt('transport.analytics.otd.col.label'), value: r => r.label },
    { id: 'trip', header: tt('transport.analytics.otd.col.trip'), value: r => r.tripNumber ?? '—' },
    { id: 'courier', header: tt('transport.analytics.otd.col.courier'), value: r => r.courierName ?? '—' },
    { id: 'target', header: tt('transport.analytics.otd.col.targetDate'), value: r => r.targetDate ?? '', render: r => (r.targetDate ? fmtDate(parse(r.targetDate)) : '—') },
    {
      id: 'window',
      header: tt('transport.analytics.otd.col.window'),
      value: r => (r.windowFrom || r.windowTo ? `${r.windowFrom ?? ''}–${r.windowTo ?? ''}` : '—'),
    },
    {
      id: 'actual',
      header: tt('transport.analytics.otd.col.actual'),
      value: r => [r.actualDate ? fmtDate(parse(r.actualDate)) : '', r.actualTime ?? ''].filter(Boolean).join(' ') || '—',
    },
    {
      id: 'status',
      header: tt('transport.analytics.otd.col.status'),
      value: r => tt(`transport.analytics.otd.status.${r.status}`),
      render: r => <Badge tone={TONE[r.status]}>{tt(`transport.analytics.otd.status.${r.status}`)}</Badge>,
    },
    {
      id: 'delay',
      header: tt('transport.analytics.otd.col.delay'),
      align: 'r',
      value: r => r.delayMinutes ?? '',
      render: r => (r.delayMinutes && r.delayMinutes > 0 ? <span className="num">{tt('transport.analytics.otd.delayMin', { min: fmtNumber(r.delayMinutes, { maximumFractionDigits: 0 }) })}</span> : '—'),
    },
  ];
  const chart: BarGroup[] = data.otd.byDay.slice(-31).map(r => ({
    label: fmtDate(parse(r.date)),
    values: { onTime: r.onTime, late: r.late, failed: r.failed },
  }));
  return (
    <>
      <div className="row" style={{ gap: 8, flexWrap: 'wrap', margin: '0 var(--gutter) 12px' }}>
        <Badge tone="green">{tt('transport.analytics.otd.onTime')}: {data.otd.onTime}</Badge>
        <Badge tone="amber">{tt('transport.analytics.otd.late')}: {data.otd.late}</Badge>
        <Badge tone="red">{tt('transport.analytics.otd.failed')}: {data.otd.failed}</Badge>
        <Badge tone="gray">{tt('transport.analytics.otd.noWindow')}: {data.otd.noWindow}</Badge>
      </div>
      {chart.length > 0 && (
        <ChartPanel title={tt('transport.analytics.otd.chart')}>
          <BarChart
            groups={chart}
            title={tt('transport.analytics.otd.chart')}
            integer
            series={[
              { id: 'onTime', label: tt('transport.analytics.otd.onTime'), color: 'var(--green)' },
              { id: 'late', label: tt('transport.analytics.otd.late'), color: 'var(--amber)' },
              { id: 'failed', label: tt('transport.analytics.otd.failed'), color: 'var(--red)' },
            ]}
          />
        </ChartPanel>
      )}
      <ReportTable
        rows={data.otd.rows}
        columns={columns}
        groups={[]}
        rowKey={r => `${r.source}-${r.id}`}
        href={r => (r.documentId ? `/documents/${r.documentId}` : null)}
        rowTone={r => (r.status === 'late' || r.status === 'failed' ? 'danger' : undefined)}
        filename={`transport-otd-${data.from}-${data.to}`}
        label={tt('transport.analytics.tab.otd')}
      />
    </>
  );
}
