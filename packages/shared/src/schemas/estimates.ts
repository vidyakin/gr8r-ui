/* Смета объекта (задача 1269): тела запросов API. Разделы и позиции сохраняются пакетом целиком
   (как строки документа): существующие позиции по id обновляются, остальные добавляются, пропавшие удаляются. */
import { z } from 'zod';
import { VAT_RATES } from '../constants';
import { ESTIMATE_ITEM_KINDS } from '../estimates';
import { clientId, decimal, isoDate, shortText, uuid } from './common';

export const estimateSectionInput = z.object({
  id: clientId,
  name: shortText,
});

export const estimateItemInput = z.object({
  id: clientId,
  /** Раздел: пусто — позиция вне разделов */
  sectionId: uuid.nullish(),
  kind: z.enum(ESTIMATE_ITEM_KINDS).default('work'),
  name: z.string().trim().min(1).max(500),
  /** Товар каталога: нужен для заказа поставщику (материалы, субподряд) */
  productId: uuid.nullish(),
  unitCode: z.string().trim().min(1).max(20).default('796'),
  qty: decimal,
  /** Цена заказчику без НДС */
  price: decimal,
  vatRate: z.enum(VAT_RATES).default('20'),
  /** Плановая внутренняя стоимость единицы */
  costPrice: decimal.default('0'),
  /** Норма часов на единицу (для работ) */
  laborHours: decimal.default('0'),
  /** Изделие производства (для щитов) */
  manufacturedItemId: uuid.nullish(),
  note: z.string().max(1000).default(''),
  /** Выполненный объём (задача 1272): факт, правится и у согласованной сметы; не больше qty */
  doneQty: decimal.nullish(),
  /** Поставщик строки (материал, субподряд) — только owner/admin; не указан — не трогать */
  supplierId: uuid.nullish(),
  /** Замок строки — только owner/admin; не указан — не трогать */
  locked: z.boolean().optional(),
});

/** Выполненные объёмы позиций сметы: правится и у согласованной сметы — это факт, а не состав */
export const estimateDoneQty = z.object({
  items: z.array(z.object({ id: uuid, doneQty: decimal })).max(2000).default([]),
});

/** Пакетное сохранение содержимого сметы: разделы и позиции одним запросом */
export const estimateContent = z.object({
  sections: z.array(estimateSectionInput).max(200).default([]),
  items: z.array(estimateItemInput).max(2000).default([]),
  /** Единая наценка сметы, % (только owner/admin): null — снять, не указана — не трогать */
  markupPct: decimal.nullable().optional(),
});

/** Цены поставщика для себестоимости: по неархивному виду цен поставщика на сегодня */
export const estimateSupplierPrices = z.object({
  supplierId: uuid,
  productIds: z.array(uuid).min(1).max(500),
});

export const estimateCreate = z.object({
  id: clientId,
  name: shortText,
  /** Номер сметы: пусто — присвоит сервер */
  number: z.string().trim().max(50).default(''),
  note: z.string().max(5000).default(''),
});

export const estimateUpdate = z.object({
  name: shortText.optional(),
  number: z.string().trim().max(50).optional(),
  note: z.string().max(5000).optional(),
});

/** Допработы к согласованной основной смете */
export const estimateChangeCreate = z.object({
  id: clientId,
  name: shortText,
  note: z.string().max(5000).default(''),
});

/** Строка импорта из Excel: колонки уже сопоставлены в интерфейсе */
export const estimateImportRow = z.object({
  section: z.string().trim().max(200).optional(),
  kind: z.enum(ESTIMATE_ITEM_KINDS).optional(),
  name: z.string().trim().min(1).max(500),
  /** Единица: код ОКЕИ или обозначение ('м', 'шт') */
  unit: z.string().trim().max(20).optional(),
  qty: decimal,
  price: decimal,
  costPrice: decimal.optional(),
  laborHours: decimal.optional(),
});

export const estimateImport = z.object({ rows: z.array(estimateImportRow).max(2000) });

/* ---------- импорт сметы из документа (docx) с ИИ-разметкой ---------- */

/** Извлечённая из документа таблица: первая строка — заголовок (хранится в estimate_imports.table).
    rowPages — страница каждой строки (PDF), параллельно rows; без ключа — документ без страниц (docx). */
export const estimateTableFile = z.object({
  header: z.array(z.string()),
  rows: z.array(z.array(z.string())),
  rowPages: z.array(z.number().int().min(1)).optional(),
});

/** Строка сметы после ИИ-разметки документа: числа строками (конвенция), rowNo — строка исходной таблицы.
    skip — ИИ счёл строку служебной (итоги, шапка раздела): в импорт не попадает, пока не включат руками.
    page — страница PDF, откуда строка (у docx отсутствует). */
export const estimateAiRow = z.object({
  rowNo: z.number().int().min(1),
  page: z.number().int().min(1).optional(),
  section: z.string().trim().max(200).optional(),
  kind: z.enum(ESTIMATE_ITEM_KINDS).optional(),
  name: z.string().trim().min(1).max(500),
  unit: z.string().trim().max(20).optional(),
  qty: decimal,
  price: decimal,
  costPrice: decimal.optional(),
  laborHours: decimal.optional(),
  skip: z.boolean().optional(),
  skipReason: z.string().trim().max(200).optional(),
});

