/* Объекты объектного учёта (задача 1268): тела запросов API. Процент выполнения и вехи (задача 1272)
   добавляют способ расчёта и ручной процент у объекта и CRUD вех.
   Прорабы и договоры заменяются списком целиком; undefined — не трогать, null — очистить. */
import { z } from 'zod';
import { BUDGET_POLICIES, OBJECT_STATUSES, REVENUE_MODES } from '../constants';
import { MILESTONE_KINDS, OBJECT_PROGRESS_MODES } from '../object-progress';
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
  /** Как считать процент выполнения (задача 1272): по закрытым задачам, среднему прогрессу, весам, объёмам сметы, вручную */
  progressMode: z.enum(OBJECT_PROGRESS_MODES).default('tasks_closed'),
  /** Ручной процент выполнения 0–100 (только для режима manual) */
  progressManual: decimal
    .refine(v => Number(v) >= 0 && Number(v) <= 100, 'Progress percent must be between 0 and 100')
    .nullish(),
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

/* ---------- вехи объекта (задача 1272) ---------- */

/** Веха этапа или аванса: ровно одно из amount/pct (сумма или процент стоимости договора) */
const milestoneHead = z.object({
  id: clientId,
  name: shortText,
  dueDate: isoDate.nullish(),
  /** stage — этап (выполнение), advance — аванс (деньги вперёд, не выполнение) */
  kind: z.enum(MILESTONE_KINDS).default('stage'),
  /** Фиксированная сумма без НДС */
  amount: decimal.nullish(),
  /** Процент стоимости договора (согласованная смета и согласованные допработы без НДС) */
  pct: decimal.refine(v => Number(v) >= 0 && Number(v) <= 100, 'Milestone percent must be between 0 and 100').nullish(),
  note: z.string().max(5000).default(''),
});

/** Ровно одно из amount/pct проверяет сервис (422 milestone_amount_required): при создании — по телу,
    при правке — по объединённой строке, иначе PATCH одного поля не смог бы проверить пару */
export const objectMilestoneCreate = milestoneHead;

export const objectMilestoneUpdate = toPatch(milestoneHead.omit({ id: true }));

/** Отметки вехи: выполнено и принято заказчиком — разные события */
export const objectMilestoneDone = z.object({ done: z.boolean().default(true) });
export const objectMilestoneAccept = z.object({ accepted: z.boolean().default(true) });

export type ObjectMilestoneCreate = z.infer<typeof objectMilestoneCreate>;
export type ObjectMilestoneUpdate = z.infer<typeof objectMilestoneUpdate>;
