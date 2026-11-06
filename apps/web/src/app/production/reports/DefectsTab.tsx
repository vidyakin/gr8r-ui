/* Отчёт дефектов: группировка по участку, виновному и причине. */
import { useT } from '@/i18n';
import { useDefectReport, type DefectReportRow } from './reports-data';
import { ReportState, type TabProps, num } from './shared';
import { ReportTable, type ReportColumn } from './ReportTable';

export function DefectsTab({ filter }: TabProps) {
  const tt = useT();
  const q = useDefectReport(filter);
  const columns: ReportColumn<DefectReportRow>[] = [
    { id: 'center', header: tt('production.reports.col.workCenter'), value: r => r.workCenterName ?? '', render: r => r.workCenterName ?? '—' },
    { id: 'member', header: tt('production.reports.defects.member'), value: r => r.memberName ?? '', render: r => r.memberName ?? '—' },
    { id: 'reason', header: tt('production.reports.defects.reason'), value: r => r.reasonName ?? '', render: r => r.reasonName ?? '—' },
    { id: 'qty', header: tt('production.reports.defects.qty'), value: r => r.defectQty, align: 'r', render: r => num(r.defectQty), total: { format: num } },
    { id: 'released', header: tt('production.reports.defects.released'), value: r => r.releasedQty, align: 'r', render: r => num(r.releasedQty) },
    { id: 'pct', header: tt('production.reports.defects.percent'), value: r => r.defectPct, align: 'r', render: r => `${num(r.defectPct)}%` },
  ];
  return (
    <ReportState q={q} isEmpty={d => !d.rows.length}>
      {d => <ReportTable rows={d.rows} columns={columns} groups={[]} rowKey={r => `${r.workCenterId ?? 'none'}:${r.memberId ?? 'none'}:${r.reasonId ?? 'none'}`} filename="production-defects" label={tt('production.reports.tab.defect')} />}
    </ReportState>
  );
}
