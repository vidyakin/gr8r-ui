/* Процент выполнения объекта и вехи (задача 1272, docs/architecture/construction.md).
   Чистые расчёты без БД: те же функции на сервере и в интерфейсе. Деньги и количества — строками через decimal.ts,
   без float. Процент — строка с одним знаком после запятой; null — базы расчёта нет (0 задач, нет согласованной сметы,
   ручной процент не задан). */
import { dec, fmt, mul, pctOf, roundDiv, type Dec } from './decimal';

/** Способ расчёта процента выполнения объекта */
export const OBJECT_PROGRESS_MODES = ['tasks_closed', 'tasks_avg', 'task_weights', 'estimate_volume', 'manual'] as const;
export type ObjectProgressMode = (typeof OBJECT_PROGRESS_MODES)[number];

/** Вид вехи: этап (выполнение) или аванс (деньги вперёд, не выполнение) */
export const MILESTONE_KINDS = ['stage', 'advance'] as const;
export type MilestoneKind = (typeof MILESTONE_KINDS)[number];

/** Завершённые статусы задачи. Встроенный статус доски — `done`; `closed` допускается для настраиваемых колонок. */
export const CLOSED_TASK_STATUSES = ['done', 'closed'] as const;

/** Статус задачи считается завершённым */
export const isClosedTaskStatus = (status: string): boolean => (CLOSED_TASK_STATUSES as readonly string[]).includes(status);

/** Задача в объёме, нужном для расчёта: статус и вес (нет веса — 1) */
export interface ObjectProgressTask {
  status: string;
  weight?: string | number | null | undefined;
}

/** Позиция согласованной сметы: объём, цена заказчику без НДС и выполненный объём */
export interface ObjectProgressEstimateItem {
  qty: string;
  price: string;
  doneQty: string;
}

/** База расчёта: что именно сложили (для подсказки в карточке) */
export interface ObjectProgressBase {
  tasks: { total: number; closed: number; weightTotal: string; weightClosed: string };
  /** null — нет согласованной сметы */
  estimate: { lines: number; revenue: string; doneRevenue: string } | null;
}

export interface ObjectProgressInput {
  mode: ObjectProgressMode;
  /** Ручной процент (0–100) для режима manual */
  manual?: string | null | undefined;
  tasks: ObjectProgressTask[];
  /** Позиции согласованной основной сметы и согласованных допработ; null — согласованной сметы нет */
  estimateItems: ObjectProgressEstimateItem[] | null;
}

export interface ObjectProgressResult {
  percent: string | null;
  base: ObjectProgressBase;
}

/** Вес задачи: пусто или 0 — 1 (вес не задан) */
const taskWeight = (w: string | number | null | undefined): Dec => {
  const v = dec(w);
  return v > 0n ? v : dec('1');
};

/** Процент из долей: value / total × 100, строка с одним знаком после запятой; total = 0 — null */
export const percentOf = (value: Dec, total: Dec): string | null => {
  if (total <= 0n) return null;
  // десятые доли процента: value × 1000 / total, округление половины от нуля
  const tenths = roundDiv(value * 1000n, total);
  const whole = tenths / 10n;
  const frac = tenths % 10n;
  return `${whole}.${frac}`;
};

/** Ручной процент: пусто — null, иначе строка с одним знаком */
const manualPercent = (manual: string | null | undefined): string | null => {
  if (manual === null || manual === undefined || manual === '') return null;
  return fmt(dec(manual), 1);
};

/** Процент выполнения объекта по выбранному способу */
export function computeObjectProgress(input: ObjectProgressInput): ObjectProgressResult {
  const total = input.tasks.length;
  const closed = input.tasks.filter(t => isClosedTaskStatus(t.status)).length;
  let weightTotal = 0n;
  let weightClosed = 0n;
  for (const t of input.tasks) {
    const w = taskWeight(t.weight);
    weightTotal += w;
    if (isClosedTaskStatus(t.status)) weightClosed += w;
  }

  let estimateBase: ObjectProgressBase['estimate'] = null;
  let revenue = 0n;
  let doneRevenue = 0n;
  if (input.estimateItems && input.estimateItems.length) {
    for (const i of input.estimateItems) {
      revenue += mul(dec(i.qty), dec(i.price));
      doneRevenue += mul(dec(i.doneQty), dec(i.price));
    }
    estimateBase = { lines: input.estimateItems.length, revenue: fmt(revenue, 2), doneRevenue: fmt(doneRevenue, 2) };
  }

  const base: ObjectProgressBase = {
    tasks: { total, closed, weightTotal: fmt(weightTotal, 2), weightClosed: fmt(weightClosed, 2) },
    estimate: estimateBase,
  };

  switch (input.mode) {
    case 'tasks_closed':
      // доля задач объекта в завершённых статусах
      return { percent: percentOf(BigInt(closed), BigInt(total)), base };
    case 'tasks_avg':
      // у задачи нет поля прогресса: завершённая = 100, остальные = 0 — средний прогресс задач
      return { percent: percentOf(BigInt(closed), BigInt(total)), base };
    case 'task_weights':
      // как доля завершённых, но с весами задач (нет веса — 1)
      return { percent: percentOf(weightClosed, weightTotal), base };
    case 'estimate_volume':
      // выполненный объём позиций согласованной сметы: сумма done_qty × price / сумма qty × price
      return { percent: percentOf(doneRevenue, revenue), base };
    case 'manual':
      return { percent: manualPercent(input.manual), base };
  }
}

