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
});

/** Пакетное сохранение содержимого сметы: разделы и позиции одним запросом */
export const estimateContent = z.object({
  sections: z.array(estimateSectionInput).max(200).default([]),
  items: z.array(estimateItemInput).max(2000).default([]),
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
export type EstimateSupplierOrder = z.infer<typeof estimateSupplierOrder>;
export type EstimateProductionOrder = z.infer<typeof estimateProductionOrder>;
export type EstimateCopy = z.infer<typeof estimateCopy>;
