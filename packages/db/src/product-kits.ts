/* Комплекты товаров (набор как в УНФ, задача #1183): состав комплекта, проверка циклов,
   разворачивание в составляющие при проведении и расчёт распределения выручки и себестоимости. */
import { and, asc, eq, inArray } from 'drizzle-orm';
import { dec, detectKitCycle, distributeKitLine, div, fmt, resolveKitWeights, roundDiv, type Dec } from '@erp/shared';
import type { Actor } from './attachments';
import type { Db } from './client';
import { DomainError } from './errors';
import { recordEvent } from './events';
import { documentLineKitItems, productKitItems, products, stockBalances, stockMoves } from './schema';
import { loadAvgCosts } from './stock';

export interface ProductKitItemView {
  id: string;
  componentProductId: string;
  componentName: string;
  componentSku: string;
  componentUnitCode: string;
  componentPrice: string;
  componentPurchasePrice: string;
  componentIsKit: boolean;
  qty: string;
  priceShare: string | null;
  sortOrder: number;
}

export interface ExpandedKitComponent {
  componentProductId: string;
  name: string;
  sku: string;
  unitCode: string;
  catalogPrice: string;
  qtyPerKit: string;
  priceShare: string | null;
  sortOrder: number;
}

export interface DocumentLineKitItemView {
  id?: string;
  componentProductId: string;
  componentName: string;
  componentSku: string;
  componentUnitCode: string;
  qtyPerKit: string;
  qty: string;
  priceShare: string | null;
  weightSharePct?: string;
  unitPrice: string;
  net: string;
  vatAmount: string;
  total: string;
  unitCost: string | null;
  cogs: string | null;
  sortOrder: number;
}

export async function listProductKitItems(db: Db, workspaceId: string, productId: string): Promise<ProductKitItemView[]> {
  const rows = await db
    .select({
      id: productKitItems.id,
      componentProductId: productKitItems.componentProductId,
      componentName: products.name,
      componentSku: products.sku,
      componentUnitCode: products.unitCode,
      componentPrice: products.price,
      componentPurchasePrice: products.purchasePrice,
      componentIsKit: products.isKit,
      qty: productKitItems.qty,
      priceShare: productKitItems.priceShare,
      sortOrder: productKitItems.sortOrder,
    })
    .from(productKitItems)
    .innerJoin(products, and(eq(products.workspaceId, productKitItems.workspaceId), eq(products.id, productKitItems.componentProductId)))
    .where(and(eq(productKitItems.workspaceId, workspaceId), eq(productKitItems.kitProductId, productId)))
    .orderBy(asc(productKitItems.sortOrder), asc(productKitItems.createdAt));
  return rows;
}

export interface KitItemSaveInput {
  componentProductId: string;
  qty: string;
  priceShare?: string | null;
}

