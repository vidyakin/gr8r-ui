/* Акты выполненных работ объекта (задача 1273, docs/architecture/construction.md): три вида выручки —
   по объёмам (КС-2, принятые объёмы × цена согласованной сметы), по вехе этапа (одна строка — сумма вехи)
   и по часам (подтверждённые часы смен × ставка для заказчика). Здесь только константы и чистые расчёты:
   те же функции используют сервер, интерфейс и печатные формы. Деньги — строки через decimal.ts, без float. */
import { dec, fmt, mul } from './decimal';
import { computeDocument, type DocumentTotals } from './documents';

/** Вид акта */
export const OBJECT_ACT_KINDS = ['volumes', 'milestone', 'hours'] as const;
export type ObjectActKind = (typeof OBJECT_ACT_KINDS)[number];

/** Статус акта: черновик (правится) или подписан заказчиком (принято, строки зафиксированы) */
export const OBJECT_ACT_STATUSES = ['draft', 'signed'] as const;
export type ObjectActStatus = (typeof OBJECT_ACT_STATUSES)[number];

/** Названия видов акта по-русски: подписи в интерфейсе берутся из словаря, здесь — заголовки печатных форм */
export const OBJECT_ACT_KIND_LABELS_RU: Record<ObjectActKind, string> = {
  volumes: 'По объёмам (КС-2)',
  milestone: 'По вехе',
  hours: 'По часам',
};

/** Строка акта в объёме, нужном для расчёта суммы */
export interface ObjectActLineLike {
  qty: string;
  price: string;
  vatRate: string;
}

/** Сумма строки акта без НДС: количество × цена до копейки */
export const actLineAmount = (l: { qty: string; price: string }): string => fmt(mul(dec(l.qty), dec(l.price)), 2);

/** Итоги акта: без НДС, НДС по ставкам строк, всего с НДС (та же арифметика, что в документах) */
export function computeActTotals(lines: ObjectActLineLike[]): DocumentTotals {
  return computeDocument(
    lines.map(l => ({ qty: l.qty, price: l.price, vatRate: l.vatRate })),
    false,
  ).totals;
}

/** Сводка выручки объекта: выполнено (по смете), принято (подписанные акты), выставлено (документы), оплачено */
export interface ObjectRevenueAmounts {
  /** Выполнено: сумма done_qty × цена позиций согласованной сметы без НДС */
  done: string | null;
  /** Принято заказчиком: сумма подписанных актов без НДС */
  accepted: string | null;
  /** Выставлено: сумма документов «Акт оказания услуг», созданных из актов, без НДС */
  invoiced: string | null;
  /** Оплачено: оплаты по документам актов (счёт и акт) */
  paid: string | null;
}

/** Пустая сводка: пока актов нет, все показатели нулевые (кроме «выполнено» — его считает сервис по смете) */
export const EMPTY_REVENUE_AMOUNTS: ObjectRevenueAmounts = { done: null, accepted: '0.00', invoiced: '0.00', paid: '0.00' };

/** Номер акта: КС-<код объекта>-<порядковый номер>; код объекта без пробелов, порядковый — по числу актов объекта */
export const objectActNumber = (objectNumber: string, seq: number): string => {
  const code = objectNumber.replace(/\s+/g, '').toUpperCase() || 'OBJ';
  return `КС-${code}-${String(seq).padStart(2, '0')}`;
};
