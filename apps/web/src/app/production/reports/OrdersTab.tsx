/* Отчёт «Заказы на производство»: по заказу и позиции — остаток на начало, заказано, выпущено, остаток на конец;
   срок, просрочка (строка выделена) и состояние. Клик открывает заказ. */
import { fmtDate } from '../../lib/dates';
import { tProductionEnum, useT } from '@/i18n';
import { useOrdersReport, type OrderReportRow } from './reports-data';
import { ReportTable, type GroupLevel, type ReportColumn } from './ReportTable';
import { num, ReportState, type TabProps } from './shared';

export function OrdersTab({ filter }: TabProps) {
  const tt = useT();
  const q = useOrdersReport(filter);
  const sum = { format: num };
  const columns: ReportColumn<OrderReportRow>[] = [
    { id: 'item', header: tt('production.reports.col.product'), value: r => r.itemName },
    { id: 'due', header: tt('production.reports.orders.due'), value: r => r.dueDate ?? '', render: r => (r.dueDate ? fmtDate(r.dueDate) : '—') },
    { id: 'state', header: tt('production.reports.orders.state'), value: r => r.state ?? '', render: r => (r.state ? tProductionEnum('productionOrderState', r.state, r.state) : '—') },
    { id: 'opening', header: tt('production.reports.orders.opening'), align: 'r', value: r => r.opening, render: r => num(r.opening), total: sum },
    { id: 'ordered', header: tt('production.reports.orders.ordered'), align: 'r', value: r => r.ordered, render: r => num(r.ordered), total: sum },
    { id: 'produced', header: tt('production.reports.orders.produced'), align: 'r', value: r => r.produced, render: r => num(r.produced), total: sum },
    { id: 'closing', header: tt('production.reports.orders.closing'), align: 'r', value: r => r.closing, render: r => num(r.closing), total: sum },
    { id: 'overdue', header: tt('production.reports.orders.overdue'), align: 'r', value: r => r.overdueDays, render: r => (r.overdueDays ? tt('production.reports.orders.days', { count: r.overdueDays }) : '—') },
  ];
  const title = (r: OrderReportRow) => `${r.number ?? tt('production.common.draft')} · ${fmtDate(r.date)}${r.workCenterName ? ` · ${r.workCenterName}` : ''}`;
  const groups: GroupLevel<OrderReportRow>[] = [{ key: r => r.orderId, label: rows => title(rows[0]!), csv: rows => title(rows[0]!), csvHeader: tt('production.reports.orders.order') }];
  return (
    <ReportState q={q} isEmpty={d => !d.rows.length}>
      {d => <ReportTable rows={d.rows} columns={columns} groups={groups} rowKey={r => r.orderId + r.itemId} href={r => `/production/orders/${r.orderId}`} rowTone={r => (r.overdueDays > 0 ? 'danger' : undefined)} filename="production-orders" label={tt('production.reports.tab.orders')} />}
    </ReportState>
  );
}
