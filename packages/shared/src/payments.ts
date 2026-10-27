/* Деньги (задача 1174б): виды операций оплат, системные статьи ДДС и чистые расчёты взаиморасчётов.
   Без БД: те же функции использует сервер при проведении и интерфейс. Правила — docs/architecture/payments.md. */
import { dec, type Dec } from './decimal';
import type { DocumentType } from './documents';

/* ---------------- типы документов и операции ---------------- */

export const PAYMENT_DOC_TYPES = ['cash_receipt', 'cash_payment', 'bank_receipt', 'bank_payment'] as const;
export type PaymentDocType = (typeof PAYMENT_DOC_TYPES)[number];
export const isPaymentType = (t: string): t is PaymentDocType => (PAYMENT_DOC_TYPES as readonly string[]).includes(t);
export const isReceiptType = (t: PaymentDocType): boolean => t === 'cash_receipt' || t === 'bank_receipt';
export const accountKindOfType = (t: PaymentDocType): 'cash' | 'bank' => (t === 'cash_receipt' || t === 'cash_payment' ? 'cash' : 'bank');
/** Документы раздела «Деньги» (свои маршруты, не общий CRUD документов): оплаты, авансовый отчёт, заявка на расход, ввод остатков */
export const isCashDocType = (t: string): boolean => isPaymentType(t) || t === 'advance_report' || t === 'payment_request' || t === 'opening_balance';

/** Операции поступлений и выплат (documents.operation) */
export const RECEIPT_OPERATIONS = ['from_customer', 'supplier_refund', 'from_accountable', 'other_income'] as const;
export const PAYMENT_OPERATIONS = ['to_supplier', 'customer_refund', 'to_accountable', 'other_expense', 'money_transfer'] as const;
export type PaymentOperation = (typeof RECEIPT_OPERATIONS)[number] | (typeof PAYMENT_OPERATIONS)[number];
export const operationsOfType = (t: PaymentDocType): readonly PaymentOperation[] => (isReceiptType(t) ? RECEIPT_OPERATIONS : PAYMENT_OPERATIONS);
export const PAYMENT_OPERATION_LABELS: Record<PaymentOperation, string> = {
  from_customer: 'From customer',
  supplier_refund: 'Refund from supplier',
  from_accountable: 'From accountable person',
  other_income: 'Other income',
  to_supplier: 'To supplier',
  customer_refund: 'Refund to customer',
  to_accountable: 'To accountable person',
  other_expense: 'Other expense',
  money_transfer: 'Money transfer',
};
export const PAYMENT_OPERATION_LABELS_RU: Record<PaymentOperation, string> = {
  from_customer: 'Оплата от покупателя',
  supplier_refund: 'Возврат от поставщика',
  from_accountable: 'Возврат от подотчётного лица',
  other_income: 'Прочий доход',
  to_supplier: 'Оплата поставщику',
  customer_refund: 'Возврат покупателю',
  to_accountable: 'Выдача подотчётному лицу',
  other_expense: 'Прочий расход',
  money_transfer: 'Перемещение денег',
};

/** С кем расчёты по операции: сторона и что делает строка — гасит долг документа или возвращается через аванс */
export interface OperationSettlement {
  side: 'customer' | 'supplier';
  /** pay — оплата гасит долг (с авансом сверх долга); refund — возврат денег, уменьшает аванс */
  mode: 'pay' | 'refund';
}
export function operationSettlement(op: string | null): OperationSettlement | null {
  switch (op) {
    case 'from_customer':
      return { side: 'customer', mode: 'pay' };
    case 'to_supplier':
      return { side: 'supplier', mode: 'pay' };
    case 'customer_refund':
      return { side: 'customer', mode: 'refund' };
    case 'supplier_refund':
      return { side: 'supplier', mode: 'refund' };
    default:
      return null;
  }
}
/** Операции с контрагентом в шапке */
export const operationNeedsCounterparty = (op: string | null): boolean => operationSettlement(op) !== null;
/** Операции с подотчётным лицом в шапке */
export const operationNeedsAccountable = (op: string | null): boolean => op === 'to_accountable' || op === 'from_accountable';

/* ---------------- статьи ДДС ---------------- */

export type CashFlowKind = 'income' | 'expense';
export const CASH_FLOW_GROUPS = ['operating', 'investing', 'financing'] as const;
export type CashFlowGroup = (typeof CASH_FLOW_GROUPS)[number];
export const CASH_FLOW_GROUP_LABELS_RU: Record<CashFlowGroup, string> = { operating: 'Текущая деятельность', investing: 'Инвестиционная деятельность', financing: 'Финансовая деятельность' };

