/* Отчёт «Себестоимость выпуска»: по выпущенной продукции колонками виды затрат; сумма видов равна себестоимости прихода.
   Изделие → документ выпуска; косвенные расшифрованы по статьям затрат. Стоимостной отчёт: только admin и owner (иначе сервер отвечает 403). */
import { Alert } from '@/components/ui';
import { fmtAmount, useT } from '@/i18n';
import { dec, fmt } from '@gr8r/shared';
import { ApiError } from '../../data/api';
import { fmtDate } from '../../lib/dates';
import { BarChart, type BarGroup } from './BarChart';
import { useReleaseCostReport, type CostReportRow } from './reports-data';
import { ReportTable, type GroupLevel, type ReportColumn } from './ReportTable';
import { ChartPanel, num, ReportState, type TabProps } from './shared';

const KINDS = ['materials', 'semi', 'alloc', 'work', 'services', 'indirect', 'other'] as const;
const money = { format: (v: string) => fmtAmount(v), scale: 4 };

export function ReleaseCostTab({ filter }: TabProps) {
  const tt = useT();
  const q = useReleaseCostReport(filter);
  if (q.error instanceof ApiError && q.error.status === 403) {
    return (
      <div style={{ margin: '0 var(--gutter)' }}>
        <Alert tone="info">{tt('production.reports.amountsRestricted')}</Alert>
      </div>
    );
  }
  const columns: ReportColumn<CostReportRow>[] = [
    { id: 'doc', header: tt('production.reports.releaseCost.document'), value: r => r.number ?? tt('production.common.draft') },
    { id: 'date', header: tt('production.reports.col.date'), value: r => r.date, render: r => fmtDate(r.date) },
    { id: 'center', header: tt('production.reports.col.workCenter'), value: r => r.workCenterName ?? '', render: r => r.workCenterName ?? '—' },
    { id: 'qty', header: tt('production.reports.releaseCost.qty'), align: 'r', value: r => r.qty, render: r => num(r.qty), total: { format: num } },
    ...KINDS.map(k => ({ id: k, header: tt(`production.reports.releaseCost.${k === 'other' ? 'rest' : k}`), align: 'r' as const, value: (r: CostReportRow) => r[k], render: (r: CostReportRow) => fmtAmount(r[k]), total: money })),
    { id: 'total', header: tt('production.reports.releaseCost.total'), align: 'r', value: r => r.total, render: r => <strong>{fmtAmount(r.total)}</strong>, total: money },
  ];
  const groups: GroupLevel<CostReportRow>[] = [{ key: r => r.itemId, label: rows => rows[0]!.itemName, csv: rows => rows[0]!.itemName, csvHeader: tt('production.reports.col.product') }];
  return (
    <ReportState q={q} isEmpty={d => !d.rows.length}>
      {d => {
        // график: суммы по видам затрат за весь отбор
        const chart: BarGroup[] = KINDS.map(k => ({ label: tt(`production.reports.releaseCost.${k === 'other' ? 'rest' : k}`), values: { amount: Number(fmt(d.rows.reduce((s, r) => s + dec(r[k]), 0n), 2)) } }));
        return (
          <>
            <ChartPanel title={tt('production.reports.releaseCost.chart')}>
              <BarChart groups={chart} title={tt('production.reports.releaseCost.chart')} series={[{ id: 'amount', label: tt('production.reports.bom.amount'), color: 'var(--blue)' }]} />
              <p className="muted" style={{ margin: '8px 0 0', fontSize: 12 }}>{tt('production.reports.releaseCost.hint')}</p>
            </ChartPanel>
            <ReportTable rows={d.rows} columns={columns} groups={groups} rowKey={r => r.documentId + r.itemId} href={r => `/documents/${r.documentId}`} filename="production-release-cost" label={tt('production.reports.tab.releaseCost')} />
            {d.indirectItems.length > 0 && (
              <>
                <h3 style={{ margin: '0 var(--gutter) 8px', fontSize: 13 }}>{tt('production.reports.releaseCost.indirectTitle')}</h3>
                <ReportTable
                  rows={d.indirectItems}
                  groups={[]}
                  columns={[
                    { id: 'name', header: tt('production.reports.releaseCost.indirectItem'), value: i => i.name || tt('production.reports.releaseCost.indirectNoItem') },
                    { id: 'amount', header: tt('production.reports.bom.amount'), align: 'r', value: i => i.amount, render: i => fmtAmount(i.amount), total: money },
                  ]}
                  rowKey={(i, n) => `${i.costItemId}${n}`}
                  filename="production-release-cost-indirect"
                  label={tt('production.reports.releaseCost.indirectTitle')}
                />
              </>
            )}
          </>
        );
      }}
    </ReportState>
  );
}
