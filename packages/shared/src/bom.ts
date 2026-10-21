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
import type { MaterialPriceSource, SemiMode } from './constants';
import { add, dec, div, fmt, mul, pctOf, withPct, type Dec } from './decimal';

export interface BomLineInput {
  id: string;
  kind: 'material' | 'semi' | 'work';
  qty: string;
  /** material */
  productId?: string | null;
  scrapPct?: string | null;
  /** Единица строки: единица товара / продукции */
  unitCode?: string | null;
  /** semi */
  childItemId?: string | null;
  /** semi: режим полуфабриката — stock (списывается со склада) или explode (разворачивается до материалов); по умолчанию stock */
  semiMode?: SemiMode | null;
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
  /** Товар каталога, которым лежит изделие на складе (нужно для остатка полуфабриката) */
  productId?: string | null;
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

/* ---------------- развёртка спецификации и потребность ----------------

   Развёртка отвечает на вопрос «сколько нужно, чтобы выпустить N штук»: спецификация задана на партию
   (`batchQty`), поэтому нормы умножаются на N / batch_qty — кратности партиям нет (как в УНФ).
   Режим полуфабриката задаёт строка BOM: `stock` — полуфабрикат выпускается отдельно и списывается со склада,
   `explode` — разворачивается до материалов и работ в том же выпуске.

   Потребность (`computeNeeds`) считается по развёртке с учётом остатков: нужно / доступно / дефицит.
   Недостающий полуфабрикат в режиме `stock` разворачивается дальше: на его дефицит считаются материалы и работы.
   Требования одного товара с разных уровней агрегируются и сравниваются с остатком один раз — остаток не списывается дважды. */

/** Материал в развёртке: сколько нужно на выпуск */
export interface ExplosionMaterial {
  productId: string;
  qty: string;
  unitCode?: string | null;
}

/** Работа в развёртке: часы на выпуск */
export interface ExplosionWork {
  operation: string;
  workCenterId: string | null;
  hours: string;
}

/** Полуфабрикат в режиме `stock`: его списывают со склада, а если не хватает — выпускают */
export interface ExplosionSemi {
  itemId: string;
  name: string;
  /** Товар каталога полуфабриката — по нему смотрят остаток */
  productId: string | null;
  unitCode: string | null;
  /** Партия полуфабриката: его спецификация задана на неё */
  batchQty: string;
  /** Сколько полуфабрикатов нужно */
  qty: string;
  /** Разложение полуфабриката на одну партию — из него считается, чего не хватает */
  child: Explosion | null;
}

/** Ветка развёртки: требования к материалам, работам и полуфабрикатам */
export interface Explosion {
  itemId: string;
  name: string;
  unitCode: string | null;
  batchQty: string;
  /** Количество изделия, на которое разложена ветка */
  qty: string;
  materials: ExplosionMaterial[];
  works: ExplosionWork[];
  semis: ExplosionSemi[];
}

/** Строка потребности: сколько нужно, сколько доступно и сколько не хватает */
export interface NeedLine {
  kind: 'material' | 'semi';
  /** Материал — товар каталога; полуфабрикат — его товар (может быть пустым) */
  productId: string | null;
  /** Полуфабрикат — продукция */
  itemId: string | null;
  qty: string;
  available: string;
  deficit: string;
  /** Сколько нужно выпустить (полуфабрикат) */
  produce: string;
}

/** Потребность в работах: часы на выпуск */
export interface NeedWork {
  operation: string;
  workCenterId: string | null;
  hours: string;
}

export interface Needs {
  materials: NeedLine[];
  semis: NeedLine[];
  works: NeedWork[];
}

/** Развёртка спецификации изделия на `qty` единиц. Полуфабрикат без спецификации считается пустым */
export function explodeBom(items: BomItemInput[], rootId: string, qty: string): Explosion {
  const byId = new Map(items.map(i => [i.id, i]));
  const root = byId.get(rootId);
  if (!root) throw new Error(`Item ${rootId} not found`);
  const stack: string[] = [];

  /** Требования изделия на `units` единиц: строки спецификации заданы на партию, поэтому нормы умножаются на units / batchQty */
  const node = (item: BomItemInput, units: Dec): Explosion => {
    if (stack.includes(item.id)) throw new BomCycleError([...stack.slice(stack.indexOf(item.id)), item.id]);
    const batchQty = dec(item.batchQty);
    if (batchQty <= 0n) throw new RangeError(`Batch quantity of "${item.name}" must be positive`);
    stack.push(item.id);
    const scale = div(units, batchQty);
    const materials: ExplosionMaterial[] = [];
    const works: ExplosionWork[] = [];
    const semis: ExplosionSemi[] = [];
    for (const l of item.lines) {
      if (l.kind === 'material') {
        const q = mul(dec(l.qty), scale);
        materials.push({ productId: l.productId!, qty: fmt(withPct(q, dec(l.scrapPct)), 3), unitCode: l.unitCode ?? null });
      } else if (l.kind === 'work') {
        works.push({ operation: l.operation ?? '', workCenterId: l.workCenterId ?? null, hours: fmt(mul(dec(l.hours), scale), 3) });
      } else {
        const child = l.childItemId ? byId.get(l.childItemId) : undefined;
        if (!child) continue;
        const need = mul(dec(l.qty), scale);
        if ((l.semiMode ?? 'stock') === 'explode') {
          // «Фантом»: полуфабрикат не лежит на складе — разворачиваем его материалы и работы в этот же выпуск
          const cn = node(child, need);
          materials.push(...cn.materials);
          works.push(...cn.works);
          semis.push(...cn.semis);
        } else {
          semis.push({ itemId: child.id, name: child.name, productId: child.productId ?? null, unitCode: child.unitCode ?? null, batchQty: child.batchQty, qty: fmt(need, 3), child: node(child, dec(child.batchQty)) });
        }
      }
    }
    stack.pop();
    return { itemId: item.id, name: item.name, unitCode: item.unitCode ?? null, batchQty: item.batchQty, qty: fmt(units, 3), materials, works, semis };
  };

  return node(root, dec(qty));
}

/** Потребность по развёртке с учётом остатков: `availability` — доступное количество по товару каталога (остаток минус резерв) */
export function computeNeeds(explosion: Explosion, availability: Record<string, string> | Map<string, string>): Needs {
  const avail = (productId: string): Dec => {
    const v = availability instanceof Map ? availability.get(productId) : availability[productId];
    return dec(v ?? '0');
  };
  /** Требования к материалам и работам: накапливаются по всем уровням, остаток сравнивается с суммой */
  const materials = new Map<string, Dec>();
  const works = new Map<string, { operation: string; workCenterId: string | null; hours: Dec }>();
  /** Сколько полуфабрикатов нужно и как он разложен */
  const semiNeed = new Map<string, Dec>();
  const semiRow = new Map<string, ExplosionSemi>();
  /** Сколько полуфабрикатов уже решили выпустить */
  const produced = new Map<string, Dec>();
  /** Сколько полуфабрикатов уже развернули в материалы и работы */
  const expanded = new Map<string, Dec>();

  const collect = (node: Explosion, scale: Dec) => {
    for (const m of node.materials) materials.set(m.productId, (materials.get(m.productId) ?? 0n) + mul(dec(m.qty), scale));
    for (const w of node.works) {
      const key = `${w.operation}|${w.workCenterId ?? ''}`;
      const cur = works.get(key) ?? { operation: w.operation, workCenterId: w.workCenterId, hours: 0n };
      cur.hours += mul(dec(w.hours), scale);
      works.set(key, cur);
    }
    for (const s of node.semis) {
      semiNeed.set(s.itemId, (semiNeed.get(s.itemId) ?? 0n) + mul(dec(s.qty), scale));
      if (!semiRow.has(s.itemId)) semiRow.set(s.itemId, s);
    }
  };

  // Раунды: сначала верхний уровень, потом — материалы и работы выпускаемого полуфабриката (на его дефицит)
  let queue: { node: Explosion; scale: Dec }[] = [{ node: explosion, scale: dec('1') }];
  while (queue.length) {
    const batch = queue;
    queue = [];
    for (const t of batch) collect(t.node, t.scale);

    // Полуфабрикаты по товару каталога: их остаток общий, поэтому группируем по товару
    const byProduct = new Map<string, string[]>();
    for (const [itemId, row] of semiRow) {
      if (!row.productId) continue;
      byProduct.set(row.productId, [...(byProduct.get(row.productId) ?? []), itemId]);
    }
    for (const [pid, ids] of byProduct) {
      // Остаток распределяем: сначала полуфабрикаты (готовый складской материал), потом сырьё
      let free = avail(pid);
      const unsat = new Map<string, Dec>();
      for (const id of ids) {
        const need = semiNeed.get(id) ?? 0n;
        const take = free < need ? free : need;
        free -= take;
        unsat.set(id, need - take);
      }
      const matNeed = materials.get(pid) ?? 0n;
      const matTake = free < matNeed ? free : matNeed;
      free -= matTake;
      // Дефицит по этому товару покрываем выпуском полуфабрикатов: их материалы и работы посчитаются следующим раундом
      let pool = matNeed - matTake;
      for (const id of ids) pool += unsat.get(id) ?? 0n;
      for (const id of ids) {
        const already = produced.get(id) ?? 0n;
        const want = (unsat.get(id) ?? 0n) - already;
        const take = want > 0n && pool > 0n ? (pool < want ? pool : want) : 0n;
        pool -= take;
        if (take > 0n) produced.set(id, already + take);
      }
    }
    // Полуфабрикат без товара каталога на склад не лежит — его нужно выпустить целиком
    for (const [id, row] of semiRow) {
      if (row.productId) continue;
      const need = semiNeed.get(id) ?? 0n;
      const already = produced.get(id) ?? 0n;
      if (need > already) produced.set(id, need);
    }
    // Новое к производству — разворачиваем его спецификацию на этот объём (разложение ребёнка сделано на одну партию)
    for (const [id, qty] of produced) {
      const row = semiRow.get(id);
      if (!row?.child) continue;
      const done = expanded.get(id) ?? 0n;
      if (qty <= done) continue;
      expanded.set(id, qty);
      queue.push({ node: row.child, scale: div(qty - done, dec(row.batchQty)) });
    }
  }

  const lines = (kind: NeedLine['kind'], id: string, productId: string | null, need: Dec, produceQty: Dec): NeedLine => {
    const available = productId ? avail(productId) : 0n;
    const deficit = need > available ? need - available : 0n;
    return { kind, productId, itemId: kind === 'semi' ? id : null, qty: fmt(need, 3), available: fmt(available, 3), deficit: fmt(deficit, 3), produce: fmt(produceQty, 3) };
  };

  return {
    materials: [...materials.entries()].map(([pid, need]) => lines('material', pid, pid, need, 0n)),
    semis: [...semiNeed.entries()].map(([id, need]) => lines('semi', id, semiRow.get(id)?.productId ?? null, need, produced.get(id) ?? 0n)),
    works: [...works.values()].map(w => ({ operation: w.operation, workCenterId: w.workCenterId, hours: fmt(w.hours, 3) })),
  };
}

/** Цена материала по источнику из настройки воркспейса. Нулевая цена считается незаданной (null): материал помечается как не оценённый.
    avg_cost — средняя себестоимость склада (взвешенная остатком по складам, `loadAvgCosts` в packages/db); пока товара нет на складах
    (avgCost пуст), берётся закупочная цена */
export function resolveMaterialPrice(source: MaterialPriceSource, p: { price?: string | null; purchasePrice?: string | null }, avgCost?: string | null): string | null {
  const pick = source === 'price' ? p.price : source === 'avg_cost' ? (avgCost ?? p.purchasePrice) : p.purchasePrice;
  return pick !== null && pick !== undefined && dec(pick) > 0n ? pick : null;
}