export interface SystemCashFlowItem {
  key: string;
  name: string;
  kind: CashFlowKind;
  group: CashFlowGroup;
  /** Внутреннее движение: в итогах ДДС по статьям не участвует (деньги остались в компании) */
  internal?: boolean;
}
/** Системные статьи (названия по-русски: данные, а не интерфейс). Поступления и выплаты — отдельные статьи одного названия */
export const SYSTEM_CASH_FLOW_ITEMS: SystemCashFlowItem[] = [
  { key: 'customers_payment', name: 'Оплата от покупателей', kind: 'income', group: 'operating' },
  { key: 'suppliers_payment', name: 'Оплата поставщикам', kind: 'expense', group: 'operating' },
  { key: 'refund_in', name: 'Возвраты', kind: 'income', group: 'operating' },
  { key: 'refund_out', name: 'Возвраты', kind: 'expense', group: 'operating' },
  { key: 'transfer_in', name: 'Перемещение денег', kind: 'income', group: 'operating', internal: true },
  { key: 'transfer_out', name: 'Перемещение денег', kind: 'expense', group: 'operating', internal: true },
  { key: 'accountable_in', name: 'Подотчёт', kind: 'income', group: 'operating', internal: true },
  { key: 'accountable_out', name: 'Подотчёт', kind: 'expense', group: 'operating', internal: true },
  // начальные остатки касс и счетов: входят в остатки, но не в обороты «Движения денег»
  { key: 'opening_balance', name: 'Начальные остатки', kind: 'income', group: 'operating', internal: true },
];
export const INTERNAL_CASH_FLOW_KEYS = SYSTEM_CASH_FLOW_ITEMS.filter(i => i.internal).map(i => i.key);

/** Ключ статьи ДДС по умолчанию для операции; для прочих доходов и расходов статью выбирает пользователь */
export function defaultCashFlowKey(op: string | null): string | null {
  switch (op) {
    case 'from_customer':
      return 'customers_payment';
    case 'to_supplier':
      return 'suppliers_payment';
    case 'supplier_refund':
      return 'refund_in';
    case 'customer_refund':
      return 'refund_out';
    case 'money_transfer':
      return 'transfer_out';
    case 'to_accountable':
      return 'accountable_out';
    case 'from_accountable':
      return 'accountable_in';
    default:
      return null;
  }
}

/* ---------------- взаиморасчёты: чистые расчёты ---------------- */

export const SETTLEMENT_MODES = ['by_documents', 'by_counterparty'] as const;
export type SettlementMode = (typeof SETTLEMENT_MODES)[number];
export const SETTLEMENT_MODE_LABELS: Record<SettlementMode, string> = { by_documents: 'By documents', by_counterparty: 'By counterparty' };

/** Типы документов, начисляющих долг (проведение): знак — растёт или уменьшается долг. Заказ-наряд начисляет в состоянии «выполнен» */
export const ACCRUAL_TYPES: Partial<Record<DocumentType, { side: 'customer' | 'supplier'; sign: 1 | -1 }>> = {
  realization: { side: 'customer', sign: 1 },
  act: { side: 'customer', sign: 1 },
  work_order: { side: 'customer', sign: 1 },
  customer_return: { side: 'customer', sign: -1 },
  receipt: { side: 'supplier', sign: 1 },
  supplier_return: { side: 'supplier', sign: -1 },
};
/** Документы-заказы и счета: по ним принимают предоплату до начисления, обязательство — не меньше суммы документа */
export const PREPAY_TYPES: DocumentType[] = ['customer_order', 'invoice', 'work_order', 'supplier_order'];
/** Документы цепочки, вверх по которой ищется документ расчётов */
export const SETTLEMENT_CHAIN_TYPES: DocumentType[] = ['customer_order', 'invoice', 'realization', 'act', 'receipt', 'supplier_order', 'work_order'];
/** Документы, по которым в интерфейсе показывается «оплачено / к оплате» и от которых создаётся оплата (кнопка «Оплатить»; возвраты — выплата/поступление обратной стороны) */
export const PAYABLE_TYPES: DocumentType[] = ['customer_order', 'invoice', 'realization', 'act', 'work_order', 'receipt', 'supplier_order', 'customer_return', 'supplier_return'];

/** Обязательство по документу расчётов: заказ/счёт — не меньше своей суммы, остальные — только начисленное */
export function obligation(prepay: boolean, docTotal: string | bigint, accrued: string | bigint): bigint {
  const t = typeof docTotal === 'bigint' ? docTotal : dec(docTotal);
  const a = typeof accrued === 'bigint' ? accrued : dec(accrued);
  return prepay ? (t > a ? t : a) : a;
}

