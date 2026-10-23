/* zod-схемы калькуляции заказа покупателя (этап 7): плановая себестоимость изделий по спецификациям с параметрами
   и разовые расходы (доставка и т. п.), источник цены себестоимости и наценка. */
import { z } from 'zod';
import { CALC_LINE_TYPES, COST_PRICE_SOURCES } from '../constants';
import { clientId, decimal, listQuery, shortText, toPatch, uuid } from './common';

const nonNeg = (max = 1e13) => decimal.refine(v => Number(v) >= 0 && Number(v) < max, 'Must not be negative');

/** Параметры калькуляции: источник цены себестоимости и наценка, % */
export const calculationUpdate = z
  .object({
    /** avg — средняя склада, last_purchase — последняя цена закупки, purchase_price — закупочная цена товара.
        Нет цены по выбранному способу — берётся следующий по порядку */
    priceSource: z.enum(COST_PRICE_SOURCES).default('avg'),
    /** Наценка, % от себестоимости */
    markupPct: nonNeg(1000).default('0'),
  })
  .strict();

/** Разовый расход калькуляции (доставка и т. п.): строки заменяются целиком */
export const calculationExtraLine = z.object({
  id: clientId,
  name: shortText,
  qty: nonNeg().default('1'),
  price: nonNeg(),
  note: z.string().trim().max(500).default(''),
});

/** Правка строк расчёта калькуляции: состав по спецификациям пересчитывается кнопкой, вручную правятся разовые расходы */
export const calculationLinesUpdate = z.object({ extra: z.array(calculationExtraLine).max(100).default([]) });
export const calculationCreate = calculationUpdate.extend({ customerOrderId: uuid });
export const calculationPatch = toPatch(calculationUpdate.partial());

/** Применить цену к строкам заказа: цена строки = себестоимость единицы × (1 + наценка) */
export const calculationApply = z.object({ documentId: uuid }).strict();

export const calculationQuery = listQuery.extend({ customerOrderId: uuid.optional() });
export const calculationLineTypes = CALC_LINE_TYPES;