/** Полностью заменяет состав комплекта: проверяет вид товара, отсутствие повторов, самоссылок и циклов. */
export async function saveProductKitItems(db: Db, actor: Actor, productId: string, items: KitItemSaveInput[]): Promise<ProductKitItemView[]> {
  const ws = actor.workspaceId;
  const [kit] = await db.select({ id: products.id, kind: products.kind }).from(products).where(and(eq(products.workspaceId, ws), eq(products.id, productId))).limit(1);
  if (!kit) throw new DomainError(404, 'not_found', 'product not found');
  if (kit.kind !== 'goods') throw new DomainError(422, 'kit_goods_only', 'Only goods products can be configured as kits');

  const seen = new Set<string>();
  const normalized: { componentProductId: string; qty: string; priceShare: string | null }[] = [];
  for (const item of items) {
    if (item.componentProductId === productId) throw new DomainError(422, 'kit_cycle', 'A kit cannot include itself directly or through nested kits');
    if (seen.has(item.componentProductId)) throw new DomainError(422, 'kit_duplicate_component', 'Each component can be added to a kit only once');
    seen.add(item.componentProductId);
    const q = dec(item.qty);
    if (q <= 0n) throw new DomainError(422, 'invalid_qty', 'Component quantity must be greater than zero');
    let share: string | null = null;
    if (item.priceShare !== undefined && item.priceShare !== null && item.priceShare !== '') {
      const s = dec(item.priceShare);
      if (s < 0n) throw new DomainError(422, 'kit_invalid_share', 'Price share cannot be negative');
      share = fmt(s, 4);
    }
    normalized.push({ componentProductId: item.componentProductId, qty: fmt(q, 3), priceShare: share });
  }

  if (normalized.length) {
    const compIds = normalized.map(i => i.componentProductId);
    const comps = await db.select({ id: products.id, kind: products.kind, archivedAt: products.archivedAt }).from(products).where(and(eq(products.workspaceId, ws), inArray(products.id, compIds)));
    const byId = new Map(comps.map(c => [c.id, c]));
    for (const id of compIds) {
      const c = byId.get(id);
      if (!c || c.archivedAt) throw new DomainError(422, 'invalid_reference', 'The component product does not exist or is archived');
      if (c.kind !== 'goods') throw new DomainError(422, 'kit_component_goods_only', 'Only goods products can be components of a kit');
    }

    // Проверка циклов на графе всех комплектов воркспейса
    const allEdges = await db.select({ kitProductId: productKitItems.kitProductId, componentProductId: productKitItems.componentProductId }).from(productKitItems).where(eq(productKitItems.workspaceId, ws));
    const edgeMap = new Map<string, string[]>();
    for (const e of allEdges) {
      if (e.kitProductId === productId) continue;
      edgeMap.set(e.kitProductId, [...(edgeMap.get(e.kitProductId) ?? []), e.componentProductId]);
    }
    if (detectKitCycle(productId, edgeMap, compIds)) {
      throw new DomainError(422, 'kit_cycle', 'A kit cannot include itself directly or through nested kits');
    }
  }

  await db.delete(productKitItems).where(and(eq(productKitItems.workspaceId, ws), eq(productKitItems.kitProductId, productId)));
  if (normalized.length) {
    await db.insert(productKitItems).values(normalized.map((r, sortOrder) => ({ workspaceId: ws, kitProductId: productId, ...r, sortOrder })));
  }
  await recordEvent(db, { workspaceId: ws, type: 'product.updated', entity: 'product', recordId: productId, actorId: actor.memberId, payload: { kitItems: normalized.length } });
  return listProductKitItems(db, ws, productId);
}

const gcd = (a: bigint, b: bigint): bigint => {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x || 1n;
};

interface Rational {
  num: bigint;
  den: bigint;
}

const normRat = (num: bigint, den: bigint): Rational => {
  if (num === 0n) return { num: 0n, den: 1n };
  const g = gcd(num, den);
  return { num: num / g, den: den / g };
};

const addRat = (a: Rational, b: Rational): Rational => normRat(a.num * b.den + b.num * a.den, a.den * b.den);
const mulRat = (a: Rational, b: Rational): Rational => normRat(a.num * b.num, a.den * b.den);

