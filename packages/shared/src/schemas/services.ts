/* zod-схемы заказ-наряда: виды заказ-нарядов, настраиваемые состояния, материалы и назначения (исполнители). */
import { z } from 'zod';
import { WORK_ORDER_BILLING_MODES, WORK_ORDER_STATE_CATEGORIES } from '../documents';
import { clientId, color, decimal, isoDate, isoDateTime, listQuery, shortText, toPatch, uuid } from './common';

const positive = decimal.refine(v => Number(v) > 0, 'Must be greater than zero');

/* ---------------- виды заказ-нарядов ---------------- */

export const workOrderKindCreate = z.object({
  id: clientId,
  /** Название вида: «Ремонт», «Монтаж», «Обслуживание» */
  name: shortText,
  /** Вид по умолчанию: его получают новые заказ-наряды */
  isDefault: z.boolean().optional(),
  /** Тип вида: обычный, ремонт, гарантийный ремонт */
  kindType: z.enum(['regular', 'repair', 'warranty']).optional(),
  sortOrder: z.number().int().min(0).max(1000).optional(),
  /** Вид цен вида заказ-наряда (задача 1178) */
  priceKindId: uuid.nullish(),
});
export const workOrderKindUpdate = toPatch(workOrderKindCreate.omit({ id: true }));
export const workOrderKindQuery = listQuery;

/* ---------------- состояния заказ-наряда ---------------- */

export const documentStateCreate = z.object({
  id: clientId,
  /** Вид заказ-наряда: у каждого вида свой набор состояний */
  kindId: uuid,
  /** Ключ состояния: латиница в нижнем регистре (в нём хранится documents.state) */
  key: z.string().trim().regex(/^[a-z][a-z0-9_]*$/, 'State key: lowercase letters, digits and underscores'),
  label: shortText,
  color: color.default('gray'),
  /** Категория состояния: по ней решается, что происходит с заказом (в частности, продажа при «done») */
  category: z.enum(WORK_ORDER_STATE_CATEGORIES),
  sortOrder: z.number().int().min(0).max(1000).optional(),
});
export const documentStateUpdate = toPatch(documentStateCreate.omit({ id: true, kindId: true }));
export const documentStateQuery = listQuery.extend({ kindId: uuid.optional() });

/* ---------------- материалы заказ-наряда ---------------- */

export const workOrderMaterialInput = z.object({
  id: clientId,
  /** Товар каталога: материал, израсходованный на работу */
  productId: uuid,
  qty: positive,
  /** Склад списания: пусто — склад документа */
  warehouseId: uuid.nullish(),
});
export type WorkOrderMaterialInput = z.infer<typeof workOrderMaterialInput>;
export const workOrderMaterialUpdate = toPatch(workOrderMaterialInput.omit({ id: true }));

/* ---------------- назначения (исполнители) ---------------- */

export const workOrderAssignmentCreate = z.object({
  /** Строка заказ-наряда (работа), к которой относится назначение */
  lineId: uuid.nullish(),
  /** Исполнитель: участник воркспейса */
  assigneeId: uuid.nullish(),
  /** Название задачи: пусто — берётся из строки работы */
  title: shortText.optional(),
  startDate: isoDate.nullish(),
  dueDate: isoDate.nullish(),
  /** Плановые часы: пусто — из нормы работы (этап 2) */
  plannedHours: decimal.optional(),
  /** Участок (work_center) */
  workCenterId: uuid.nullish(),
  /** Интервал работы по часам: начало */
  startAt: isoDateTime.nullish(),
  /** Интервал работы по часам: конец */
  endAt: isoDateTime.nullish(),
});
export const workOrderAssignmentUpdate = toPatch(workOrderAssignmentCreate);

/* ---------------- выставление строк работ ---------------- */

export const workOrderBillingInput = z.object({
  /** Строка заказ-наряда (работа) */
  lineId: uuid,
  /** Способ выставления: по норме (количество × цена) или по фактическим часам */
  billing: z.enum(WORK_ORDER_BILLING_MODES),
});
export type WorkOrderBillingInput = z.infer<typeof workOrderBillingInput>;
export const workOrderBillingUpdate = z.object({ lines: z.array(workOrderBillingInput).max(500) });

/* ---------------- нормы работ ---------------- */

/** Норма времени работы и участок по умолчанию */
export const workNormSet = z.object({
  /** Норма времени на единицу работы, ч */
  normHours: decimal.refine(v => Number(v) >= 0, 'The norm cannot be negative'),
  /** Участок по умолчанию: пусто — участок назначают вручную */
  workCenterId: uuid.nullish(),
});

/* ---------------- табель времени ---------------- */

/** Табель сотрудника: неделя, строки по заказчику и виду работ */
export const timesheetQuery = listQuery.extend({ memberId: uuid.optional(), from: isoDate.optional(), to: isoDate.optional() });

/* ---------------- часовой план услуг ---------------- */

/** Часовой план: период и строки — сотрудники или ресурсы */
export const serviceScheduleQuery = z.object({
  /** Начало периода (ISO 8601 с часовым поясом) */
  from: isoDateTime,
  /** Конец периода (ISO 8601 с часовым поясом) */
  to: isoDateTime,
  /** Строки плана: сотрудники или ресурсы */
  resource: z.enum(['member', 'resource']).default('member'),
});
