/* Смета объекта (задача 1269, docs/architecture/construction.md): виды позиций и статусы, расчёт итогов сметы
   и план-факт по позициям. Чистые функции на десятичных из decimal.ts — одни и те же на сервере и в интерфейсе.
   Деньги без НДС, считаются целыми копейками по строкам, итоги — сумма округлённых строк (как в документах). */
import { dec, div, fmt, mul, type Dec } from './decimal';

/** Вид сметы: основная смета объекта или дополнение (допработы) */
export const ESTIMATE_KINDS = ['main', 'change'] as const;
export type EstimateKind = (typeof ESTIMATE_KINDS)[number];

/** Статус сметы: черновик или согласована */
export const ESTIMATE_STATUSES = ['draft', 'approved'] as const;
export type EstimateStatus = (typeof ESTIMATE_STATUSES)[number];

/** Статус допработ: черновик, согласованы, отклонены */
export const ESTIMATE_CHANGE_STATUSES = ['draft', 'approved', 'rejected'] as const;
export type EstimateChangeStatus = (typeof ESTIMATE_CHANGE_STATUSES)[number];

/** Вид позиции: работа, материал, щит (собственное производство), субподряд, прочее */
export const ESTIMATE_ITEM_KINDS = ['work', 'material', 'panel', 'subcontract', 'other'] as const;
export type EstimateItemKind = (typeof ESTIMATE_ITEM_KINDS)[number];

/** Позиции, из которых создаётся заказ поставщику (нужен товар каталога) */
export const SUPPLIER_ORDER_ITEM_KINDS: readonly EstimateItemKind[] = ['material', 'subcontract'];

const round = (v: Dec, dp: number): Dec => dec(fmt(v, dp));

/** Позиция сметы в объёме, нужном для расчёта */
export interface EstimateItemLike {
  /** id позиции: ключ строки план-факта */
  id?: string | undefined;
  kind: string;
  qty: string;
  price: string;
  costPrice: string;
  laborHours: string;
}

/** Суммы одной позиции: заказчику, плановая себестоимость, плановые часы */
export interface EstimateLineTotals {
  /** Сумма для заказчика без НДС */
  revenue: string;
  /** Плановая себестоимость (внутренняя стоимость × объём) */
  cost: string;
  /** Плановые часы (норма часов × объём) */
  hours: string;
}

/** Итоги сметы */
export interface EstimateTotals extends EstimateLineTotals {
  /** Маржа: сумма заказчику минус плановая себестоимость */
  margin: string;
  /** Маржа в процентах от суммы заказчику; null — сумма нулевая, процент не считается */
  marginPct: string | null;
}

/** Суммы позиции: каждое значение округляется до копейки (часы — до тысячных) */
export function estimateLineTotals(i: EstimateItemLike): EstimateLineTotals {
  return {
    revenue: fmt(round(mul(dec(i.qty), dec(i.price)), 2), 2),
    cost: fmt(round(mul(dec(i.qty), dec(i.costPrice)), 2), 2),
    hours: fmt(round(mul(dec(i.qty), dec(i.laborHours)), 3), 3),
  };
}

/** Итоги сметы из позиций: сумма заказчику, плановая себестоимость, плановые часы и маржа */
export function computeEstimateTotals(items: EstimateItemLike[]): EstimateTotals {
  let revenue = 0n;
  let cost = 0n;
  let hours = 0n;
  for (const i of items) {
    const l = estimateLineTotals(i);
    revenue += dec(l.revenue);
    cost += dec(l.cost);
    hours += dec(l.hours);
  }
  const margin = revenue - cost;
  return {
    revenue: fmt(revenue, 2),
    cost: fmt(cost, 2),
    hours: fmt(hours, 3),
    margin: fmt(margin, 2),
    // маржа при нулевой сумме не считается (как в прогнозе прибыли объекта)
    marginPct: revenue > 0n ? fmt(round(div(margin, revenue) * 100n, 2), 2) : null,
  };
}

/** План-факт по позиции: план (сумма, себестоимость, часы), факт и остаток */
export interface EstimatePlanFactRow {
  id: string | null;
  /** План по смете */
  plan: EstimateLineTotals;
  /** Факт: пока нули — источник появится с задачами факта затрат (1271/1274/1275) */
  fact: EstimateLineTotals;
  /** Остаток = план − факт */
  remaining: EstimateLineTotals;
}

const ZERO: EstimateLineTotals = { revenue: '0.00', cost: '0.00', hours: '0.000' };

/** План-факт по позициям сметы. factByItemId — точка расширения: когда появятся факты затрат,
    сервис передаст здесь фактические суммы и часы; сейчас факт нулевой и остаток равен плану. */
export function estimatePlanFact(items: EstimateItemLike[], factByItemId: Record<string, EstimateLineTotals> = {}): EstimatePlanFactRow[] {
  return items.map(i => {
    const plan = estimateLineTotals(i);
    const fact = (i.id ? factByItemId[i.id] : undefined) ?? ZERO;
    return {
      id: i.id ?? null,
      plan,
      fact,
      remaining: {
        revenue: fmt(dec(plan.revenue) - dec(fact.revenue), 2),
        cost: fmt(dec(plan.cost) - dec(fact.cost), 2),
        hours: fmt(dec(plan.hours) - dec(fact.hours), 3),
      },
    };
  });
}
