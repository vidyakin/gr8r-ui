/* zod-схемы документов, организаций, складов, банковских счетов и склада (остатки, движения, настройки). */
import { z } from 'zod';
import { VAT_RATES } from '../constants';
import { COST_DISTRIBUTIONS } from '../cost-closing';
import { COST_ITEM_KINDS, DOCUMENT_GROUPS, DOCUMENT_STATUSES, DOCUMENT_TYPES, PRINT_FORMS, TRANSFER_OPERATIONS, WAREHOUSE_KINDS } from '../documents';
import { COMPANY_KINDS, TAX_SYSTEMS } from '../ru';
import { clientId, decimal, isoDate, listQuery, queryBool, shortText, toPatch, uuid } from './common';
import { customData } from './meta';

const nonNeg = (max = 1e13) => decimal.refine(v => Number(v) >= 0 && Number(v) < max, 'Must not be negative');
const pct = decimal.refine(v => Number(v) >= 0 && Number(v) <= 100, 'Percent must be between 0 and 100');

/* ---------------- файлы печати и подписи (пока ссылка + метаданные) ---------------- */

/** Ссылка на файл: http(s), путь на этом сервере или картинка в data: URL. Другие схемы (javascript:) не принимаются */
export const fileRef = z
  .object({
    name: z.string().trim().min(1).max(200),
    url: z
      .string()
      .trim()
      .max(300_000)
      .regex(/^(https?:\/\/|\/(?!\/)|data:image\/(png|jpeg|gif|webp);base64,)/i, 'Use an http(s) link, a path on this server or a base64 image'),
    size: z.number().int().min(0).max(100_000_000).optional(),
    mimeType: z.string().max(100).optional(),
  })
  .nullable();
export type FileRef = z.infer<typeof fileRef>;

/* ---------------- организации воркспейса ---------------- */

export const organizationCreate = z.object({
  id: clientId,
  /** Краткое название — в списках и шапках: ООО «Гр8р Студия» */
  name: shortText,
  /** Полное наименование для печатных форм */
  fullName: z.string().trim().max(500).default(''),
  kind: z.enum(COMPANY_KINDS).default('legal'),
  inn: z.string().trim().regex(/^(\d{10}|\d{12})?$/, 'INN: 10 or 12 digits').default(''),
  kpp: z.string().trim().regex(/^([0-9]{4}[0-9A-Z]{2}[0-9]{3})?$/, 'KPP: 9 characters').default(''),
  ogrn: z.string().trim().regex(/^(\d{13}|\d{15})?$/, 'OGRN: 13 digits, OGRNIP: 15 digits').default(''),
  legalAddress: z.string().trim().max(500).default(''),
  actualAddress: z.string().trim().max(500).default(''),
  phone: z.string().trim().max(60).default(''),
  email: z.string().trim().max(254).default(''),
  directorName: z.string().trim().max(200).default(''),
  directorTitle: z.string().trim().max(200).default('Генеральный директор'),
  accountantName: z.string().trim().max(200).default(''),
  taxSystem: z.enum(TAX_SYSTEMS).default('osn'),
  /** Ставка НДС по умолчанию для новых строк документов организации */
  defaultVatRate: z.enum(VAT_RATES).default('20'),
  stampFile: fileRef.default(null),
  directorSignatureFile: fileRef.default(null),
  accountantSignatureFile: fileRef.default(null),
  isDefault: z.boolean().optional(),
});
export const organizationUpdate = toPatch(organizationCreate.omit({ id: true }));
export const organizationQuery = listQuery;

/* ---------------- банковские счета ---------------- */

export const bankAccountCreate = z.object({
  id: clientId,
  bik: z.string().trim().regex(/^04\d{7}$/, 'BIK: 9 digits, starts with 04'),
  account: z.string().trim().regex(/^\d{20}$/, 'Account: 20 digits'),
  corrAccount: z.string().trim().regex(/^(\d{20})?$/, 'Correspondent account: 20 digits').default(''),
  bankName: shortText,
  isDefault: z.boolean().optional(),
  note: z.string().trim().max(500).default(''),
});
export const bankAccountUpdate = toPatch(bankAccountCreate.omit({ id: true }));

/* ---------------- склады ---------------- */

export const warehouseCreate = z.object({
  id: clientId,
  name: shortText,
  code: z.string().trim().max(32).default(''),
  address: z.string().trim().max(500).default(''),
  /** Вид склада: обычный склад, цех участка или служебный «в пути» */
  kind: z.enum(WAREHOUSE_KINDS).default('warehouse'),
  isDefault: z.boolean().optional(),
});
export const warehouseUpdate = toPatch(warehouseCreate.omit({ id: true }));
export const warehouseQuery = listQuery;

/* ---------------- статьи затрат и доходов ---------------- */

export const costItemCreate = z.object({
  id: clientId,
  name: shortText,
  /** Статья затрат (expense) или доходов (income) */
  kind: z.enum(COST_ITEM_KINDS).default('expense'),
  /** База распределения косвенной затраты при закрытии периода */
  distributionMethod: z.enum(COST_DISTRIBUTIONS).default('none'),
});
export const costItemUpdate = toPatch(costItemCreate.omit({ id: true }));
export const costItemQuery = listQuery.extend({ kind: z.enum(COST_ITEM_KINDS).optional() });

/* ---------------- документы ---------------- */

