/* Объекты объектного учёта (задача 1268): тела запросов API.
   Прорабы и договоры заменяются списком целиком; undefined — не трогать, null — очистить. */
import { z } from 'zod';
import { BUDGET_POLICIES, OBJECT_STATUSES, REVENUE_MODES } from '../constants';
import { clientId, decimal, isoDate, listQuery, shortText, toPatch, uuid } from './common';

const head = {
  /** Код объекта: уникален в воркспейсе */
  number: z.string().trim().min(1).max(50),
  name: shortText,
  /** Основной заказчик */
  customerId: uuid.nullish(),
  address: z.string().max(500).default(''),
  startDate: isoDate.nullish(),
  dueDate: isoDate.nullish(),
  status: z.enum(OBJECT_STATUSES).default('planning'),
  /** Ответственный участник */
  managerId: uuid.nullish(),
  revenueMode: z.enum(REVENUE_MODES).default('acts'),
  /** Процент накладных от прямых затрат, 0–100 */
  overheadPct: decimal.refine(v => Number(v) >= 0 && Number(v) <= 100, 'Overhead percent must be between 0 and 100').optional(),
  /** Контроль бюджета объекта: не контролировать, предупредить, запретить проведение */
  budgetPolicy: z.enum(BUDGET_POLICIES).default('warn'),
  /** Свой проект задач: пусто — создать при сохранении */
  projectId: uuid.nullish(),
  /** Склад объекта */
  warehouseId: uuid.nullish(),
  note: z.string().max(5000).default(''),
  /** Прорабы (участники) */
  foremen: z.array(uuid).max(200).optional(),
  /** Договоры объекта */
  contracts: z.array(uuid).max(200).optional(),
};

export const objectCreate = z.object({ id: clientId, ...head });
export const objectUpdate = toPatch(objectCreate.omit({ id: true }));
export const objectQuery = listQuery.extend({ status: z.enum(OBJECT_STATUSES).optional() });

export type ObjectCreate = z.infer<typeof objectCreate>;
export type ObjectUpdate = z.infer<typeof objectUpdate>;
