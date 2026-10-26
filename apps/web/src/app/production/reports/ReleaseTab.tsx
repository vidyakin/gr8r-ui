/* Отчёт «Выпуск продукции»: что выпущено за период; изделие → документ выпуска, клик открывает документ. */
import { fmtDate } from '../../lib/dates';
import { useT } from '@/i18n';
import { useReleaseReport, type ReleaseRow } from './reports-data';
import { ReportTable, type GroupLevel, type ReportColumn } from './ReportTable';
import { num, ReportState, type TabProps } from './shared';

export function ReleaseTab({ filter }: TabProps) {
  const tt = useT();
  const q = useReleaseReport(filter);
  const columns: ReportColumn<ReleaseRow>[] = [
    { id: 'doc', header: tt('production.reports.release.document'), value: r => r.number ?? tt('production.common.draft') },
    { id: 'date', header: tt('production.reports.col.date'), value: r => r.date, render: r => fmtDate(r.date) },
    { id: 'center', header: tt('production.reports.col.workCenter'), value: r => r.workCenterName ?? '', render: r => r.workCenterName ?? '—' },
    { id: 'qty', header: tt('production.reports.release.qty'), align: 'r', value: r => r.qty, render: r => num(r.qty), total: { format: num } },
    { id: 'defect', header: tt('production.reports.release.defect'), align: 'r', value: r => r.defectQty, render: r => num(r.defectQty), total: { format: num } },
    { id: 'good', header: tt('production.reports.release.good'), align: 'r', value: r => r.goodQty, render: r => num(r.goodQty), total: { format: num } },
  ];
  const groups: GroupLevel<ReleaseRow>[] = [{ key: r => r.itemId, label: rows => rows[0]!.itemName, csv: rows => rows[0]!.itemName, csvHeader: tt('production.reports.col.product') }];
  return (
    <ReportState q={q} isEmpty={d => !d.rows.length}>
      {d => <ReportTable rows={d.rows} columns={columns} groups={groups} rowKey={r => r.documentId + r.itemId} href={r => `/documents/${r.documentId}`} filename="production-release" label={tt('production.reports.tab.release')} />}
    </ReportState>
  );
}