/** Разворачивает указанные комплекты до листовых складских товаров (с поддержкой вложенных комплектов и слиянием дублей). */
export async function expandKitProducts(db: Db, workspaceId: string, kitIds: string[], opts: { allowEmpty?: boolean } = {}): Promise<Map<string, ExpandedKitComponent[]>> {
  const uniqueIds = [...new Set(kitIds)];
  const result = new Map<string, ExpandedKitComponent[]>();
  if (!uniqueIds.length) return result;

  const allItems = await db
    .select({
      kitProductId: productKitItems.kitProductId,
      componentProductId: productKitItems.componentProductId,
      qty: productKitItems.qty,
      priceShare: productKitItems.priceShare,
      sortOrder: productKitItems.sortOrder,
    })
    .from(productKitItems)
    .where(eq(productKitItems.workspaceId, workspaceId))
    .orderBy(asc(productKitItems.sortOrder), asc(productKitItems.createdAt));

  const itemsByKit = new Map<string, typeof allItems>();
  const allProdIds = new Set<string>(uniqueIds);
  for (const r of allItems) {
    itemsByKit.set(r.kitProductId, [...(itemsByKit.get(r.kitProductId) ?? []), r]);
    allProdIds.add(r.kitProductId);
    allProdIds.add(r.componentProductId);
  }

  const prodRows = await db
    .select({ id: products.id, name: products.name, sku: products.sku, unitCode: products.unitCode, price: products.price, isKit: products.isKit })
    .from(products)
    .where(and(eq(products.workspaceId, workspaceId), inArray(products.id, [...allProdIds])));
  const prodById = new Map(prodRows.map(p => [p.id, p]));

  for (const rootId of uniqueIds) {
    const rootProd = prodById.get(rootId);
    const direct = itemsByKit.get(rootId) ?? [];
    if (!direct.length) {
      if (opts.allowEmpty) {
        result.set(rootId, []);
        continue;
      }
      throw new DomainError(422, 'kit_empty', `Kit "${rootProd?.name ?? rootId}" has no components`);
    }

    // Одноуровневый комплект без вложенных комплектов: сохраняем точные priceShare и catalogPrice без потери точности
    const hasNested = direct.some(d => prodById.get(d.componentProductId)?.isKit);
    if (!hasNested) {
      result.set(
        rootId,
        direct.map((d, idx) => {
          const cp = prodById.get(d.componentProductId)!;
          return {
            componentProductId: d.componentProductId,
            name: cp.name,
            sku: cp.sku,
            unitCode: cp.unitCode,
            catalogPrice: cp.price,
            qtyPerKit: fmt(dec(d.qty), 3),
            priceShare: d.priceShare,
            sortOrder: idx,
          };
        }),
      );
      continue;
    }

    // Многоуровневый комплект: рекурсивное разворачивание с точными рациональными весами
    const acc = new Map<string, { qty: Dec; weight: Rational; order: number }>();
    let orderCounter = 0;

    const visit = (kitId: string, parentQtyScale: Dec, parentWeight: Rational, visiting: Set<string>) => {
      if (visiting.has(kitId)) throw new DomainError(422, 'kit_cycle', 'A kit cannot include itself directly or through nested kits');
      const rows = itemsByKit.get(kitId) ?? [];
      if (!rows.length) {
        if (opts.allowEmpty) return;
        throw new DomainError(422, 'kit_empty', `Kit "${prodById.get(kitId)?.name ?? kitId}" has no components`);
      }
      const nextVisiting = new Set(visiting);
      nextVisiting.add(kitId);

      const { weights } = resolveKitWeights(
        rows.map(r => ({
          productId: r.componentProductId,
          qty: r.qty,
          priceShare: r.priceShare,
          catalogPrice: prodById.get(r.componentProductId)?.price ?? '0',
        })),
      );
      const sumW = weights.reduce((s, w) => s + w, 0n) || 1n;

      for (let i = 0; i < rows.length; i++) {
        const r = rows[i]!;
        const compProd = prodById.get(r.componentProductId);
        const childQty = roundDiv(parentQtyScale * dec(r.qty), 1_000_000n);
        const childWeight = mulRat(parentWeight, normRat(weights[i]!, sumW));
        if (compProd?.isKit) {
          visit(compProd.id, childQty, childWeight, nextVisiting);
        } else {
          const prev = acc.get(r.componentProductId);
          if (prev) {
            prev.qty += childQty;
            prev.weight = addRat(prev.weight, childWeight);
          } else {
            acc.set(r.componentProductId, { qty: childQty, weight: childWeight, order: orderCounter++ });
          }
        }
      }
    };

    visit(rootId, 1_000_000n, { num: 1n, den: 1n }, new Set());

    const list = [...acc.entries()].sort((a, b) => a[1].order - b[1].order);
    const commonDen = list.reduce((d, [, v]) => (d / gcd(d, v.weight.den)) * v.weight.den, 1n);
    // Нормализуем доли к сумме 100.0000 (или пропорциональным весам), чтобы distributeKitLine сохранил точные пропорции
    result.set(
      rootId,
      list.map(([compId, v], idx) => {
        const cp = prodById.get(compId)!;
        const scaled = roundDiv(v.weight.num * (commonDen / v.weight.den) * 100n * 1_000_000n, commonDen);
        return {
          componentProductId: compId,
          name: cp.name,
          sku: cp.sku,
          unitCode: cp.unitCode,
          catalogPrice: cp.price,
          qtyPerKit: fmt(v.qty, 3),
          priceShare: fmt(scaled, 4),
          sortOrder: idx,
        };
      }),
    );
  }

  return result;
}

