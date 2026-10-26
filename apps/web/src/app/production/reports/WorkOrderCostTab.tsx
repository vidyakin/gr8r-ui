/* Отчёт «Себестоимость заказ-нарядов» (задача 1096): выполненные за период, затраты по видам, выручка и маржа.
   Группировка по заказчику, итоги, CSV, клик по строке открывает заказ-наряд. Только admin и owner (иначе сервер отвечает 403). */
import { Alert } from '@/components/ui';
import { fmtAmount, fmtNumber, useT } from '@/i18n';
import { dec, marginPct } from '@gr8r/shared';
import { ApiError } from '../../data/api';
import { fmtDate } from '../../lib/dates';
import { useWorkOrderCostReport, type WorkOrderCostReportRow } from './reports-data';
import { ReportTable, type GroupLevel, type ReportColumn } from './ReportTable';
import { ReportState, type TabProps } from './shared';

const money = { format: (v: string) => fmtAmount(v), scale: 2 };
const pct = (v: string | null) => (v === null ? '—' : `${fmtNumber(v)} %`);
const KINDS = ['labor', 'materials', 'goods', 'other', 'indirect'] as const;
// ключ перевода: слово other зарезервировано под множественные формы
const LABEL = { labor: 'labor', materials: 'materials', goods: 'goods', other: 'otherCosts', indirect: 'indirect' } as const;

export function WorkOrderCostTab({ filter }: TabProps) {
  const tt = useT();
  const q = useWorkOrderCostReport(filter);
  if (q.error instanceof ApiError && q.error.status === 403) {
    return (
      <div style={{ margin: '0 var(--gutter)' }}>
        <Alert tone="info">{tt('production.reports.amountsRestricted')}</Alert>
      </div>
    );
  }
  const columns: ReportColumn<WorkOrderCostReportRow>[] = [
    { id: 'doc', header: tt('production.reports.workOrderCost.document'), value: r => r.number ?? tt('production.common.draft') },
    { id: 'done', header: tt('production.reports.workOrderCost.doneDate'), value: r => r.doneDate, render: r => fmtDate(r.doneDate) },
    { id: 'revenue', header: tt('production.reports.workOrderCost.revenue'), align: 'r', value: r => r.revenue, render: r => fmtAmount(r.revenue), total: money },
    ...KINDS.map(k => ({ id: k, header: tt(`production.reports.workOrderCost.${LABEL[k]}`), align: 'r' as const, value: (r: WorkOrderCostReportRow) => r[k], render: (r: WorkOrderCostReportRow) => fmtAmount(r[k]), total: money })),
    { id: 'cost', header: tt('production.reports.workOrderCost.cost'), align: 'r', value: r => r.cost, render: r => <strong>{fmtAmount(r.cost)}</strong>, total: money },
    { id: 'margin', header: tt('production.reports.workOrderCost.margin'), align: 'r', value: r => r.margin, render: r => <strong>{fmtAmount(r.margin)}</strong>, total: money },
    {
      id: 'marginPct',
      header: tt('production.reports.workOrderCost.marginPct'),
      align: 'r',
      value: r => r.marginPct ?? '',
      render: r => pct(r.marginPct),
      // процент группы — от сумм группы, а не среднее процентов
      total: list => pct(marginPct(list.reduce((s, r) => s + dec(r.margin), 0n), list.reduce((s, r) => s + dec(r.revenue), 0n))),
    },
  ];
  const groups: GroupLevel<WorkOrderCostReportRow>[] = [{ key: r => r.counterpartyId ?? '', label: rows => rows[0]!.counterpartyName ?? tt('production.reports.workOrderCost.noCounterparty'), csv: rows => rows[0]!.counterpartyName ?? '', csvHeader: tt('production.reports.workOrderCost.counterparty') }];
  return (
    <ReportState q={q} isEmpty={d => !d.rows.length}>
      {d => (
        <>
          <p className="muted" style={{ margin: '0 var(--gutter) 8px', fontSize: 12 }}>{tt('production.reports.workOrderCost.hint')}</p>
          <ReportTable rows={d.rows} columns={columns} groups={groups} rowKey={r => r.documentId} href={r => `/documents/${r.documentId}`} filename="production-work-order-cost" label={tt('production.reports.tab.workOrderCost')} />
        </>
      )}
    </ReportState>
  );
}
