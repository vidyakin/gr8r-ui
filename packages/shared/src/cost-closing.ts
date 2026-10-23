/* Закрытие периода: способы распределения косвенных затрат и сам расчёт распределения — чистые функции без БД (этап 6
   «УНФ: Производство»). Сервер считает по ним и записывает корректировки `stock_cost_adjustments`, интерфейс показывает
   тот же расчёт в результате закрытия.

   Правила УНФ (решения пользователя от 2026-10-22):
   - база распределения задаётся статьёй затрат: по объёму выпуска, по прямым затратам, по часам работ; «не распределять»
     оставляет затраты нераспределёнными (ручного документа распределения в платформе нет);
   - сначала затраты идут на выпуск своего участка; если выпуска своего участка не было — на общий выпуск месяца;
     если выпуска не было совсем — затраты остаются нераспределёнными, а закрытие завершается с предупреждением;
   - округление: сумма распределённого равна сумме затрат, остаток округления уходит на последнюю строку.

   Деньги и количества — десятичные (decimal.ts), без float. */
import { div, roundDiv, type Dec } from './decimal';
import { periodByKey, shiftPeriod, type BillingPeriod } from './billing';

/* ---------------- способы распределения ---------------- */

/** База распределения косвенной статьи затрат */
export const COST_DISTRIBUTIONS = ['none', 'output_qty', 'direct_costs', 'work_hours'] as const;
export type CostDistribution = (typeof COST_DISTRIBUTIONS)[number];
export const COST_DISTRIBUTION_LABELS: Record<CostDistribution, string> = {
  none: 'Do not allocate',
  output_qty: 'By output quantity',
  direct_costs: 'By direct costs',
  work_hours: 'By work hours',
};

/* ---------------- месяцы закрытия ---------------- */

/** Ключ месяца «2026-10» → период (первый и последний день) */
export const monthPeriod = (month: string): BillingPeriod => periodByKey('month', month);
/** Месяц, в который попадает дата: «2026-10-21» → «2026-10» */
export const monthOf = (date: string): string => date.slice(0, 7);
/** Список месяцев от первого до последнего включительно (по возрастанию) — режим «за период» */
export const monthRange = (from: string, to: string): string[] => {
  const out: string[] = [];
  let p = periodByKey('month', from);
  const last = periodByKey('month', to);
  for (let i = 0; i < 120 && p.key <= last.key; i++) {
    out.push(p.key);
    p = shiftPeriod('month', p, 1);
  }
  return out;
};
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
/** Подпись месяца для интерфейса: «October 2026» */
export const monthLabel = (month: string): string => {
  const [y, m] = month.split('-').map(Number);
  return `${MONTH_NAMES[m - 1] ?? month} ${y}`;
};

/* ---------------- распределение суммы по базе ---------------- */

export interface AllocationBase {
  /** Ключ получателя (позиция выпуска) */
  key: string;
  /** База: количество выпуска, прямые затраты или часы работ */
  base: Dec;
}

export interface Allocation {
  key: string;
  amount: Dec;
}

/** Раздача суммы по базе пропорционально. Сумма результата равна сумме: остаток округления уходит на последнюю строку.
    Получатели с нулевой базой ничего не получают; если база нулевая у всех — сумма остаётся нераспределённой */
export function distributeOverhead(amount: Dec, bases: AllocationBase[]): { allocations: Allocation[]; undistributed: Dec } {
  const rows = bases.filter(b => b.base > 0n);
  if (amount <= 0n || !rows.length) return { allocations: [], undistributed: amount > 0n ? amount : 0n };
  const total = rows.reduce((s, b) => s + b.base, 0n);
  let left = amount;
  const allocations: Allocation[] = [];
  for (const [i, b] of rows.entries()) {
    // кроме последней строки делим пропорционально; последней отдаём остаток — сумма сходится до копейки
    const part = i === rows.length - 1 ? left : roundDiv(amount * b.base, total);
    allocations.push({ key: b.key, amount: part });
    left -= part;
  }
  return { allocations, undistributed: 0n };
}

/* ---------------- план распределения ---------------- */

/** Косвенные затраты периода: статья, участок и сумма (обычно своя строка period_costs на статью-участок) */
export interface OverheadCost {
  costItemId: string;
  costItemName: string;
  workCenterId: string | null;
  workCenterName: string | null;
  /** Способ распределения статьи */
  method: CostDistribution;
  amount: Dec;
}