/** Сохраняет снимок распределения выручки и фактической себестоимости составляющих комплекта при проведении документа. */
export async function recordDocumentKitItems(
  db: Db,
  workspaceId: string,
  doc: { id: string; priceIncludesVat: boolean },
  kitLines: { id: string; productId: string; qty: string; net: string; vatAmount: string; total: string }[],
  expandedByLine: Map<string, ExpandedKitComponent[]>,
): Promise<void> {
  if (!kitLines.length) return;
  const lineIds = kitLines.map(l => l.id);
  await db.delete(documentLineKitItems).where(and(eq(documentLineKitItems.workspaceId, workspaceId), inArray(documentLineKitItems.documentLineId, lineIds)));

  const moveRows = await db
    .select({
      lineId: stockMoves.documentLineId,
      productId: stockMoves.productId,
      qty: stockMoves.qty,
      cost: stockMoves.cost,
    })
    .from(stockMoves)
    .where(and(eq(stockMoves.workspaceId, workspaceId), eq(stockMoves.documentId, doc.id), inArray(stockMoves.documentLineId, lineIds)));

  const costAcc = new Map<string, { qty: Dec; costSum: Dec }>();
  for (const m of moveRows) {
    if (!m.lineId) continue;
    const key = `${m.lineId}:${m.productId}`;
    const q = dec(m.qty);
    const absQ = q < 0n ? -q : q;
    const prev = costAcc.get(key) ?? { qty: 0n, costSum: 0n };
    prev.qty += absQ;
    prev.costSum += roundDiv(absQ * dec(m.cost), 1_000_000n);
    costAcc.set(key, prev);
  }

  const inserts: (typeof documentLineKitItems.$inferInsert)[] = [];
  for (const l of kitLines) {
    const comps = expandedByLine.get(l.id) ?? [];
    if (!comps.length) continue;
    const distributed = distributeKitLine({
      lineQty: l.qty,
      lineNet: l.net,
      lineVat: l.vatAmount,
      lineTotal: l.total,
      priceIncludesVat: doc.priceIncludesVat,
      components: comps.map(c => ({
        productId: c.componentProductId,
        qty: c.qtyPerKit,
        priceShare: c.priceShare,
        catalogPrice: c.catalogPrice,
      })),
    });
    for (let i = 0; i < distributed.length; i++) {
      const d = distributed[i]!;
      const acc = costAcc.get(`${l.id}:${d.productId}`);
      const movedQty = acc?.qty ?? dec(d.totalQty);
      const costSum = acc?.costSum ?? 0n;
      const unitCost = movedQty > 0n ? fmt(div(costSum, movedQty), 4) : '0.0000';
      const cogs = fmt(costSum, 2);
      inserts.push({
        workspaceId,
        documentId: doc.id,
        documentLineId: l.id,
        componentProductId: d.productId,
        qtyPerKit: d.qtyPerKit,
        qty: d.totalQty,
        priceShare: d.priceShare,
        unitPrice: d.unitPrice,
        net: d.net,
        vatAmount: d.vatAmount,
        total: d.total,
        unitCost,
        cogs,
        sortOrder: i,
      });
    }
  }
  if (inserts.length) await db.insert(documentLineKitItems).values(inserts);
}

/** Читает сохранённые снимки комплектов (для проведённого документа) или считает превью (для черновика/заказа). */
export async function loadDocumentKitItems(
  db: Db,
  workspaceId: string,
  doc: { id: string; status: string; warehouseId: string | null; priceIncludesVat: boolean },
  lines: { id: string; productId: string; isKit: boolean; qty: string; net: string; vatAmount: string; total: string }[],
): Promise<Map<string, DocumentLineKitItemView[]>> {
  const out = new Map<string, DocumentLineKitItemView[]>();
  const kitLines = lines.filter(l => l.isKit);
  if (!kitLines.length) return out;

  if (doc.status === 'posted') {
    const saved = await db
      .select({
        row: documentLineKitItems,
        componentName: products.name,
        componentSku: products.sku,
        componentUnitCode: products.unitCode,
      })
      .from(documentLineKitItems)
      .innerJoin(products, and(eq(products.workspaceId, documentLineKitItems.workspaceId), eq(products.id, documentLineKitItems.componentProductId)))
      .where(and(eq(documentLineKitItems.workspaceId, workspaceId), eq(documentLineKitItems.documentId, doc.id)))
      .orderBy(asc(documentLineKitItems.sortOrder), asc(documentLineKitItems.createdAt));

    if (saved.length) {
      for (const s of saved) {
        const list = out.get(s.row.documentLineId) ?? [];
        list.push({
          id: s.row.id,
          componentProductId: s.row.componentProductId,
          componentName: s.componentName,
          componentSku: s.componentSku,
          componentUnitCode: s.componentUnitCode,
          qtyPerKit: s.row.qtyPerKit,
          qty: s.row.qty,
          priceShare: s.row.priceShare,
          unitPrice: s.row.unitPrice,
          net: s.row.net,
          vatAmount: s.row.vatAmount,
          total: s.row.total,
          unitCost: s.row.unitCost,
          cogs: s.row.cogs,
          sortOrder: s.row.sortOrder,
        });
        out.set(s.row.documentLineId, list);
      }
      return out;
    }
  }

  // Черновик, заказ или счёт: считаем превью по текущему составу комплектов
  const expanded = await expandKitProducts(
    db,
    workspaceId,
    kitLines.map(l => l.productId),
    { allowEmpty: true },
  );
  const compIds = [...new Set([...expanded.values()].flatMap(list => list.map(c => c.componentProductId)))];
  const avgByComp = new Map<string, string>();
  if (compIds.length) {
    if (doc.warehouseId) {
      const bals = await db
        .select({ productId: stockBalances.productId, avgCost: stockBalances.avgCost })
        .from(stockBalances)
        .where(and(eq(stockBalances.workspaceId, workspaceId), eq(stockBalances.warehouseId, doc.warehouseId), inArray(stockBalances.productId, compIds)));
      for (const b of bals) avgByComp.set(b.productId, b.avgCost);
    } else {
      const avgs = await loadAvgCosts(db, compIds);
      for (const [pid, cost] of avgs) avgByComp.set(pid, cost);
    }
  }

  for (const l of kitLines) {
    const comps = expanded.get(l.productId) ?? [];
    if (!comps.length) {
      out.set(l.id, []);
      continue;
    }
    const compMap = new Map(comps.map(c => [c.componentProductId, c]));
    const dist = distributeKitLine({
      lineQty: l.qty,
      lineNet: l.net,
      lineVat: l.vatAmount,
      lineTotal: l.total,
      priceIncludesVat: doc.priceIncludesVat,
      components: comps.map(c => ({
        productId: c.componentProductId,
        qty: c.qtyPerKit,
        priceShare: c.priceShare,
        catalogPrice: c.catalogPrice,
      })),
    });
    out.set(
      l.id,
      dist.map((d, idx) => {
        const meta = compMap.get(d.productId)!;
        const unitCost = avgByComp.get(d.productId) ?? '0.0000';
        const cogs = fmt(roundDiv(dec(d.totalQty) * dec(unitCost), 1_000_000n), 2);
        return {
          componentProductId: d.productId,
          componentName: meta.name,
          componentSku: meta.sku,
          componentUnitCode: meta.unitCode,
          qtyPerKit: d.qtyPerKit,
          qty: d.totalQty,
          priceShare: d.priceShare,
          weightSharePct: d.weightSharePct,
          unitPrice: d.unitPrice,
          net: d.net,
          vatAmount: d.vatAmount,
          total: d.total,
          unitCost,
          cogs,
          sortOrder: idx,
        };
      }),
    );
  }
  return out;
}

