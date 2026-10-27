/* zod-схемы денег (задача 1174б): кассы, статьи ДДС, документы оплат и авансовый отчёт, отчёты. */
import { z } from 'zod';
import { CASH_FLOW_GROUPS, PAYMENT_DOC_TYPES, RECEIPT_OPERATIONS, PAYMENT_OPERATIONS } from '../payments';
import { clientId, decimal, isoDate, listQuery, shortText, toPatch, uuid } from './common';

/* ---------------- кассы и статьи ДДС ---------------- */

export const cashRegisterCreate = z.object({
  id: clientId,
  name: shortText,
  /** Пусто — организация по умолчанию */
  organizationId: uuid.nullish(),
  responsibleId: uuid.nullish(),
});
export const cashRegisterUpdate = toPatch(cashRegisterCreate.omit({ id: true }));
export const cashRegisterQuery = listQuery;

export const cashFlowItemCreate = z.object({
  id: clientId,
  name: shortText,
  kind: z.enum(['income', 'expense']),
  flowGroup: z.enum(CASH_FLOW_GROUPS).default('operating'),
  /** Статья закреплена за инвестпроектом: оплаты по ней идут в кассовый факт проекта */
  investmentProjectId: uuid.nullish(),
});
export const cashFlowItemUpdate = toPatch(cashFlowItemCreate.omit({ id: true, kind: true }));
export const cashFlowItemQuery = listQuery.extend({ kind: z.enum(['income', 'expense']).optional() });

/* ---------------- документы оплат ---------------- */

export const paymentLineInput = z.object({
  /** Свой id нужен, чтобы при правке сохранялись ссылки */
  id: clientId,
  /** Документ расчётов: пусто — аванс (или прочая строка). Сервер приводит к корню цепочки заказ → счёт → реализация */
  settlementDocumentId: uuid.nullish(),
  /** Контрагент строки: только авансовый отчёт (оплата поставщику) */
  counterpartyId: uuid.nullish(),
  contractId: uuid.nullish(),
  amount: decimal.refine(v => Number(v) > 0, 'Amount must be greater than zero'),
  /** Пусто — статья по умолчанию для операции */
  cashFlowItemId: uuid.nullish(),
  costItemId: uuid.nullish(),
  investmentProjectId: uuid.nullish(),
  comment: z.string().trim().max(500).default(''),
});
export type PaymentLineInput = z.infer<typeof paymentLineInput>;

const operationAny = z.enum([...RECEIPT_OPERATIONS, ...PAYMENT_OPERATIONS]);

export const paymentCreate = z.object({
  id: clientId,
  type: z.enum([...PAYMENT_DOC_TYPES, 'advance_report']),
  operation: operationAny.optional(),
  organizationId: uuid.nullish(),
  date: isoDate.optional(),
  /** Касса (кассовые документы) */
  cashRegisterId: uuid.nullish(),
  /** Банковский счёт организации (банковские документы) */
  bankAccountId: uuid.nullish(),
  /** Перемещение денег: куда */
  targetCashRegisterId: uuid.nullish(),
  targetBankAccountId: uuid.nullish(),
  counterpartyId: uuid.nullish(),
  /** Подотчётное лицо (выдача, возврат, авансовый отчёт) */
  accountableMemberId: uuid.nullish(),
  investmentProjectId: uuid.nullish(),
  /** Основание: счёт, заказ, реализация… */
  basedOnId: uuid.nullish(),
  comment: z.string().trim().max(2000).default(''),
  lines: z.array(paymentLineInput).max(500).default([]),
});
export type PaymentCreate = z.infer<typeof paymentCreate>;
export const paymentUpdate = toPatch(paymentCreate.omit({ id: true, type: true }));

export const paymentQuery = listQuery.extend({
  type: z.string().optional(),
  status: z.string().optional(),
  counterpartyId: uuid.optional(),
  cashRegisterId: uuid.optional(),
  bankAccountId: uuid.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

/** Оплата «на основании» документа: счёт, заказ, реализация… — с остатком к оплате */
export const paymentFromDocument = z.object({
  documentId: uuid,
  /** Касса/банк: cash_* или bank_* (приход или расход определяется по документу-основанию) */
  account: z.enum(['cash', 'bank']).default('bank'),
});

/* ---------------- отчёты ---------------- */

export const balancesQuery = z.object({ asOf: isoDate.optional() });
export const cashFlowReportQuery = z.object({
  from: isoDate,
  to: isoDate,
  groupBy: z.enum(['item', 'account', 'month']).default('item'),
  organizationId: uuid.optional(),
});
export const debtReportQuery = z.object({ asOf: isoDate.optional(), companyId: uuid.optional() });
export const settlementQuery = z.object({ from: isoDate.optional(), to: isoDate.optional(), contractId: uuid.optional() });
export const settlementStatusQuery = z.object({
  ids: z.preprocess(v => (typeof v === 'string' ? v.split(',').filter(Boolean) : v), z.array(uuid).max(200)),
});

/* ---------------- банковская выписка (1174в) ---------------- */

export const bankImportPreviewQuery = z.object({ bankAccountId: uuid.optional() });
export const bankImportRow = z.object({
  direction: z.enum(['in', 'out']),
  number: z.string().trim().max(50).default(''),
  /** Дата документа в выписке (входит в ключ повторного импорта) */
  docDate: isoDate,
  /** Дата по счёту: дата созданного документа */
  bookedDate: isoDate,
  amount: decimal.refine(v => Number(v) > 0, 'Amount must be greater than zero'),
  purpose: z.string().trim().max(1000).default(''),
  operation: z.string(),
  counterpartyId: uuid.nullish(),
  settlementDocumentId: uuid.nullish(),
  cashFlowItemId: uuid.nullish(),
  costItemId: uuid.nullish(),
  skip: z.boolean().default(false),
});
export const bankImportCommit = z.object({
  bankAccountId: uuid,
  /** true — сразу провести; false — оставить черновиками */
  post: z.boolean().default(false),
  rows: z.array(bankImportRow).min(1).max(2000),
});
export const paymentOrdersQuery = z.object({ bankAccountId: uuid, from: isoDate.optional(), to: isoDate.optional(), ids: z.string().optional() });