/** Разметка документа ИИ: предполагаемое назначение колонок (поле → номер колонки) и очищенные строки сметы */
export const estimateAiResult = z.object({
  mapping: z.record(z.string(), z.number().int().nullable()),
  rows: z.array(estimateAiRow).max(2000),
});

export const MAX_ESTIMATE_PDF_REGIONS = 8;
export const MAX_ESTIMATE_PDF_REGION_CHARS = 1_000_000;

const estimatePdfRegion = z.object({
  page: z.number().int().min(1).max(300),
  image: z.string().max(MAX_ESTIMATE_PDF_REGION_CHARS).regex(/^\/9j\/[A-Za-z0-9+/]*={0,2}$/),
});
export type EstimatePdfRegion = z.infer<typeof estimatePdfRegion>;

/** Запуск разметки PDF по страницам или изображениям выделенных областей. */
export const estimateImportExtract = z.object({
  pages: z.array(z.number().int().min(1)).max(300).optional(),
  regions: z.array(estimatePdfRegion).min(1).max(MAX_ESTIMATE_PDF_REGIONS).optional(),
  hint: z.string().trim().max(1000).optional(),
}).refine(input => !input.regions || !input.pages?.length);

export type EstimateImportExtract = z.infer<typeof estimateImportExtract>;

/** Статус импорта документа: ready — PDF разобран, ждёт выбора страниц; pending — ИИ разметает (задача
    воркера); done — можно показывать; failed — не удалось */
export const ESTIMATE_IMPORT_STATUSES = ['ready', 'pending', 'done', 'failed'] as const;
export type EstimateImportStatus = (typeof ESTIMATE_IMPORT_STATUSES)[number];

/** Ответ POST /estimates/import/document: docx — сразу pending (задача поставлена), pdf — ready
    (выбор страниц и подсказка, затем POST /:id/extract); pageCount/pdfType — только для pdf */
export const estimateImportDocumentResponse = z.object({
  id: uuid,
  status: z.enum(ESTIMATE_IMPORT_STATUSES),
  pageCount: z.number().int().optional(),
  pdfType: z.string().optional(),
  hasText: z.boolean().optional(),
});

/** Ответ GET /estimates/import/:id: таблица документа и разметка ИИ (null — ИИ не настроен или не справился) */
export const estimateImportStatusResponse = z.object({
  id: uuid,
  status: z.enum(ESTIMATE_IMPORT_STATUSES),
  fileName: z.string(),
  table: estimateTableFile,
  aiResult: estimateAiResult.nullable(),
  aiError: z.string().nullable(),
  job: z.object({
    status: z.enum(['queued', 'running', 'done', 'failed']),
    attempt: z.number().int(),
    maxAttempts: z.number().int(),
    retryAt: z.string(),
    error: z.string().nullable(),
  }).nullable().optional(),
  error: z.string().nullable(),
  hint: z.string().nullable(),
  meta: z.record(z.string(), z.unknown()).nullable(),
});

/** Заказ поставщику из позиций сметы */
export const estimateSupplierOrder = z.object({
  /** Поставщик (контрагент) */
  supplierId: uuid,
  date: isoDate.optional(),
  comment: z.string().max(1000).optional(),
  /** Только выбранные позиции: пусто — все материалы и субподряд с товаром */
  itemIds: z.array(uuid).max(2000).optional(),
});

/** Заказ на производство из позиций сметы (щиты) */
export const estimateProductionOrder = z.object({
  date: isoDate.optional(),
  workCenterId: uuid.nullish(),
  comment: z.string().max(1000).optional(),
  itemIds: z.array(uuid).max(2000).optional(),
  /** Заказ по строкам с выбранной спецификацией, количеством и параметрами (окно «Заказ на производство» строки сметы) */
  lines: z
    .array(z.object({ estimateItemId: uuid, manufacturedItemId: uuid, qty: z.union([z.string(), z.number()]).transform(String), params: z.record(z.string(), z.unknown()).optional() }))
    .max(200)
    .optional(),
});

/** Копирование сметы из другого объекта */
export const estimateCopy = z.object({
  /** Смета-источник (своего воркспейса) */
  estimateId: uuid,
  name: shortText.optional(),
});

export type EstimateSectionInput = z.infer<typeof estimateSectionInput>;
export type EstimateItemInput = z.infer<typeof estimateItemInput>;
export type EstimateContentInput = z.infer<typeof estimateContent>;
export type EstimateCreate = z.infer<typeof estimateCreate>;
export type EstimateUpdate = z.infer<typeof estimateUpdate>;
export type EstimateChangeCreate = z.infer<typeof estimateChangeCreate>;
export type EstimateImportRow = z.infer<typeof estimateImportRow>;
export type EstimateTableFile = z.infer<typeof estimateTableFile>;
export type EstimateAiRow = z.infer<typeof estimateAiRow>;
export type EstimateAiResult = z.infer<typeof estimateAiResult>;
export type EstimateImportDocumentResponse = z.infer<typeof estimateImportDocumentResponse>;
export type EstimateImportStatusResponse = z.infer<typeof estimateImportStatusResponse>;
export type EstimateSupplierOrder = z.infer<typeof estimateSupplierOrder>;
export type EstimateProductionOrder = z.infer<typeof estimateProductionOrder>;
export type EstimateSupplierPrices = z.infer<typeof estimateSupplierPrices>;
export type EstimateCopy = z.infer<typeof estimateCopy>;
export type EstimateDoneQty = z.infer<typeof estimateDoneQty>;
