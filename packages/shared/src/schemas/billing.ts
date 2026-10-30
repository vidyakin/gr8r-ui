/* zod-схемы договоров, тарифных планов и биллинга (этап 8 «УНФ: Услуги»). */
import { z } from 'zod';
import { BILLING_PACKAGES, BILLING_PERIODICITIES, CONTRACT_KINDS, EXTRA_PRODUCT_POLICIES } from '../billing';
import { clientId, decimal, isoDate, listQuery, toPatch, uuid } from './common';

/* ---------------- тарифные планы ---------------- */

export const tariffPlanCreate = z.object({
  id: clientId,
  name: z.string().trim().min(1).max(200),
  /** Что делать при продаже номенклатуры вне плана */
  extraProductPolicy: z.enum(EXTRA_PRODUCT_POLICIES).default('allow'),
  note: z.string().trim().max(5000).default(''),
});
export const tariffPlanUpdate = toPatch(tariffPlanCreate.omit({ id: true }));
export const tariffPlanQuery = listQuery;

export const tariffPlanLineInput = z.object({
  productId: uuid,
  qty: decimal.refine(v => Number(v) > 0, 'Must be greater than zero'),
  price: decimal.refine(v => Number(v) >= 0, 'Must not be negative'),
  /** Включено в абонплату: выставляется каждый период по цене плана */
  isSubscription: z.boolean().default(false),
  /** Представление в счёте: в печатную форму попадает другая номенклатура */
  invoiceAsProductId: uuid.nullish(),
});
export const tariffPlanLinesUpdate = z.object({ lines: z.array(tariffPlanLineInput).max(500) });

/* ---------------- договоры ---------------- */

export const contractCreate = z.object({
  id: clientId,
  /** Контрагент */
  companyId: uuid,
  /** Организация: пусто — организация по умолчанию */
  organizationId: uuid.nullish(),
  /** Номер договора: не уникальный — совпадение только предупреждение */
  number: z.string().trim().max(100).default(''),
  date: isoDate,
  kind: z.enum(CONTRACT_KINDS).default('customer'),
  /** Категория (группа для отбора) */
  category: z.string().trim().max(200).default(''),
  /** Договор подписан */
  isSigned: z.boolean().default(false),
  /** Договор по умолчанию контрагента — подставляется в документы */
  isDefault: z.boolean().optional(),
  validFrom: isoDate,
  /** Конец срока действия: пусто — бессрочный договор */
  validTo: isoDate.nullish(),
  /** Срок оплаты (дней) — подставляется в документы */
  paymentDays: z.coerce.number().int().min(0).max(365).default(0),
  /** Вид цен — подставляется в документы */
  priceType: z.string().trim().max(100).default(''),
  /** Вид цен из справочника (задача 1178) */
  priceKindId: uuid.nullish(),
  /** Договор обслуживания: регулярные услуги с периодичностью */
  isService: z.boolean().default(false),
  /** Тарифный план (обязателен для договора обслуживания) */
  tariffPlanId: uuid.nullish(),
  /** Периодичность биллинга */
  periodicity: z.enum(BILLING_PERIODICITIES).nullish(),
  /** День выставления счёта */
  billingDay: z.coerce.number().int().min(1).max(31).default(1),
  /** Пакет документов: только счёт или счёт и акт */
  documentPackage: z.enum(BILLING_PACKAGES).default('invoice'),
  note: z.string().trim().max(5000).default(''),
});
export const contractUpdate = toPatch(contractCreate.omit({ id: true, companyId: true }));
export const contractQuery = listQuery.extend({
  companyId: uuid.optional(),
  kind: z.enum(CONTRACT_KINDS).optional(),
  isService: z.coerce.boolean().optional(),
  /** 'true' — архивные договоры, иначе действующие */
  archived: z.enum(['true', 'false']).optional(),
});

/* ---------------- биллинг ---------------- */

/** Запуск биллинга за период: ключ периода («2026-10», «2026-Q3», «2026») */
export const billingRunRequest = z.object({
  period: z
    .string()
    .trim()
    .regex(/^\d{4}(?:-(?:Q[1-4]|\d{2}))?$/, 'Period: 2026-10, 2026-Q3 or 2026')
    .optional(),
  /** Договоры: пусто — все договоры обслуживания */
  contractIds: z.array(uuid).max(100).optional(),
});
export const billingPreviewQuery = z.object({
  period: z.string().trim().regex(/^\d{4}(?:-(?:Q[1-4]|\d{2}))?$/).optional(),
  contractIds: z.string().trim().optional(),
});
export const billingReportQuery = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  contractId: uuid.optional(),
});
/** Выгрузка счетов периода архивом. Пустой список — не ошибка схемы, а 422 no_documents в маршруте */
export const billingExportRequest = z.object({ documentIds: z.array(uuid).max(200) });
