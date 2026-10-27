/* Серийные номера: чистые правила переходов состояния без БД (задача 1099, docs/architecture/serials-repair.md).
   Состояние номера — результат журнала событий по порядку: сервер применяет те же правила при проведении и при проверке
   отмены проведения, интерфейс показывает подписи. Деньги и количества здесь не участвуют. */

export const SERIAL_STATUSES = ['in_stock', 'sold', 'written_off', 'in_transit'] as const;
export type SerialStatus = (typeof SERIAL_STATUSES)[number];
export const SERIAL_STATUS_LABELS: Record<SerialStatus, string> = { in_stock: 'In stock', sold: 'Sold', written_off: 'Written off', in_transit: 'In transit' };

/** Тип вида заказ-наряда: обычный, ремонт, гарантийный ремонт */
export const WORK_ORDER_KIND_TYPES = ['regular', 'repair', 'warranty'] as const;
export type WorkOrderKindType = (typeof WORK_ORDER_KIND_TYPES)[number];
export const WORK_ORDER_KIND_TYPE_LABELS: Record<WorkOrderKindType, string> = { regular: 'Regular', repair: 'Repair', warranty: 'Warranty repair' };
export const isRepairKind = (t: string | null | undefined): boolean => t === 'repair' || t === 'warranty';

/** Системная статья затрат гарантийного ремонта */
export const WARRANTY_COST_ITEM_KEY = 'garantiynyy_remont';

/** Документы, которыми номер уходит покупателю */
const SALE_TYPES = ['realization', 'work_order'];

/** Состояние номера после движения документа */
export function serialStatusAfter(docType: string, direction: 'in' | 'out'): SerialStatus {
  if (direction === 'in') return 'in_stock';
  if (docType === 'stock_transfer') return 'in_transit';
  return SALE_TYPES.includes(docType) ? 'sold' : 'written_off';
}

export interface SerialState {
  status: SerialStatus;
  warehouseId: string | null;
}
export interface SerialEventInput {
  docType: string;
  direction: 'in' | 'out';
  warehouseId: string | null;
}

/** Код ошибки перехода или null. prev === null — номера ещё нет в реестре */
export function checkSerialTransition(prev: SerialState | null, ev: SerialEventInput): string | null {
  if (ev.direction === 'out') {
    if (!prev || prev.status !== 'in_stock') return 'serial_not_in_stock';
    if (prev.warehouseId !== ev.warehouseId) return 'serial_wrong_warehouse';
    return null;
  }
  if (!prev) return ev.docType === 'customer_return' || ev.docType === 'stock_transfer' ? 'serial_unknown' : null;
  if (ev.docType === 'stock_transfer') return prev.status === 'in_transit' ? null : 'serial_not_in_transit';
  if (prev.status === 'in_stock') return 'serial_in_stock';
  if (prev.status === 'in_transit') return 'serial_in_transit';
  if (ev.docType === 'customer_return' && prev.status !== 'sold') return 'serial_not_sold';
  return null;
}

/** Состояние после события (склад только у «на складе») */
export function applySerialEvent(ev: SerialEventInput): SerialState {
  const status = serialStatusAfter(ev.docType, ev.direction);
  return { status, warehouseId: status === 'in_stock' ? ev.warehouseId : null };
}

/** Прогон журнала: итоговое состояние или индекс события, нарушившего правила (проверка отмены проведения) */
export function replaySerialEvents(events: SerialEventInput[]): { state: SerialState | null; badIndex: number | null; code: string | null } {
  let state: SerialState | null = null;
  for (const [i, ev] of events.entries()) {
    const code = checkSerialTransition(state, ev);
    if (code) return { state, badIndex: i, code };
    state = applySerialEvent(ev);
  }
  return { state, badIndex: null, code: null };
}

/** Дата + месяцы (конец месяца обрезается: 31.01 + 1 мес. = 28/29.02) */
export function addMonthsISO(date: string, months: number): string {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7)) - 1 + months;
  const year = y + Math.floor(m / 12);
  const month = ((m % 12) + 12) % 12;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(Number(date.slice(8, 10)), last);
  return `${String(year).padStart(4, '0')}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Гарантия действует на дату */
export const warrantyActive = (until: string | null | undefined, today: string): boolean => !!until && until >= today;

/** Нормализация введённого номера: пробелы по краям убираются */
export const normalizeSerial = (s: string): string => s.trim();
