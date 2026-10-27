/* Отчёт «Отклонения от графика»: по назначениям — плановые и фактические часы, плановый конец, закрытие задачи,
   отклонение в часах и днях; итоги по исполнителю и заказ-наряду. */
import { dec, fmt } from '@gr8r/shared';
import { useT } from '@/i18n';
import { fmtDate } from '../../lib/dates';
import { BarChart, type BarGroup } from '../../production/reports/BarChart';
import { ReportTable, type GroupLevel, type ReportColumn } from '../../production/reports/ReportTable';
import { ChartPanel, num, ReportState } from '../../production/reports/shared';
import type { ServiceTabProps } from './ServiceReportsPage';
import { useScheduleReport, type ScheduleRow } from './service-reports-data';

const hours = { format: num, scale: 2 };
const signed = (v: string) => `${dec(v) > 0n ? '+' : ''}${num(v)}`;

export function ScheduleTab({ filter }: ServiceTabProps) {
  const tt = useT();
  const q = useScheduleReport(filter);
  const columns: ReportColumn<ScheduleRow>[] = [
    { id: 'task', header: tt('serviceReports.schedule.col.task'), value: r => `${r.taskKey} ${r.title}`, render: r => <><span className="mono faint">{r.taskKey}</span> {r.title}</> },
    { id: 'planned', header: tt('serviceReports.schedule.col.planned'), align: 'r', value: r => r.plannedHours, render: r => num(r.plannedHours), total: hours },
    { id: 'actual', header: tt('serviceReports.schedule.col.actual'), align: 'r', value: r => r.actualHours, render: r => num(r.actualHours), total: hours },
    { id: 'dev', header: tt('serviceReports.schedule.col.deviationHours'), align: 'r', value: r => r.deviationHours, render: r => signed(r.deviationHours), total: { format: signed, scale: 2 } },
    { id: 'end', header: tt('serviceReports.schedule.col.plannedEnd'), value: r => r.plannedEnd ?? '', render: r => (r.plannedEnd ? fmtDate(r.plannedEnd) : '—') },
    { id: 'closed', header: tt('serviceReports.schedule.col.closed'), value: r => r.closedDate ?? (r.closed ? '' : tt('serviceReports.schedule.open')), render: r => (r.closed ? (r.closedDate ? fmtDate(r.closedDate) : '—') : <span className="muted">{tt('serviceReports.schedule.open')}</span>) },
    {
      id: 'days',
      header: tt('serviceReports.schedule.col.deviationDays'),
      align: 'r',
      value: r => r.deviationDays,
      render: r => (r.deviationDays === null ? '—' : r.deviationDays > 0 ? <strong style={{ color: 'var(--red)' }}>{`+${r.deviationDays}`}</strong> : String(r.deviationDays)),
      total: rows => rows.filter(r => (r.deviationDays ?? 0) > 0).length || '—',
      totalCsv: rows => rows.filter(r => (r.deviationDays ?? 0) > 0).length,
    },
  ];
  const assignee = (r: ScheduleRow) => r.assigneeName ?? tt('serviceReports.schedule.noAssignee');
  const order = (r: ScheduleRow) => `${r.number ?? tt('serviceReports.draft')}${r.counterpartyName ? ` · ${r.counterpartyName}` : ''}`;
  const groups: GroupLevel<ScheduleRow>[] = [
    { key: r => r.assigneeId ?? '', label: rows => assignee(rows[0]!), csv: rows => assignee(rows[0]!), csvHeader: tt('serviceReports.schedule.group.assignee') },
    { key: r => r.documentId, label: rows => order(rows[0]!), csv: rows => order(rows[0]!), csvHeader: tt('serviceReports.schedule.group.order') },
  ];
  return (
    <ReportState q={q} isEmpty={d => !d.rows.length}>
      {d => {
        const chart: BarGroup[] = d.byAssignee.map(a => ({ label: a.assigneeName ?? tt('serviceReports.schedule.noAssignee'), values: { planned: Number(fmt(dec(a.plannedHours), 2)), actual: Number(fmt(dec(a.actualHours), 2)) } }));
        return (
          <>
            <p className="muted" style={{ margin: '0 var(--gutter) 8px', fontSize: 12 }}>{tt('serviceReports.schedule.hint')}</p>
            <ChartPanel title={tt('serviceReports.schedule.chart')}>
              <BarChart groups={chart} title={tt('serviceReports.schedule.chart')} series={[{ id: 'planned', label: tt('serviceReports.schedule.col.planned'), color: 'var(--blue)' }, { id: 'actual', label: tt('serviceReports.schedule.col.actual'), color: 'var(--green)' }]} />
            </ChartPanel>
            <ReportTable rows={d.rows} columns={columns} groups={groups} rowKey={r => r.assignmentId} href={r => `/documents/${r.documentId}`} rowTone={r => ((r.deviationDays ?? 0) > 0 ? 'danger' : undefined)} filename="service-schedule" label={tt('serviceReports.tab.schedule')} />
          </>
        );
      }}
    </ReportState>
  );
}