/** Компоненты, сохранённые на строке реализации: используются при возврате от покупателя на основании реализации. */
export async function sourceKitComponentsOf(db: Db, workspaceId: string, sourceLineIds: string[]): Promise<Map<string, ExpandedKitComponent[]>> {
  const out = new Map<string, ExpandedKitComponent[]>();
  const ids = [...new Set(sourceLineIds)];
  if (!ids.length) return out;
  const rows = await db
    .select({
      lineId: documentLineKitItems.documentLineId,
      componentProductId: documentLineKitItems.componentProductId,
      qtyPerKit: documentLineKitItems.qtyPerKit,
      priceShare: documentLineKitItems.priceShare,
      sortOrder: documentLineKitItems.sortOrder,
      name: products.name,
      sku: products.sku,
      unitCode: products.unitCode,
      catalogPrice: products.price,
    })
    .from(documentLineKitItems)
    .innerJoin(products, and(eq(products.workspaceId, documentLineKitItems.workspaceId), eq(products.id, documentLineKitItems.componentProductId)))
    .where(and(eq(documentLineKitItems.workspaceId, workspaceId), inArray(documentLineKitItems.documentLineId, ids)))
    .orderBy(asc(documentLineKitItems.sortOrder), asc(documentLineKitItems.createdAt));
  for (const r of rows) {
    const list = out.get(r.lineId) ?? [];
    list.push({
      componentProductId: r.componentProductId,
      name: r.name,
      sku: r.sku,
      unitCode: r.unitCode,
      catalogPrice: r.catalogPrice,
      qtyPerKit: r.qtyPerKit,
      priceShare: r.priceShare,
      sortOrder: r.sortOrder,
    });
    out.set(r.lineId, list);
  }
  return out;
}

/** Маскирует себестоимость (unitCost/cogs) для не-администраторов и суммы выручки (net/vatAmount/total/unitPrice) при скрытом document.total. */
export function maskDocumentKitCosts<T extends { lines: { kitItems?: DocumentLineKitItemView[] }[] }>(detail: T, showCost: boolean, showTotals = true): T {
  if (showCost && showTotals) return detail;
  return {
    ...detail,
    lines: detail.lines.map(l =>
      l.kitItems?.length
        ? {
            ...l,
            kitItems: l.kitItems.map(k => ({
              ...k,
              ...(showCost ? {} : { unitCost: null, cogs: null }),
              ...(showTotals ? {} : { unitPrice: '0.00', net: '0.00', vatAmount: '0.00', total: '0.00' }),
            })),
          }
        : l,
    ),
  };
}
