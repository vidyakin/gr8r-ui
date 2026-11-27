/* zod-схемы API дополнительных расходов (задача 1385): документ, строки распределения, запросы журнала и отчёта. */
import { z } from 'zod';
import { LANDED_COST_BASE_TYPES, LANDED_COST_METHODS } from '../landed-costs';
import { clientId, decimal, isoDate, listQuery, uuid } from './common';

const money = (max = 1e12) => decimal.refine(v => Number(v) >= 0 && Number(v) < max, 'Must not be negative');
const positive = (max = 1e12) => decimal.refine(v => Number(v) > 0 && Number(v) < max, 'Must be greater than zero');

/** Строка распределения: строка документа-основания и (для способа «вручную») сумма доли */
export const landedCostLineInput = z.object({
  id: clientId,
  /** Документ-основание: поступление или выпуск продукции */
  baseDocumentId: uuid,
  /** Строка-товар документа-основания, приход которой удорожается */
  baseDocumentLineId: uuid,
  /** Доля строки; задаётся только при способе «вручную», иначе её считает сервер */
  amount: money().nullish(),
});

export const landedCostCreate = z.object({
  id: clientId,
  /** Пусто — организация по умолчанию */
  organizationId: uuid.nullish(),
  date: isoDate.optional(),
  /** Контрагент-исполнитель услуги (перевозчик, таможенный брокер) */
  supplierId: uuid.nullish(),
  /** Статья расходов: доставка, пошлина, погрузка */
  costItemId: uuid.nullish(),
  /** Счёт или документ поставщика услуги, если он есть в системе */
  supplierDocumentId: uuid.nullish(),
  /** Номер и дата счёта поставщика строкой, если документа в системе нет */
  supplierDocument: z.string().trim().max(200).default(''),
  /** Способ распределения по строкам оснований */
  method: z.enum(LANDED_COST_METHODS).default('by_amount'),
  /** Общая сумма расходов; при способе «вручную» её даёт сумма строк */
  amount: positive().nullish(),
  comment: z.string().max(5000).default(''),
  lines: z.array(landedCostLineInput).min(1).max(500),
});
export const landedCostUpdate = z.object({
  organizationId: uuid.nullish(),
  date: isoDate.optional(),
  supplierId: uuid.nullish(),
  costItemId: uuid.nullish(),
  supplierDocumentId: uuid.nullish(),
  supplierDocument: z.string().trim().max(200).optional(),
  method: z.enum(LANDED_COST_METHODS).optional(),
  amount: positive().nullish(),
  comment: z.string().max(5000).optional(),
  lines: z.array(landedCostLineInput).min(1).max(500).optional(),
});
export const landedCostQuery = listQuery.extend({ from: isoDate.optional(), to: isoDate.optional() });

/** Отчёт по доп. расходам за период: границы периода обязательны (по умолчанию — текущий месяц во фронтенде) */
export const landedCostReportQuery = z.object({ from: isoDate, to: isoDate });

/** Основания для выбора в форме: проведённые поступления и выпуски за период */
export const landedCostBasesQuery = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  type: z.enum(LANDED_COST_BASE_TYPES).optional(),
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
