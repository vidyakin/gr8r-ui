/* Статус проведения значком — первая узкая колонка журналов документов (без заголовка):
   двойная зелёная галка — проведён, серый контурный кружок — черновик, красный запрет — отменён. */
import { Ban, CheckCheck, Circle } from 'lucide-react';
import type { DocumentStatus } from '@erp/shared';
import type { Column } from '@/components/erp/data-table';
import { STATUS_LABEL } from './data';

/** Значок статуса: подпись — во всплывающей подсказке и для экранного диктора */
export function DocStatusIcon({ status }: { status: DocumentStatus }) {
  const label = STATUS_LABEL[status];
  const icon =
    status === 'posted' ? <CheckCheck size={15} style={{ color: 'var(--green)' }} /> : status === 'cancelled' ? <Ban size={14} style={{ color: 'var(--red)' }} /> : <Circle size={12} strokeWidth={2} style={{ color: 'var(--text-3)' }} />;
  return (
    <span role="img" aria-label={label} title={label} style={{ display: 'inline-flex', width: 16, justifyContent: 'center', alignItems: 'center', verticalAlign: 'middle' }}>
      {icon}
    </span>
  );
}

/** Колонка статуса для DataTable: ставится первой, 32 px, ширина не меняется. У таблицы задайте totalLabelCol={1} */
export function docStatusColumn<T>(get: (row: T) => DocumentStatus): Column<T> {
  return { id: 'status', header: '', width: 32, resizable: false, icon: true, value: r => STATUS_LABEL[get(r)], cell: r => <DocStatusIcon status={get(r)} /> };
}
