/* Отчёт «Загрузка специалистов»: по исполнителям и дням — доступное время по графику, плановые часы назначений,
   фактические записи времени, процент загрузки, перегрузка; плановые часы без дат — отдельной строкой. */
import { dec, div, fmt, mul } from '@gr8r/shared';
import { fmtNumber, useT } from '@/i18n';
import { fmtDate } from '../../lib/dates';
import { BarChart, type BarGroup } from '../../production/reports/BarChart';
import { ReportTable, type GroupLevel, type ReportColumn } from '../../production/reports/ReportTable';
import { ChartPanel, num, ReportState } from '../../production/reports/shared';
import type { ServiceTabProps } from './ServiceReportsPage';
import { useServiceLoadReport, type ServiceLoadRow } from './service-reports-data';

interface DayRow {
  memberId: string;
  memberName: string;
  memberOverloaded: boolean;
  date: string | null;
  capacity: string;
  planned: string;
  fact: string;
  overloaded: boolean;
}

const pct = (a: bigint, cap: bigint) => (cap > 0n ? fmt(div(mul(a, dec('100')), cap), 1) : null);
const showPct = (v: string | null) => (v === null ? '—' : `${fmtNumber(v, { maximumFractionDigits: 1 })} %`);
const sumBy = (rows: DayRow[], f: (r: DayRow) => string) => rows.reduce((s, r) => s + dec(f(r)), 0n);

export function LoadTab({ filter }: ServiceTabProps) {
  const tt = useT();
  const q = useServiceLoadReport(filter);
  const sum = { format: num, scale: 2 };
  // строки без даты в процент не входят: у них нет доступного времени
  const dated = (rows: DayRow[]) => rows.filter(r => r.date !== null);
  const plannedPct = (rows: DayRow[]) => pct(sumBy(dated(rows), r => r.planned), sumBy(rows, r => r.capacity));
  const factPct = (rows: DayRow[]) => pct(sumBy(rows, r => r.fact), sumBy(rows, r => r.capacity));
  const columns: ReportColumn<DayRow>[] = [
    { id: 'date', header: tt('serviceReports.load.col.date'), value: r => r.date ?? tt('serviceReports.noDate'), render: r => (r.date ? fmtDate(r.date) : <span className="muted">{tt('serviceReports.noDate')}</span>) },
    { id: 'capacity', header: tt('serviceReports.load.col.capacity'), align: 'r', value: r => r.capacity, render: r => num(r.capacity), total: sum },
    { id: 'planned', header: tt('serviceReports.load.col.planned'), align: 'r', value: r => r.planned, render: r => num(r.planned), total: sum },
    { id: 'fact', header: tt('serviceReports.load.col.fact'), align: 'r', value: r => r.fact, render: r => num(r.fact), total: sum },
    { id: 'plannedPct', header: tt('serviceReports.load.col.plannedPct'), align: 'r', value: r => (r.date ? pct(dec(r.planned), dec(r.capacity)) : null), render: r => (r.date ? showPct(pct(dec(r.planned), dec(r.capacity))) : '—'), total: rows => showPct(plannedPct(rows)), totalCsv: plannedPct },
    { id: 'factPct', header: tt('serviceReports.load.col.factPct'), align: 'r', value: r => pct(dec(r.fact), dec(r.capacity)), render: r => showPct(pct(dec(r.fact), dec(r.capacity))), total: rows => showPct(factPct(rows)), totalCsv: factPct },
    { id: 'overload', header: tt('serviceReports.load.col.overload'), value: r => (r.overloaded ? 1 : 0), render: r => (r.overloaded ? <strong style={{ color: 'var(--red)' }}>{tt('serviceReports.load.overloaded')}</strong> : '') },
  ];
  const groups: GroupLevel<DayRow>[] = [
    {
      key: r => r.memberId,
      label: rows => (
        <>
          {rows[0]!.memberName}
          {rows[0]!.memberOverloaded && <span style={{ color: 'var(--red)', marginLeft: 8 }}>{tt('serviceReports.load.overloaded')}</span>}
        </>
      ),
      csv: rows => rows[0]!.memberName,
      csvHeader: tt('serviceReports.load.group.member'),
    },
  ];
  return (
    <ReportState q={q} isEmpty={d => !d.rows.length}>
      {d => {
        const rows: DayRow[] = d.rows.flatMap((m: ServiceLoadRow) => m.days.map(day => ({ memberId: m.memberId, memberName: m.memberName, memberOverloaded: m.overloaded, ...day })));
        const chart: BarGroup[] = d.rows.map(m => ({ label: m.memberName, flag: false, values: { capacity: Number(m.capacity), planned: Number(m.planned), fact: Number(m.fact) } }));
        return (
          <>
            <p className="muted" style={{ margin: '0 var(--gutter) 8px', fontSize: 12 }}>{tt('serviceReports.load.hint')}</p>
            <ChartPanel title={tt('serviceReports.load.chart')}>
              <BarChart groups={chart} title={tt('serviceReports.load.chart')} series={[{ id: 'capacity', label: tt('serviceReports.load.col.capacity'), color: 'var(--border-strong)' }, { id: 'planned', label: tt('serviceReports.load.col.planned'), color: 'var(--blue)' }, { id: 'fact', label: tt('serviceReports.load.col.fact'), color: 'var(--green)' }]} />
            </ChartPanel>
            <ReportTable rows={rows} columns={columns} groups={groups} rowKey={r => r.memberId + (r.date ?? '-')} rowTone={r => (r.overloaded ? 'danger' : undefined)} filename="service-load" label={tt('serviceReports.tab.load')} />
          </>
        );
      }}
    </ReportState>
  );
}