/* ---------------- вехи ---------------- */

/** Веха в объёме, нужном для расчёта суммы и сводки */
export interface ObjectMilestoneLike {
  kind: string;
  amount?: string | null | undefined;
  pct?: string | null | undefined;
  doneAt?: string | Date | null | undefined;
  acceptedAt?: string | Date | null | undefined;
}

/** Сумма вехи для отображения: фиксированная сумма или процент от стоимости договора; null — не посчитать */
export function milestoneAmount(m: { amount?: string | null | undefined; pct?: string | null | undefined }, contractValue: string | null): string | null {
  if (m.amount !== null && m.amount !== undefined) return fmt(dec(m.amount), 2);
  if (m.pct === null || m.pct === undefined) return null;
  if (contractValue === null) return null;
  return fmt(pctOf(dec(contractValue), dec(m.pct)), 2);
}

/** Суммы по вехам: выполнено, принято, выставлено и оплачено (из связанных актов, задача 1273) */
export interface MilestoneTotals {
  /** Сумма вех; null — у процента нет стоимости договора (нет согласованной сметы) */
  total: string | null;
  done: string | null;
  accepted: string | null;
  /** Выставлено и оплачено: суммы документов актов по вехам; null — актов по вехам этого вида ещё нет */
  invoiced: string | null;
  paid: string | null;
}

export interface ObjectMilestonesSummary {
  /** Стоимость договора: согласованная основная смета и согласованные допработы без НДС */
  contractValue: string | null;
  /** Этапы: выполнено и принято */
  stages: MilestoneTotals;
  /** Аванс — отдельно: деньги вперёд, а не выполнение */
  advance: MilestoneTotals;
}

/** Сводка по вехам: этапы отдельно от аванса. Процент вехи считается от стоимости договора.
    «Выставлено» и «оплачено» сюда не входят: их считает сервис по связанным актам (objectMilestonesView). */
export function summarizeMilestones(milestones: ObjectMilestoneLike[], contractValue: string | null): ObjectMilestonesSummary {
  const sums = (kind: MilestoneKind) => {
    const rows = milestones.filter(m => m.kind === kind);
    let total = 0n;
    let done = 0n;
    let accepted = 0n;
    let unresolved = false;
    for (const m of rows) {
      const amount = milestoneAmount(m, contractValue);
      if (amount === null) {
        unresolved = true;
        continue;
      }
      total += dec(amount);
      if (m.doneAt) done += dec(amount);
      if (m.acceptedAt) accepted += dec(amount);
    }
    if (!rows.length) return { total: '0.00', done: '0.00', accepted: '0.00', invoiced: null, paid: null } satisfies MilestoneTotals;
    // хотя бы одна веха-процент без стоимости договора — сумма неполная, показываем пусто
    if (unresolved) return { total: null, done: null, accepted: null, invoiced: null, paid: null } satisfies MilestoneTotals;
    return { total: fmt(total, 2), done: fmt(done, 2), accepted: fmt(accepted, 2), invoiced: null, paid: null } satisfies MilestoneTotals;
  };
  return { contractValue, stages: sums('stage'), advance: sums('advance') };
}

/** Доля выполнения вех этапов от их суммы в процентах — для подсказки в карточке; null — базы нет */
export function milestonesDonePercent(summary: ObjectMilestonesSummary): number | null {
  const total = summary.stages.total;
  const done = summary.stages.done;
  if (total === null || done === null) return null;
  if (dec(total) <= 0n) return null;
  const tenths = roundDiv(dec(done) * 1000n, dec(total));
  return Number(tenths) / 10;
}

