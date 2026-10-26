/* Отчёт «НЗП с движением»: по участкам и заказам — остаток на начало, приход, расход, остаток на конец (количество и сумма).
   Остаток на конец равен экрану «Остаток НЗП» на дату конца. Суммы видят admin и owner — остальным сервер отдаёт null. */
import { fmtAmount, useT } from '@/i18n';
import { useWipMovementReport, type WipMovementRow } from './reports-data';
import { ReportTable, type GroupLevel, type ReportColumn } from './ReportTable';
import { num, ReportState, type TabProps } from './shared';

const money = { format: (v: string) => fmtAmount(v), scale: 2 };
const qty = { format: num };

export function WipMovementTab({ filter }: TabProps) {
  const tt = useT();
  const q = useWipMovementReport(filter);
  return (
    <ReportState q={q} isEmpty={d => !d.rows.length}>
      {d => {
        const masked = d.closingTotal === null;
        const order = (r: WipMovementRow) => (r.number ? `${tt('production.reports.wipMovement.order')} ${r.number}` : tt('production.reports.wipMovement.directOrder'));
        const columns: ReportColumn<WipMovementRow>[] = [
          { id: 'item', header: tt('production.reports.col.product'), value: r => r.itemName },
          { id: 'openingQty', header: tt('production.reports.wipMovement.openingQty'), align: 'r', value: r => r.openingQty, render: r => num(r.openingQty), total: qty },
          { id: 'inQty', header: tt('production.reports.wipMovement.inQty'), align: 'r', value: r => r.inQty, render: r => num(r.inQty), total: qty },
          { id: 'outQty', header: tt('production.reports.wipMovement.outQty'), align: 'r', value: r => r.outQty, render: r => num(r.outQty), total: qty },
          { id: 'closingQty', header: tt('production.reports.wipMovement.closingQty'), align: 'r', value: r => r.closingQty, render: r => num(r.closingQty), total: qty },
          ...(masked
            ? []
            : ([
                { id: 'openingAmount', header: tt('production.reports.wipMovement.openingAmount'), align: 'r', value: r => r.openingAmount, render: r => fmtAmount(r.openingAmount), total: money },
                { id: 'inAmount', header: tt('production.reports.wipMovement.inAmount'), align: 'r', value: r => r.inAmount, render: r => fmtAmount(r.inAmount), total: money },
                { id: 'outAmount', header: tt('production.reports.wipMovement.outAmount'), align: 'r', value: r => r.outAmount, render: r => fmtAmount(r.outAmount), total: money },
                { id: 'closingAmount', header: tt('production.reports.wipMovement.closingAmount'), align: 'r', value: r => r.closingAmount, render: r => fmtAmount(r.closingAmount), total: money },
              ] as ReportColumn<WipMovementRow>[])),
        ];
        const center = (r: WipMovementRow) => r.workCenterName ?? tt('production.reports.wipMovement.noCenter');
        const groups: GroupLevel<WipMovementRow>[] = [
          { key: r => r.workCenterId ?? '', label: rows => center(rows[0]!), csv: rows => center(rows[0]!), csvHeader: tt('production.reports.col.workCenter') },
          { key: r => r.orderId ?? '', label: rows => order(rows[0]!), csv: rows => order(rows[0]!), csvHeader: tt('production.reports.wipMovement.order') },
        ];
        return (
          <>
            <p className="muted" style={{ margin: '0 var(--gutter) 12px', fontSize: 12 }}>{tt('production.reports.wipMovement.hint')}</p>
            <ReportTable rows={d.rows} columns={columns} groups={groups} rowKey={r => `${r.workCenterId}${r.itemKey}`} href={r => (r.orderId ? `/documents/${r.orderId}` : null)} filename="production-wip-movement" label={tt('production.reports.tab.wipMovement')} />
          </>
        );
      }}
    </ReportState>
  );
}
