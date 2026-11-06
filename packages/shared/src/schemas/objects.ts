/* Объекты объектного учёта (задача 1268): тела запросов API. Процент выполнения и вехи (задача 1272)
   добавляют способ расчёта и ручной процент у объекта и CRUD вех.
   Прорабы и договоры заменяются списком целиком; undefined — не трогать, null — очистить. */
import { z } from 'zod';
import { BUDGET_POLICIES, OBJECT_STATUSES, REVENUE_MODES } from '../constants';
import { OBJECT_ACT_KINDS } from '../object-acts';
import { MILESTONE_KINDS, OBJECT_PROGRESS_MODES } from '../object-progress';
import { REPORT_TIME_RE } from '../object-reports';
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
  /** Ставка часа для заказчика (задача 1273): часы смен × ставка; пусто — акт по часам не создать */
  customerHourRate: decimal.refine(v => Number(v) >= 0, 'The customer hour rate cannot be negative').nullish(),
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

/* ---------- акты выполненных работ (задача 1273) ---------- */

/** Строка акта по объёмам: количество принимает пользователь, цену и единицу сервер берёт из позиции сметы */
const actLineInput = z.object({
  /** Позиция согласованной сметы (обязательна для акта по объёмам) */
  estimateItemId: uuid,
  /** Принятый объём за период, больше нуля */
  qty: decimal.refine(v => Number(v) > 0, 'Accepted quantity must be greater than zero'),
});

/** Тело создания акта: вид, даты и (для объёмов) строки; без строк сервер предлагает их сам */
const actHead = z.object({
  id: clientId,
  /** volumes — по объёмам, milestone — по вехе этапа, hours — по подтверждённым часам смен */
  kind: z.enum(OBJECT_ACT_KINDS).default('volumes'),
  /** Дата акта; пусто — сегодня */
  actDate: isoDate.optional(),
  /** Отчётный период: пусто — с начала текущего месяца по дату акта */
  periodFrom: isoDate.optional(),
  periodTo: isoDate.optional(),
  /** Веха (только для вида «по вехе») */
  milestoneId: uuid.nullish(),
  /** Строки акта по объёмам; пусто — принять предложенные (done_qty − уже принято) */
  lines: z.array(actLineInput).max(500).optional(),
  note: z.string().max(5000).default(''),
});

export const objectActCreate = actHead;

/** Правка черновика: undefined — не трогать, null — очистить. Строки заменяются списком (только акт по объёмам) */
export const objectActUpdate = toPatch(actHead.omit({ id: true, kind: true, milestoneId: true }));

/** Параметры предложения строк акта: вид, период и веха */
export const objectActSuggestionQuery = z.object({
  kind: z.enum(OBJECT_ACT_KINDS).default('volumes'),
  from: isoDate.optional(),
  to: isoDate.optional(),
  milestoneId: uuid.optional(),
});

/** Список актов объекта: период по дате акта */
export const objectActQuery = listQuery.extend({ from: isoDate.optional(), to: isoDate.optional() });

export type ObjectActCreate = z.infer<typeof objectActCreate>;
export type ObjectActUpdate = z.infer<typeof objectActUpdate>;
export type ObjectActSuggestionParams = z.infer<typeof objectActSuggestionQuery>;

/* ---------------- субподряд (задача 1274) ---------------- */

/** Строка акта субподрядчика: что предъявил подрядчик и сколько приняли */
const subActLineInput = z.object({
  /** Позиция сметы вида subcontract (необязательна) */
  estimateItemId: uuid.nullish(),
  /** Наименование; пусто — из позиции сметы */
  name: z.string().trim().min(1).max(500).optional(),
  /** Единица ОКЕИ; пусто — из позиции сметы */
  unitCode: z.string().trim().min(1).max(20).optional(),
  /** Предъявлено, больше нуля */
  qty: decimal.refine(v => Number(v) > 0, 'The presented quantity must be greater than zero'),
  /** Цена субподрядчика без НДС; пусто — из позиции сметы */
  price: decimal.refine(v => Number(v) >= 0, 'The price cannot be negative').optional(),
  /** Принято: пусто — всё предъявленное; меньше qty — нужна причина отклонения */
  acceptedQty: decimal.refine(v => Number(v) >= 0, 'The accepted quantity cannot be negative').optional(),
  /** Причина отклонения (справочник причин брака) */
  defectReasonId: uuid.nullish(),
  note: z.string().max(1000).default(''),
});

/** Материал, израсходованный субподрядчиком: списывается со склада объекта при приёмке */
const subActMaterialInput = z.object({
  productId: uuid,
  qty: decimal.refine(v => Number(v) > 0, 'The quantity must be greater than zero'),
  note: z.string().max(1000).default(''),
});

/** Тело создания акта субподрядчика: контрагент, документ подрядчика, период и строки (без строк — из заказа) */
const subActHead = z.object({
  id: clientId,
  /** Субподрядчик (companies) */
  counterpartyId: uuid,
  /** Заказ-основание (supplier_order): по нему предлагаются строки и проверяется, что принято не больше заказанного */
  orderId: uuid.nullish(),
  /** Номер документа субподрядчика */
  docNumber: z.string().trim().max(100).default(''),
  /** Дата документа субподрядчика */
  docDate: isoDate,
  /** Период работ: пусто — с начала месяца по дату документа */
  periodFrom: isoDate.optional(),
  periodTo: isoDate.optional(),
  /** Строки акта; пусто и есть заказ — предложенные строки заказа полностью */
  lines: z.array(subActLineInput).max(500).optional(),
  /** Израсходованные материалы со склада объекта */
  materials: z.array(subActMaterialInput).max(200).default([]),
  note: z.string().max(5000).default(''),
});

export const objectSubActCreate = subActHead;

/** Правка черновика: undefined — не трогать, null — очистить. Строки заменяются списком */
export const objectSubActUpdate = toPatch(subActHead.omit({ id: true, orderId: true }));

/** Список актов объекта за период по дате документа подрядчика */
export const objectSubActQuery = listQuery.extend({ from: isoDate.optional(), to: isoDate.optional() });

/** Предложение строк из заказа: остаток к приёмке по строкам-услугам заказа */
export const objectSubActSuggestionQuery = z.object({ orderId: uuid });

/** Отклонение акта целиком: причина обязательна */
export const objectSubActReject = z.object({ reason: z.string().trim().min(1).max(1000) });

export type ObjectSubActCreate = z.infer<typeof objectSubActCreate>;
export type ObjectSubActUpdate = z.infer<typeof objectSubActUpdate>;

/* ---------- сводка о ходе объекта по расписанию (задача 1277) ---------- */

/** Настройка «Сводка о ходе работ»: включена, день недели (1–7) и время «HH:MM» в часовом поясе воркспейса,
    получатели — участники воркспейса (пусто — ответственный и прорабы объекта) */
const reportScheduleHead = z.object({
  enabled: z.boolean().default(true),
  /** 1 — понедельник … 7 — воскресенье */
  weekday: z.number().int().min(1).max(7).default(1),
  time: z.string().regex(REPORT_TIME_RE, 'The time must be HH:MM'),
  /** Получатели: участники воркспейса; пусто — ответственный и прорабы объекта */
  recipientIds: z.array(uuid).max(200).default([]),
});

export const objectReportScheduleSave = reportScheduleHead;

/** Период печатного отчёта о ходе работ: пусто — с начала текущего месяца по сегодня */
export const objectProgressReportQuery = z.object({ from: isoDate.optional(), to: isoDate.optional() });

export type ObjectReportScheduleSave = z.infer<typeof objectReportScheduleSave>;
