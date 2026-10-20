/* Себестоимость единицы продукции по спецификации (BOM). Чистая функция: одна и та же на сервере (GET …/cost, тесты)
   и в интерфейсе (мгновенный пересчёт при правке строк). Деньги и количества — десятичные строки, считаем без float (decimal.ts).

   Правила:
     - спецификация задана на партию из `batchQty` единиц; себестоимость единицы = стоимость партии / batchQty;
     - material: цена × qty × (1 + отход%/100); цену материала подаёт вызывающий (источник цены — настройка воркспейса);
     - work: hours × ставка (ставка строки, иначе ставка участка) + fixedCost;
     - semi: qty × себестоимость единицы полуфабриката (его спецификация считается рекурсивно, со своими накладными);
     - накладные узла = overheadPct% от ПРЯМЫХ затрат его собственных строк (материалы + работы). Полуфабрикат уже включает
       свои накладные, поэтому накладные родителя на него не начисляются (нет двойного счёта);
     - разбивка «материалы / работы / накладные» собирается по всему дереву: затраты полуфабриката входят в разбивку родителя
       по своим статьям;
     - цикл (изделие прямо или косвенно входит само в себя) — BomCycleError с цепочкой id. */
import type { MaterialPriceSource } from './constants';
import { add, dec, div, fmt, mul, pctOf, withPct, type Dec } from './decimal';

export interface BomLineInput {
  id: string;
  kind: 'material' | 'semi' | 'work';
  qty: string;
  /** material */
  productId?: string | null;
  scrapPct?: string | null;
  /** semi */
  childItemId?: string | null;
  /** work */
  operation?: string | null;
  workCenterId?: string | null;
  hours?: string | null;
  rate?: string | null;
  fixedCost?: string | null;
}

export interface BomItemInput {
  id: string;
  name: string;
  unitCode?: string;
  batchQty: string;
  overheadPct: string;
  lines: BomLineInput[];
}

export interface BomPricing {
  /** Цена единицы материала по выбранному источнику; нет значения — материал не оценён (стоимость 0, строка помечается) */
  materialPrice: (productId: string) => string | null | undefined;
  /** Ставка участка за час */
  workCenterRate: (workCenterId: string) => string | null | undefined;
}

export interface CostBreakdown {
  materials: string;
  works: string;
  overhead: string;
  total: string;
}

export interface CostLine {
  id: string;
  kind: BomLineInput['kind'];
  /** Стоимость строки в стоимости партии родителя */
  cost: string;
  /** Материал не оценён: у товара нет цены по выбранному источнику */
  missingPrice?: boolean;
  /** Рассчитанное дерево полуфабриката */
  child?: CostNode;
}

export interface CostNode {
  itemId: string;
  name: string;
  batchQty: string;
  overheadPct: string;
  lines: CostLine[];
  /** Стоимость партии */
  batch: CostBreakdown;
  /** Себестоимость единицы (партия / batchQty) */
  unit: CostBreakdown;
}

export class BomCycleError extends Error {
  constructor(public path: string[]) {
    super(`Bill of materials contains a cycle: ${path.join(' → ')}`);
  }
}

interface Parts {
  m: Dec;
  w: Dec;
  o: Dec;
}

const out = (p: Parts): CostBreakdown => ({ materials: fmt(p.m), works: fmt(p.w), overhead: fmt(p.o), total: fmt(p.m + p.w + p.o) });

/** Цепочка id, если по ссылкам на полуфабрикаты можно вернуться в ту же продукцию (от `startId` или в любом месте графа); иначе null */
export function findBomCycle(items: Pick<BomItemInput, 'id' | 'lines'>[], startId?: string): string[] | null {
  const byId = new Map(items.map(i => [i.id, i]));
  const state = new Map<string, 1 | 2>();
  const stack: string[] = [];
  const visit = (id: string): string[] | null => {
    if (state.get(id) === 2) return null;
    if (state.get(id) === 1) return [...stack.slice(stack.indexOf(id)), id];
    state.set(id, 1);
    stack.push(id);
    for (const l of byId.get(id)?.lines ?? []) {
      if (l.kind !== 'semi' || !l.childItemId) continue;
      const c = visit(l.childItemId);
      if (c) return c;
    }
    stack.pop();
    state.set(id, 2);
    return null;
  };
  if (startId) return visit(startId);
  for (const i of items) {
    const c = visit(i.id);
    if (c) return c;
  }
  return null;
}

