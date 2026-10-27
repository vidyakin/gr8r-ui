/* Отчёт «Состояние заказ-нарядов»: число и сумма по видам и состояниям, просроченные, процент выполнения
   (факт/план часов назначений). Просроченные строки выделены; клик открывает заказ-наряд. */
import { dec, div, fmt, mul } from '@gr8r/shared';
import { fmtAmount, fmtNumber, useT } from '@/i18n';
import { fmtDate } from '../../lib/dates';
import { BarChart, type BarGroup } from '../../production/reports/BarChart';
import { ReportTable, type GroupLevel, type ReportColumn } from '../../production/reports/ReportTable';
import { ChartPanel, num, ReportState } from '../../production/reports/shared';
import type { ServiceTabProps } from './ServiceReportsPage';
import { useStatesReport, type StatesOrderRow } from './service-reports-data';

const money = { format: (v: string) => fmtAmount(v), scale: 2 };
const hours = { format: num, scale: 2 };
const count = { format: (v: string) => fmtNumber(v, { maximumFractionDigits: 0 }), scale: 0 };
const pct = (v: string | null) => (v === null ? '—' : `${fmtNumber(v, { maximumFractionDigits: 1 })} %`);
const donePct = (rows: StatesOrderRow[]) => {
  const planned = rows.reduce((s, r) => s + dec(r.plannedHours), 0n);
  const actual = rows.reduce((s, r) => s + dec(r.actualHours), 0n);
  return planned > 0n ? fmt(div(mul(actual, dec('100')), planned), 1) : null;
};

export function StatesTab({ filter }: ServiceTabProps) {
  const tt = useT();
  const q = useStatesReport(filter);
  const columns: ReportColumn<StatesOrderRow>[] = [
    { id: 'doc', header: tt('serviceReports.states.col.document'), value: r => r.number ?? tt('serviceReports.draft') },
    { id: 'count', header: tt('serviceReports.states.orders'), align: 'r', value: () => 1, render: () => '1', total: count },
    { id: 'date', header: tt('serviceReports.states.col.date'), value: r => r.date, render: r => fmtDate(r.date) },
    { id: 'client', header: tt('serviceReports.states.col.client'), value: r => r.counterpartyName ?? '' },
    { id: 'due', header: tt('serviceReports.states.col.due'), value: r => r.dueDate ?? '', render: r => (r.dueDate ? fmtDate(r.dueDate) : '—') },
    {
      id: 'overdue',
      header: tt('serviceReports.states.col.overdue'),
      value: r => (r.overdue ? r.overdueDays : 0),
      render: r => (r.overdue ? <strong style={{ color: 'var(--red)' }}>{`${tt('serviceReports.states.overdueDays', { count: r.overdueDays })} · ${r.overdueReasons.map(x => tt(`serviceReports.states.reason.${x}`)).join(', ')}`}</strong> : '—'),
      total: rows => rows.filter(r => r.overdue).length || '—',
      totalCsv: rows => rows.filter(r => r.overdue).length,
    },
    { id: 'planned', header: tt('serviceReports.states.col.planned'), align: 'r', value: r => r.plannedHours, render: r => num(r.plannedHours), total: hours },
    { id: 'actual', header: tt('serviceReports.states.col.actual'), align: 'r', value: r => r.actualHours, render: r => num(r.actualHours), total: hours },
    { id: 'done', header: tt('serviceReports.states.col.done'), align: 'r', value: r => r.completionPct ?? '', render: r => pct(r.completionPct), total: rows => pct(donePct(rows)), totalCsv: donePct },
    { id: 'amount', header: tt('serviceReports.states.col.amount'), align: 'r', value: r => r.amountNet, render: r => fmtAmount(r.amountNet), total: money },
    { id: 'total', header: tt('serviceReports.states.col.total'), align: 'r', value: r => r.total, render: r => fmtAmount(r.total), total: money },
  ];
  const kind = (r: StatesOrderRow) => r.kindName ?? '—';
  const state = (r: StatesOrderRow) => r.stateLabel ?? r.state ?? '—';
  const groups: GroupLevel<StatesOrderRow>[] = [
    { key: r => r.kindId ?? '', label: rows => kind(rows[0]!), csv: rows => kind(rows[0]!), csvHeader: tt('serviceReports.states.group.kind') },
    { key: r => r.state ?? '', label: rows => state(rows[0]!), csv: rows => state(rows[0]!), csvHeader: tt('serviceReports.states.group.state') },
  ];
  return (
    <ReportState q={q} isEmpty={d => !d.rows.length}>
      {d => {
        const chart: BarGroup[] = d.summary.map(s => ({ label: s.stateLabel ?? s.state ?? '—', values: { count: s.count, overdue: s.overdue } }));
        return (
          <>
            <p className="muted" style={{ margin: '0 var(--gutter) 8px', fontSize: 12 }}>{tt('serviceReports.states.hint')}</p>
            <ChartPanel title={tt('serviceReports.states.chart')}>
              <BarChart integer groups={chart} title={tt('serviceReports.states.chart')} series={[{ id: 'count', label: tt('serviceReports.states.orders'), color: 'var(--blue)' }, { id: 'overdue', label: tt('serviceReports.states.overdueSeries'), color: 'var(--red)' }]} />
            </ChartPanel>
            <ReportTable rows={d.rows} columns={columns} groups={groups} rowKey={r => r.documentId} href={r => `/documents/${r.documentId}`} rowTone={r => (r.overdue ? 'danger' : undefined)} filename="service-states" label={tt('serviceReports.tab.states')} />
          </>
        );
      }}
    </ReportState>
  );
}
