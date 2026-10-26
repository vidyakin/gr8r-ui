/* Отчёт «Загрузка участков»: мощность по графику, запланировано (планировщик), факт (часы проведённых нарядов),
   процент загрузки; перегруженные дни и участки выделены, график по участкам. */
import { fmtDate } from '../../lib/dates';
import { fmtNumber, useT } from '@/i18n';
import { BarChart, type BarGroup } from './BarChart';
import { useLoadReport, type LoadReportRow } from './reports-data';
import { ReportTable, type GroupLevel, type ReportColumn } from './ReportTable';
import { ChartPanel, num, ReportState, type TabProps } from './shared';
import { dec, div, fmt, mul } from '@gr8r/shared';

/** Плоская строка: день участка */
interface DayRow {
  workCenterId: string;
  workCenterName: string;
  centerOverloaded: boolean;
  date: string;
  capacity: string;
  planned: string;
  fact: string;
  overloaded: boolean;
}

const pct = (planned: bigint, capacity: bigint) => (capacity > 0n ? fmt(div(mul(planned, dec('100')), capacity), 1) : null);
const showPct = (v: string | null) => (v === null ? '—' : `${fmtNumber(v, { maximumFractionDigits: 1 })} %`);
const sumBy = (rows: DayRow[], f: (r: DayRow) => string) => rows.reduce((s, r) => s + dec(f(r)), 0n);

export function LoadTab({ filter }: TabProps) {
  const tt = useT();
  const q = useLoadReport(filter);
  const sum = { format: num, scale: 2 };
  const plannedPct = (rows: DayRow[]) => pct(sumBy(rows, r => r.planned), sumBy(rows, r => r.capacity));
  const factPct = (rows: DayRow[]) => pct(sumBy(rows, r => r.fact), sumBy(rows, r => r.capacity));
  const columns: ReportColumn<DayRow>[] = [
    { id: 'date', header: tt('production.reports.col.date'), value: r => r.date, render: r => fmtDate(r.date) },
    { id: 'capacity', header: tt('production.reports.load.capacity'), align: 'r', value: r => r.capacity, render: r => num(r.capacity), total: sum },
    { id: 'planned', header: tt('production.reports.load.planned'), align: 'r', value: r => r.planned, render: r => num(r.planned), total: sum },
    { id: 'fact', header: tt('production.reports.load.fact'), align: 'r', value: r => r.fact, render: r => num(r.fact), total: sum },
    { id: 'plannedPct', header: tt('production.reports.load.plannedPct'), align: 'r', value: r => pct(dec(r.planned), dec(r.capacity)), render: r => showPct(pct(dec(r.planned), dec(r.capacity))), total: rows => showPct(plannedPct(rows)), totalCsv: plannedPct },
    { id: 'factPct', header: tt('production.reports.load.factPct'), align: 'r', value: r => pct(dec(r.fact), dec(r.capacity)), render: r => showPct(pct(dec(r.fact), dec(r.capacity))), total: rows => showPct(factPct(rows)), totalCsv: factPct },
    { id: 'overload', header: tt('production.reports.load.overload'), value: r => (r.overloaded ? 1 : 0), render: r => (r.overloaded ? <strong style={{ color: 'var(--red)' }}>{tt('production.reports.load.overloaded')}</strong> : '') },
  ];
  const label = (r: DayRow) => r.workCenterName;
  const groups: GroupLevel<DayRow>[] = [
    {
      key: r => r.workCenterId,
      label: rows => (
        <>
          {label(rows[0]!)}
          {rows[0]!.centerOverloaded && <span style={{ color: 'var(--red)', marginLeft: 8 }}>{tt('production.reports.load.overloaded')}</span>}
        </>
      ),
      csv: rows => label(rows[0]!),
      csvHeader: tt('production.reports.col.workCenter'),
    },
  ];
  return (
    <ReportState q={q} isEmpty={d => !d.rows.length}>
      {d => {
        const rows: DayRow[] = d.rows.flatMap((c: LoadReportRow) => c.days.map(day => ({ workCenterId: c.workCenterId, workCenterName: c.workCenterName, centerOverloaded: c.overloaded, ...day })));
        const chart: BarGroup[] = d.rows.map(c => ({ label: c.workCenterName, flag: false, values: { capacity: Number(c.capacity), planned: Number(c.planned), fact: Number(c.fact) } }));
        return (
          <>
            <ChartPanel title={tt('production.reports.load.chart')}>
              <BarChart
                groups={chart}
                title={tt('production.reports.load.chart')}
                series={[{ id: 'capacity', label: tt('production.reports.load.capacity'), color: 'var(--border-strong)' }, { id: 'planned', label: tt('production.reports.load.planned'), color: 'var(--blue)' }, { id: 'fact', label: tt('production.reports.load.fact'), color: 'var(--green)' }]}
              />
            </ChartPanel>
            <ReportTable rows={rows} columns={columns} groups={groups} rowKey={r => r.workCenterId + r.date} rowTone={r => (r.overloaded ? 'danger' : undefined)} filename="production-load" label={tt('production.reports.tab.load')} />
          </>
        );
      }}
    </ReportState>
  );
}