/** Позиция выпуска месяца — получатель косвенных затрат */
export interface OverheadTarget {
  /** production_items.id — ключ получателя */
  itemId: string;
  /** Документ выпуска */
  releaseId: string;
  /** Название продукции (для результата закрытия) */
  name: string;
  /** Участок-изготовитель выпуска */
  workCenterId: string | null;
  /** Строка документа с продукцией: у промежуточного этапа её нет (продукция не приходуется) */
  documentLineId: string | null;
  /** Количество выпуска */
  qty: Dec;
  /** Прямые затраты позиции (материалы + работы + накладные этапа) */
  directCost: Dec;
  /** Нормочасы позиции */
  workHours: Dec;
}

export interface OverheadGroup {
  costItemId: string;
  costItemName: string;
  workCenterId: string | null;
  workCenterName: string | null;
  method: CostDistribution;
  amount: Dec;
  /** На выпуск своего участка или на общий выпуск месяца */
  scope: 'work_center' | 'common';
  distributed: Dec;
}

export interface OverheadPlan {
  /** Сколько получила каждая позиция выпуска */
  byTarget: Map<string, Dec>;
  /** Распределение по статьям и участкам */
  byCostItem: OverheadGroup[];
  /** Что осталось нераспределённым */
  undistributed: Dec;
  /** Предупреждения закрытия (виден в результате) */
  warnings: string[];
}

/** База позиции по способу распределения статьи */
const baseOf = (t: OverheadTarget, method: CostDistribution): Dec => (method === 'output_qty' ? t.qty : method === 'direct_costs' ? t.directCost : method === 'work_hours' ? t.workHours : 0n);

/** План распределения косвенных затрат месяца на выпуски: сначала выпуск своего участка, иначе общий выпуск.
    Статья с способом «не распределять» и затраты, которым не нашлось базы, остаются нераспределёнными */
export function planOverhead(costs: OverheadCost[], targets: OverheadTarget[]): OverheadPlan {
  const byTarget = new Map<string, Dec>();
  const warnings: string[] = [];
  // затраты группируются по статье и участку — так же, как в УНФ (подразделение и способ распределения)
  const groups = new Map<string, OverheadGroup>();
  for (const c of costs) {
    if (c.amount <= 0n) continue;
    const key = `${c.costItemId}:${c.workCenterId ?? ''}`;
    const g = groups.get(key) ?? { costItemId: c.costItemId, costItemName: c.costItemName, workCenterId: c.workCenterId, workCenterName: c.workCenterName, method: c.method, amount: 0n, scope: 'common', distributed: 0n };
    g.amount += c.amount;
    groups.set(key, g);
  }
  let undistributed = 0n;
  for (const g of groups.values()) {
    const where = g.workCenterId ? ` at ${g.workCenterName ?? 'its work center'}` : '';
    if (g.method === 'none') {
      undistributed += g.amount;
      warnings.push(`«${g.costItemName}»${where}: not allocated, stays undistributed`);
      continue;
    }
    // позиции с продукцией — только они получают затраты (промежуточный этап продукцию не приходует)
    const own = g.workCenterId ? targets.filter(t => t.workCenterId === g.workCenterId && t.documentLineId) : [];
    const scope: 'work_center' | 'common' = own.length ? 'work_center' : 'common';
    g.scope = scope;
    if (scope === 'common' && g.workCenterId) warnings.push(`«${g.costItemName}»: no release of ${g.workCenterName ?? 'its work center'} this month — allocated to all releases`);
    const rows = (scope === 'work_center' ? own : targets.filter(t => t.documentLineId)).map(t => ({ key: t.itemId, base: baseOf(t, g.method) }));
    const { allocations, undistributed: rest } = distributeOverhead(g.amount, rows);
    if (!allocations.length) {
      undistributed += g.amount;
      warnings.push(`«${g.costItemName}»${where}: nothing to allocate on — ${targets.length ? 'the base is zero in every release' : 'there are no releases this month'}`);
      continue;
    }
    for (const a of allocations) byTarget.set(a.key, (byTarget.get(a.key) ?? 0n) + a.amount);
    g.distributed = allocations.reduce((s, a) => s + a.amount, 0n);
    undistributed += rest;
  }
  return { byTarget, byCostItem: [...groups.values()], undistributed, warnings };
}

/* ---------------- корректировки себестоимости ---------------- */

/** Себестоимость единицы выпуска после распределения косвенных: прямые затраты позиции плюс её доля косвенных */
export const targetUnitCost = (direct: Dec, overhead: Dec, qty: Dec): Dec => (qty <= 0n ? direct + overhead : div(direct + overhead, qty));