/* Субподряд на объекте (задача 1274, docs/architecture/construction.md): статусы акта субподрядчика и чистые расчёты
   сводки. Заказ субподрядчику — существующий документ supplier_order с object_id (строки-услуги заказа),
   акт субподрядчика — документ подрядчика с приёмкой: только принятое количество идёт в поступление услуг.
   Деньги — строки через decimal.ts, без float: те же расчёты используют сервер и интерфейс. */
import { dec, fmt, mul } from './decimal';

/** Статус акта субподрядчика: черновик правится, принятый даёт поступление услуг, отклонённый целиком — нет */
export const OBJECT_SUB_ACT_STATUSES = ['draft', 'accepted', 'rejected'] as const;
export type ObjectSubActStatus = (typeof OBJECT_SUB_ACT_STATUSES)[number];

/** Сумма строки акта субподрядчика: количество × цена до копейки */
export const subActLineAmount = (l: { qty: string; price: string }): string => fmt(mul(dec(l.qty), dec(l.price)), 2);

/** Сумма отклонённой части строки: (предъявлено − принято) × цена */
export const subActRejectedAmount = (l: { qty: string; acceptedQty: string; price: string }): string =>
  fmt(mul(dec(l.qty) - dec(l.acceptedQty), dec(l.price)), 2);

/** Номер акта субподрядчика: СА-<код объекта>-<порядковый номер>; код объекта без пробелов */
export const objectSubActNumber = (objectNumber: string, seq: number): string => {
  const code = objectNumber.replace(/\s+/g, '').toUpperCase() || 'OBJ';
  return `СА-${code}-${String(seq).padStart(2, '0')}`;
};

/** Сводка субподряда по объекту: пять отдельных состояний, они не смешиваются */
export interface ObjectSubcontractAmounts {
  /** Заказано: сумма строк-услуг заказов субподрядчикам без НДС; null — заказов нет */
  ordered: string | null;
  /** Предъявлено: строки актов, которые ещё не отклонены целиком (черновики и принятые) */
  presented: string;
  /** Принято: принятые количества принятых актов */
  accepted: string;
  /** Отклонено: отклонённые количества принятых актов и акты, отклонённые целиком */
  rejected: string;
  /** Оплачено: оплаты по поступлениям услуг, созданным при приёмке */
  paid: string;
}

export const EMPTY_SUBCONTRACT_AMOUNTS: ObjectSubcontractAmounts = {
  ordered: null,
  presented: '0.00',
  accepted: '0.00',
  rejected: '0.00',
  paid: '0.00',
};

/** Отклонённое количество по причине: справочник причин брака (defect_reasons) */
export interface ObjectSubcontractRejectReason {
  /** Причина отклонения: null — причина не указана (акт отклонён целиком без причины быть не может, но строка могла остаться) */
  reasonId: string | null;
  reasonName: string;
  /** Сумма отклонённого по причине без НДС */
  amount: string;
  /** Количество отклонённого (в единицах строк, суммируется по разным единицам) */
  qty: string;
}
