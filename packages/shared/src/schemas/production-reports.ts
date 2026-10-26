/* zod-запросы отчётов производства (задача 1091), раздел docs/architecture/production-reports.md. */
import { z } from 'zod';
import { isoDate, uuid } from './common';

/** Период отчёта */
const period = { from: isoDate, to: isoDate };

/** Выпуск продукции: период, участок, изделие */
export const releaseReportQuery = z.object({ ...period, workCenterId: uuid.optional(), itemId: uuid.optional() });

/** Заказы на производство: период, участок, изделие; дата «сегодня» нужна для просрочки */
export const ordersReportQuery = z.object({ ...period, workCenterId: uuid.optional(), itemId: uuid.optional(), today: isoDate.optional() });

/** План-факт производства: период, изделие */
export const planFactReportQuery = z.object({ ...period, itemId: uuid.optional() });

/** Виды цен нормативного состава: по виду цен (закупочная, продажи, средняя склада) или по последней закупке */
export const BOM_REPORT_PRICE_MODES = ['price_kind', 'last_purchase'] as const;
export const BOM_REPORT_PRICE_KINDS = ['purchase', 'price', 'avg_cost'] as const;

/** Нормативный состав изделия: изделие и количество, цена */
export const bomReportQuery = z.object({
  itemId: uuid,
  qty: z.string().regex(/^\d+(\.\d{1,3})?$/).default('1'),
  priceMode: z.enum(BOM_REPORT_PRICE_MODES).default('price_kind'),
  priceKind: z.enum(BOM_REPORT_PRICE_KINDS).default('purchase'),
  /** Значения параметров спецификации (JSON-объект в строке запроса): число, вариант, флажок */
  params: z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (!v) return undefined;
      try {
        const o: unknown = JSON.parse(v);
        if (o && typeof o === 'object' && !Array.isArray(o)) return o as Record<string, unknown>;
      } catch {
        /* ниже — ошибка проверки */
      }
      ctx.addIssue({ code: 'custom', message: 'params must be a JSON object' });
      return z.NEVER;
    }),
});

/** Загрузка участков: период, участок */
export const loadReportQuery = z.object({ ...period, workCenterId: uuid.optional() });

/** Себестоимость выпуска и план-факт себестоимости: период, участок, изделие */
export const releaseCostReportQuery = z.object({ ...period, workCenterId: uuid.optional(), itemId: uuid.optional() });
export const costPlanFactReportQuery = releaseCostReportQuery;

/** НЗП с движением: период, участок */
export const wipMovementReportQuery = z.object({ ...period, workCenterId: uuid.optional() });
