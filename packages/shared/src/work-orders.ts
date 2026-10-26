/* Себестоимость работ заказ-наряда: чистый расчёт без БД (задача 1096, docs/architecture/work-orders.md).
   Сервер собирает исходные данные (назначения, часы, ставки участков, цены материалов и товаров, прочие затраты,
   косвенные закрытия месяца), эту же функцию вызывает отчёт. Деньги и часы — десятичные строки, float не используется.

   Правила (справка УНФ 7.1):
   - труд = часы × ставка участка; участок — назначения, иначе участок нормы работы; без участка труд не оценивается
     (часы попадают в предупреждение);
   - материалы и товары: план — количество × текущая средняя себестоимость склада; факт — себестоимость списания по
     движениям заказ-наряда после выполнения, до выполнения факт = оценка по средней (флаг `estimated`);
   - прочие затраты — прямые, план и факт совпадают (проведённые строки «Прочих затрат» на основании заказ-наряда);
   - косвенные — только факт, из закрытия месяца;
   - выручка — сумма заказ-наряда без НДС (работы, услуги, товары); у строк «Услуга» затрат нет;
   - маржа = выручка − себестоимость, процент — от выручки. */
import { dec, div, fmt, mul, type Dec } from './decimal';

/** Назначение заказ-наряда с часами и ставкой участка */
export interface WorkOrderCostAssignment {
  id: string;
  assigneeId: string | null;
  assigneeName: string | null;
  /** Участок назначения, а если пуст — участок нормы работы; пусто — труд не оценивается */
  workCenterId: string | null;
  workCenterName: string | null;
  plannedHours: string;
  /** Часы по всем записям времени задачи-назначения, без ограничения по датам */
  actualHours: string;
  /** Ставка участка за час; null — участка нет */
  rate: string | null;
}

/** Материал или товар заказ-наряда */
export interface WorkOrderCostItem {
  key: string;
  productId: string;
  name: string;
  unitCode: string;
  qty: string;
  /** Текущая средняя себестоимость единицы (для плана и для оценки до выполнения) */
  unitCost: string;
  /** Себестоимость списания по движениям (всего); null — заказ-наряд ещё не выполнен */
  factCost: string | null;
}

export interface WorkOrderCostInput {
  /** Сумма заказ-наряда без НДС */
  revenueNet: string;
  assignments: WorkOrderCostAssignment[];
  materials: WorkOrderCostItem[];
  goods: WorkOrderCostItem[];
  /** Прямые прочие затраты (проведённые строки на основании заказ-наряда) */
  other: string;
  /** Косвенные из закрытия месяца (факт) */
  indirect: string;
}

export interface WorkOrderLaborRow {
  assigneeId: string | null;
  assigneeName: string | null;
  workCenterId: string | null;
  workCenterName: string | null;
  rate: string | null;
  plannedHours: string;
  actualHours: string;
  planAmount: string;
  factAmount: string;
}

export interface WorkOrderCostItemRow {
  key: string;
  productId: string;
  name: string;
  unitCode: string;
  qty: string;
  planCost: string;
  factCost: string;
  /** Факт — оценка по средней: заказ-наряд ещё не выполнен */
  estimated: boolean;
}

export interface WorkOrderCostPair {
  plan: string;
  fact: string;
}

export interface WorkOrderCostWarning {
  kind: 'no_work_center';
  /** Назначения без участка и их часы (труд не оценен) */
  assignmentIds: string[];
  plannedHours: string;
  actualHours: string;
}

export interface WorkOrderCost {
  labor: WorkOrderCostPair & { rows: WorkOrderLaborRow[]; byCenter: { workCenterId: string | null; workCenterName: string | null; plannedHours: string; actualHours: string; planAmount: string; factAmount: string }[]; plannedHours: string; actualHours: string };
  materials: WorkOrderCostPair & { rows: WorkOrderCostItemRow[]; estimated: boolean };
  goods: WorkOrderCostPair & { rows: WorkOrderCostItemRow[]; estimated: boolean };
  other: WorkOrderCostPair;
  indirect: WorkOrderCostPair;
  /** Себестоимость всего */
  cost: WorkOrderCostPair;
  revenue: string;
  margin: WorkOrderCostPair;
  /** Маржа в процентах от выручки (2 знака); null — выручка нулевая */
  marginPct: { plan: string | null; fact: string | null };
  /** Факт по материалам или товарам — оценка по средней */
  estimated: boolean;
  warnings: WorkOrderCostWarning[];
}

/** Деньги округляются до копеек в каждой строке — итоги равны сумме показанных строк */
const money = (a: Dec): Dec => dec(fmt(a, 2));
const sumOf = (xs: Dec[]): Dec => xs.reduce((s, x) => s + x, 0n);

/** Процент маржи от выручки: 2 знака, null при нулевой выручке */
export function marginPct(margin: Dec, revenue: Dec): string | null {
  if (revenue === 0n) return null;
  return fmt(mul(div(margin, revenue), dec(100)), 2);
}

