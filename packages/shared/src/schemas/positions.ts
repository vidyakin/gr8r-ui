/* zod-схемы должностей и видов номенклатуры (задача 1172). */
import { z } from 'zod';
import { POSITION_FUNCTIONS, POSITION_SECTIONS, PRODUCT_KIND_TYPES } from '../positions';
import { uuid } from './common';

const name = z.string().trim().min(1).max(120);

const sortOrder = z.number().int().min(0).max(1_000_000);
const functions = z.array(z.enum(POSITION_FUNCTIONS)).max(POSITION_FUNCTIONS.length);
/** Пусто — все разделы */
const sections = z.array(z.enum(POSITION_SECTIONS)).max(POSITION_SECTIONS.length);
/** Оказываемые виды номенклатуры (имеет смысл с функцией appointments_specialist) */
const kindIds = z.array(uuid).max(200);

export const productKindSave = z.object({ name, type: z.enum(PRODUCT_KIND_TYPES).default('goods'), sortOrder: sortOrder.optional() });
// у обновления значений по умолчанию нет: непришедшее поле не меняется
export const productKindUpdate = z.object({ name: name.optional(), type: z.enum(PRODUCT_KIND_TYPES).optional(), sortOrder: sortOrder.optional() });

export const positionSave = z.object({ name, functions: functions.default([]), sections: sections.default([]), productKindIds: kindIds.default([]), sortOrder: sortOrder.optional() });
export const positionUpdate = z.object({ name: name.optional(), functions: functions.optional(), sections: sections.optional(), productKindIds: kindIds.optional(), sortOrder: sortOrder.optional() });

export const memberPositionsSet = z.object({ positionIds: z.array(uuid).max(50) });