/** Добавление ребра «item → child» создаст цикл, если item достижим из child (или child — это сам item) */
export function wouldCreateCycle(edges: Map<string, string[]>, itemId: string, childId: string): boolean {
  if (itemId === childId) return true;
  const seen = new Set<string>();
  const stack = [childId];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === itemId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(edges.get(id) ?? []));
  }
  return false;
}

/** Дерево себестоимости изделия `rootId`. Полуфабрикат, которого нет в `items`, считается нулевым */
export function computeBomCost(items: BomItemInput[], rootId: string, pricing: BomPricing): CostNode {
  const byId = new Map(items.map(i => [i.id, i]));
  const memo = new Map<string, CostNode>();
  /** Точные (до 6 знаков) затраты единицы: родитель берёт их, а не округлённые строки результата */
  const exact = new Map<string, Parts>();
  const stack: string[] = [];

  const node = (id: string): CostNode => {
    const hit = memo.get(id);
    if (hit) return hit;
    if (stack.includes(id)) throw new BomCycleError([...stack.slice(stack.indexOf(id)), id]);
    const item = byId.get(id);
    if (!item) throw new Error(`Item ${id} not found`);
    const batchQty = dec(item.batchQty);
    if (batchQty <= 0n) throw new RangeError(`Batch quantity of "${item.name}" must be positive`);
    stack.push(id);

    const total: Parts = { m: 0n, w: 0n, o: 0n };
    let direct = 0n;
    const lines: CostLine[] = [];
    for (const l of item.lines) {
      const qty = dec(l.qty);
      if (l.kind === 'material') {
        const price = l.productId ? pricing.materialPrice(l.productId) : null;
        const cost = withPct(mul(qty, dec(price)), dec(l.scrapPct));
        total.m += cost;
        direct += cost;
        lines.push({ id: l.id, kind: 'material', cost: fmt(cost), ...(price === null || price === undefined ? { missingPrice: true } : {}) });
      } else if (l.kind === 'work') {
        const own = l.rate !== null && l.rate !== undefined && l.rate !== '';
        const rate = own ? l.rate : l.workCenterId ? pricing.workCenterRate(l.workCenterId) : null;
        const cost = add(mul(dec(l.hours), dec(rate)), dec(l.fixedCost));
        total.w += cost;
        direct += cost;
        lines.push({ id: l.id, kind: 'work', cost: fmt(cost) });
      } else {
        const child = l.childItemId && byId.has(l.childItemId) ? node(l.childItemId) : undefined;
        const cu = child ? exact.get(child.itemId) : undefined;
        if (cu) {
          total.m += mul(qty, cu.m);
          total.w += mul(qty, cu.w);
          total.o += mul(qty, cu.o);
        }
        lines.push({ id: l.id, kind: 'semi', cost: fmt(cu ? mul(qty, cu.m + cu.w + cu.o) : 0n), ...(child ? { child } : {}) });
      }
    }
    total.o += pctOf(direct, dec(item.overheadPct));
    stack.pop();

    const unit: Parts = { m: div(total.m, batchQty), w: div(total.w, batchQty), o: div(total.o, batchQty) };
    const res: CostNode = { itemId: id, name: item.name, batchQty: item.batchQty, overheadPct: item.overheadPct, lines, batch: out(total), unit: out(unit) };
    memo.set(id, res);
    exact.set(id, unit);
    return res;
  };
  return node(rootId);
}

/** Цена материала по источнику из настройки воркспейса. Нулевая цена считается незаданной (null): материал помечается как не оценённый.
    avg_cost — средняя себестоимость склада (взвешенная остатком по складам, `loadAvgCosts` в packages/db); пока товара нет на складах
    (avgCost пуст), берётся закупочная цена */
export function resolveMaterialPrice(source: MaterialPriceSource, p: { price?: string | null; purchasePrice?: string | null }, avgCost?: string | null): string | null {
  const pick = source === 'price' ? p.price : source === 'avg_cost' ? (avgCost ?? p.purchasePrice) : p.purchasePrice;
  return pick !== null && pick !== undefined && dec(pick) > 0n ? pick : null;
}