export const documentLineInput = z
  .object({
    /** Свой id нужен, чтобы при правке документа ссылки «на основании» не терялись */
    id: clientId,
    productId: uuid,
    /** Название на момент добавления; пусто — берётся из товара */
    name: z.string().trim().max(500).optional(),
    unitCode: z
      .string()
      .trim()
      .regex(/^\d{3,4}$/)
      .optional(),
    qty: nonNeg(),
    price: nonNeg(),
    discountPct: pct.default('0'),
    /** Пусто — ставка товара */
    vatRate: z.enum(VAT_RATES).optional(),
    /** Учётное количество по остаткам (инвентаризация): разница с qty — недостача или излишек */
    bookQty: nonNeg().optional(),
    /** Принятое количество (перемещение «в пути»): не больше отправленного */
    receivedQty: nonNeg().optional(),
    /** Роль строки выпуска (производства): материал — расход, продукция — приход. У остальных типов её задаёт сервер */
    stockRole: z.enum(['in', 'out']).optional(),
    /** Статья косвенных затрат строки-услуги (поступление) */
    costItemId: uuid.nullish(),
    /** Участок строки-услуги (поступление): участные затраты идут на выпуск своего участка */
    workCenterId: uuid.nullish(),
  })
  // нулевое количество допустимо только у строки инвентаризации: там qty — фактическое, учётное лежит в bookQty
  .refine(l => Number(l.qty) !== 0 || l.bookQty !== undefined, { message: 'Must be greater than zero', path: ['qty'] });
export type DocumentLineInput = z.infer<typeof documentLineInput>;

export const documentCreate = z.object({
  id: clientId,
  type: z.enum(DOCUMENT_TYPES),
  /** Пусто — организация по умолчанию */
  organizationId: uuid.nullish(),
  counterpartyId: uuid.nullish(),
  /** Договор: пусто — договор по умолчанию контрагента */
  contractId: uuid.nullish(),
  warehouseId: uuid.nullish(),
  /** Склад-получатель (перемещение между складами) */
  targetWarehouseId: uuid.nullish(),
  /** Вид перемещения: сразу, «в пути», в эксплуатацию или обратно (только у перемещения) */
  operation: z.enum(TRANSFER_OPERATIONS).optional(),
  /** Получатель в эксплуатацию: участник или участок (ровно один) */
  inUseMemberId: uuid.nullish(),
  inUseWorkCenterId: uuid.nullish(),
  /** Статья затрат или доходов (списание, оприходование) */
  costItemId: uuid.nullish(),
  /** Участок списания: себестоимость уходит в косвенные затраты участка (только у write_off) */
  workCenterId: uuid.nullish(),
  /** Вид заказ-наряда (только у work_order): пусто — вид по умолчанию */
  workOrderKindId: uuid.nullish(),
  /** Пусто — сегодня */
  date: isoDate.optional(),
  dueDate: isoDate.nullish(),
  /** Цены «НДС в т.ч.» (true) или «НДС сверху» (false) */
  priceIncludesVat: z.boolean().default(true),
  comment: z.string().max(5000).default(''),
  responsibleId: uuid.nullish(),
  lines: z.array(documentLineInput).max(500).optional(),
  custom: customData.optional(),
});
export const documentUpdate = toPatch(documentCreate.omit({ id: true, type: true }));

const csv = <T extends z.ZodType>(item: T) => z.preprocess(v => (typeof v === 'string' ? v.split(',').filter(Boolean) : v), z.array(item).max(20));

export const documentQuery = listQuery.extend({
  type: csv(z.enum(DOCUMENT_TYPES)).optional(),
  group: z.enum(DOCUMENT_GROUPS).optional(),
  status: csv(z.enum(DOCUMENT_STATUSES)).optional(),
  organizationId: uuid.optional(),
  counterpartyId: uuid.optional(),
  /** Договор документа */
  contractId: uuid.optional(),
  warehouseId: uuid.optional(),
  basedOnId: uuid.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

export const basedOnCreate = z.object({ type: z.enum(DOCUMENT_TYPES) });
/** Смена состояния документа (отдельно от проведения) */
export const documentStateChange = z.object({
  state: z.string().trim().regex(/^[a-z][a-z0-9_]*$/, 'State key: lowercase letters, digits and underscores'),
  /** Принятые количества по строкам (перемещение «в пути»): не больше отправленного */
  received: z
    .array(z.object({ id: uuid, qty: nonNeg() }))
    .max(500)
    .optional(),
  /** Причина отмены заказ-наряда: обязательна для состояния категории «cancelled» */
  cancelReason: z.string().trim().max(1000).optional(),
});
export const pdfRequest = z.object({ form: z.enum(PRINT_FORMS) });
export const printParam = z.object({ id: uuid, form: z.enum(PRINT_FORMS) });

/* ---------------- склад ---------------- */

export const stockBalanceQuery = z.object({
  warehouseId: uuid.optional(),
  productId: uuid.optional(),
  q: z.string().trim().max(200).optional(),
  /** Скрыть нулевые остатки */
  nonZero: queryBool.optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(500),
  offset: z.coerce.number().int().min(0).default(0),
});
export const stockMoveQuery = z.object({
  warehouseId: uuid.optional(),
  productId: uuid.optional(),
  documentId: uuid.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

/** Настройки склада воркспейса (хранятся в workspaces.settings) */
export const inventorySettingsUpdate = z.object({ allowNegativeStock: z.boolean() });
export interface InventorySettings {
  allowNegativeStock: boolean;
}