/** Оплата строки: часть гасит долг документа, остаток сверх долга — аванс. Долг не отрицателен */
export function splitPayment(debt: Dec, amount: Dec): { toDocument: Dec; advance: Dec } {
  const d = debt > 0n ? debt : 0n;
  const toDocument = amount < d ? amount : d;
  return { toDocument, advance: amount - toDocument };
}

export interface FifoItem {
  id: string;
  date: string;
  amount: Dec;
}
/** Распределение общей суммы оплат по документам в порядке дат (FIFO): режим «по контрагенту» показывает так, какой документ оплачен.
    Возвращает оплаченную часть каждого документа; нераспределённый остаток (аванс) — во втором поле */
export function allocateFifo(items: FifoItem[], paid: Dec): { paid: Map<string, Dec>; advance: Dec } {
  const sorted = items.map((it, i) => ({ ...it, i })).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.i - b.i));
  let left = paid > 0n ? paid : 0n;
  const out = new Map<string, Dec>();
  for (const it of sorted) {
    const part = it.amount > 0n ? (left < it.amount ? left : it.amount) : 0n;
    out.set(it.id, part);
    left -= part;
  }
  return { paid: out, advance: left };
}

export interface AdvanceSource {
  key: string;
  date: string;
  remaining: Dec;
}
/** Зачёт аванса в счёт долга по FIFO (старший аванс первым): сколько списать с каждого источника */
export function planOffset(debt: Dec, sources: AdvanceSource[]): { key: string; amount: Dec }[] {
  const out: { key: string; amount: Dec }[] = [];
  let left = debt;
  for (const s of [...sources].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))) {
    if (left <= 0n) break;
    if (s.remaining <= 0n) continue;
    const take = s.remaining < left ? s.remaining : left;
    out.push({ key: s.key, amount: take });
    left -= take;
  }
  return out;
}

/** Просрочка в днях на дату `asOf` (0 — не просрочено или срока нет) */
export function overdueDays(dueDate: string | null, asOf: string): number {
  if (!dueDate || dueDate >= asOf) return 0;
  return Math.round((Date.parse(asOf) - Date.parse(dueDate)) / 86_400_000);
}

/** Ведро просрочки для отчёта: 0 — в срок, 1–30, 31–60, 61–90, 90+ */
export const OVERDUE_BUCKETS = ['current', 'd1_30', 'd31_60', 'd61_90', 'd90_plus'] as const;
export type OverdueBucket = (typeof OVERDUE_BUCKETS)[number];
export function overdueBucket(days: number): OverdueBucket {
  if (days <= 0) return 'current';
  if (days <= 30) return 'd1_30';
  if (days <= 60) return 'd31_60';
  if (days <= 90) return 'd61_90';
  return 'd90_plus';
}

/** Оплата документа для списков: нет начисления/оплат, частично, полностью, переплата */
export type PaymentState = 'unpaid' | 'partial' | 'paid';
export function paymentState(obligationAmount: Dec, paid: Dec): PaymentState {
  if (paid <= 0n) return 'unpaid';
  return paid >= obligationAmount ? 'paid' : 'partial';
}

export const PAYMENT_STATE_LABELS_RU: Record<PaymentState, string> = { unpaid: 'Не оплачен', partial: 'Оплачен частично', paid: 'Оплачен' };

/* ---------------- ввод начальных остатков ---------------- */

/** Строка остатков: касса или счёт организации; долг и аванс контрагента (покупатель — нам, поставщик — мы) */
export const OPENING_LINE_KINDS = ['cash', 'bank', 'customer_debt', 'customer_advance', 'supplier_debt', 'supplier_advance'] as const;
export type OpeningLineKind = (typeof OPENING_LINE_KINDS)[number];
export const isOpeningMoneyKind = (k: string): boolean => k === 'cash' || k === 'bank';
/** Сторона расчётов и знак в регистре «долг растёт» (+): долг — приход начисления, аванс — оплата без документа */
export function openingSettlement(k: OpeningLineKind): { side: 'customer' | 'supplier'; advance: boolean } | null {
  switch (k) {
    case 'customer_debt': return { side: 'customer', advance: false };
    case 'customer_advance': return { side: 'customer', advance: true };
    case 'supplier_debt': return { side: 'supplier', advance: false };
    case 'supplier_advance': return { side: 'supplier', advance: true };
    default: return null;
  }
}