function itemRows(items: WorkOrderCostItem[]): { rows: WorkOrderCostItemRow[]; plan: Dec; fact: Dec; estimated: boolean } {
  const rows = items.map(i => {
    const plan = money(mul(dec(i.qty), dec(i.unitCost)));
    const estimated = i.factCost === null;
    const fact = estimated ? plan : money(dec(i.factCost));
    return { key: i.key, productId: i.productId, name: i.name, unitCode: i.unitCode, qty: i.qty, planCost: fmt(plan, 2), factCost: fmt(fact, 2), estimated, p: plan, f: fact };
  });
  return {
    rows: rows.map(({ p: _p, f: _f, ...r }) => r),
    plan: sumOf(rows.map(r => r.p)),
    fact: sumOf(rows.map(r => r.f)),
    estimated: rows.some(r => r.estimated),
  };
}

/** Себестоимость работ заказ-наряда: план и факт по видам, выручка и маржа */
export function computeWorkOrderCost(input: WorkOrderCostInput): WorkOrderCost {
  // труд: строка на пару «исполнитель × участок»
  const laborMap = new Map<string, { row: Omit<WorkOrderLaborRow, 'planAmount' | 'factAmount' | 'plannedHours' | 'actualHours'>; planned: Dec; actual: Dec; planAmount: Dec; factAmount: Dec }>();
  const unrated: WorkOrderCostAssignment[] = [];
  for (const a of input.assignments) {
    const planned = dec(a.plannedHours);
    const actual = dec(a.actualHours);
    const rate = a.workCenterId && a.rate !== null ? dec(a.rate) : null;
    const key = `${a.assigneeId ?? ''}:${a.workCenterId ?? ''}`;
    const cur = laborMap.get(key) ?? { row: { assigneeId: a.assigneeId, assigneeName: a.assigneeName, workCenterId: a.workCenterId, workCenterName: a.workCenterName, rate: a.workCenterId ? a.rate : null }, planned: 0n, actual: 0n, planAmount: 0n, factAmount: 0n };
    cur.planned += planned;
    cur.actual += actual;
    if (rate !== null) {
      cur.planAmount += mul(planned, rate);
      cur.factAmount += mul(actual, rate);
    } else if (planned > 0n || actual > 0n) unrated.push(a);
    laborMap.set(key, cur);
  }
  const laborRows: WorkOrderLaborRow[] = [...laborMap.values()].map(c => ({ ...c.row, plannedHours: fmt(c.planned, 3), actualHours: fmt(c.actual, 3), planAmount: fmt(money(c.planAmount), 2), factAmount: fmt(money(c.factAmount), 2) }));
  const laborPlan = sumOf(laborRows.map(r => dec(r.planAmount)));
  const laborFact = sumOf(laborRows.map(r => dec(r.factAmount)));
  // по участкам: база распределения косвенных при закрытии месяца
  const centerMap = new Map<string, { workCenterId: string | null; workCenterName: string | null; planned: Dec; actual: Dec; planAmount: Dec; factAmount: Dec }>();
  for (const r of laborRows) {
    const key = r.workCenterId ?? '';
    const c = centerMap.get(key) ?? { workCenterId: r.workCenterId, workCenterName: r.workCenterName, planned: 0n, actual: 0n, planAmount: 0n, factAmount: 0n };
    c.planned += dec(r.plannedHours);
    c.actual += dec(r.actualHours);
    c.planAmount += dec(r.planAmount);
    c.factAmount += dec(r.factAmount);
    centerMap.set(key, c);
  }

  const mat = itemRows(input.materials);
  const gds = itemRows(input.goods);
  const other = money(dec(input.other));
  const indirect = money(dec(input.indirect));
  const revenue = money(dec(input.revenueNet));

  const costPlan = laborPlan + mat.plan + gds.plan + other;
  const costFact = laborFact + mat.fact + gds.fact + other + indirect;
  const marginPlan = revenue - costPlan;
  const marginFact = revenue - costFact;

  return {
    labor: {
      plan: fmt(laborPlan, 2),
      fact: fmt(laborFact, 2),
      rows: laborRows,
      byCenter: [...centerMap.values()].map(c => ({ workCenterId: c.workCenterId, workCenterName: c.workCenterName, plannedHours: fmt(c.planned, 3), actualHours: fmt(c.actual, 3), planAmount: fmt(c.planAmount, 2), factAmount: fmt(c.factAmount, 2) })),
      plannedHours: fmt(sumOf(laborRows.map(r => dec(r.plannedHours))), 3),
      actualHours: fmt(sumOf(laborRows.map(r => dec(r.actualHours))), 3),
    },
    materials: { plan: fmt(mat.plan, 2), fact: fmt(mat.fact, 2), rows: mat.rows, estimated: mat.estimated },
    goods: { plan: fmt(gds.plan, 2), fact: fmt(gds.fact, 2), rows: gds.rows, estimated: gds.estimated },
    other: { plan: fmt(other, 2), fact: fmt(other, 2) },
    indirect: { plan: '0.00', fact: fmt(indirect, 2) },
    cost: { plan: fmt(costPlan, 2), fact: fmt(costFact, 2) },
    revenue: fmt(revenue, 2),
    margin: { plan: fmt(marginPlan, 2), fact: fmt(marginFact, 2) },
    marginPct: { plan: marginPct(marginPlan, revenue), fact: marginPct(marginFact, revenue) },
    estimated: mat.estimated || gds.estimated,
    warnings: unrated.length
      ? [{ kind: 'no_work_center', assignmentIds: unrated.map(a => a.id), plannedHours: fmt(sumOf(unrated.map(a => dec(a.plannedHours))), 3), actualHours: fmt(sumOf(unrated.map(a => dec(a.actualHours))), 3) }]
      : [],
  };
}
