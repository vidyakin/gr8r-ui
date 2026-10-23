/* Калькуляция заказа покупателя (этап 7): плановая себестоимость изделий по спецификациям с параметрами
   плюс разовые расходы (доставка и т. п.), источник цены себестоимости и наценка.

   Состав берётся из спецификации товара: своя спецификация варианта или спецификация по умолчанию родителя.
   Количество строк спецификации считается формулами по значениям параметров строки заказа, условия строк
   исключают ненужные строки из состава. Цена себестоимости — по выбранному источнику; если цены по нему нет,
   берётся следующий по порядку: средняя склада → последняя цена закупки → закупочная цена товара. */
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { computeBomCost, computeLine, computeTotals, dec, explodeBom, fmt, mul, passParams, withPct, type BomItemInput, type Explosion } from '@gr8r/shared';
import type { CostPriceSource } from '@gr8r/shared';
import type { Db } from './client';
import { DomainError } from './errors';
import { documentLines, documents, orderCalculationLines, orderCalculations } from './schema';
import { loadProductionGraph } from './production';
import { resolveSpecForProduct } from './specs';
import { loadAvgCosts } from './stock';

export type CalcLineKind = 'material' | 'semi' | 'work' | 'expense' | 'extra';

export interface ExtraLine {
  id: string;
  name: string;
  qty: string;
  price: string;
  note: string;
}

export interface CalculationInput {
  /** Заказ покупателя */
  customerOrderId: string;
  /** Источник цены себестоимости */
  priceSource?: CostPriceSource;
  /** Наценка, % */
  markupPct?: string;
}

/** Последняя цена закупки по товарам: цена строки последнего проведённого поступления */
async function loadLastPurchasePrices(db: Db, productIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!productIds.length) return out;
  const rows = await db
    .select({ productId: documentLines.productId, price: documentLines.price, date: documents.date })
    .from(documentLines)
    .innerJoin(documents, eq(documents.id, documentLines.documentId))
    .where(and(inArray(documentLines.productId, productIds), eq(documents.type, 'receipt'), eq(documents.status, 'posted')))
    .orderBy(desc(documents.date), desc(documents.createdAt));
  for (const r of rows) if (!out.has(r.productId)) out.set(r.productId, r.price);
  return out;
}

/** Цена себестоимости по источнику с откатом на следующий: средняя склада → последняя цена закупки → закупочная цена */
export function resolveCostPrice(source: CostPriceSource, p: { purchasePrice?: string | null }, avg: string | null | undefined, lastPurchase: string | null | undefined): string | null {
  if (source === 'avg') {
    if (avg !== null && avg !== undefined && dec(avg) > 0n) return avg;
    if (lastPurchase !== null && lastPurchase !== undefined && dec(lastPurchase) > 0n) return lastPurchase;
    return p.purchasePrice && dec(p.purchasePrice) > 0n ? p.purchasePrice : null;
  }
  if (source === 'last_purchase') {
    if (lastPurchase !== null && lastPurchase !== undefined && dec(lastPurchase) > 0n) return lastPurchase;
    if (avg !== null && avg !== undefined && dec(avg) > 0n) return avg;
    return p.purchasePrice && dec(p.purchasePrice) > 0n ? p.purchasePrice : null;
  }
  if (p.purchasePrice && dec(p.purchasePrice) > 0n) return p.purchasePrice;
  if (avg !== null && avg !== undefined && dec(avg) > 0n) return avg;
  return lastPurchase ?? null;
}

/** Строка состава в калькуляции */
interface CalcLine {
  kind: CalcLineKind;
  documentLineId: string | null;
  productId: string | null;
  name: string;
  unitCode: string;
  qty: string;
  price: string;
  amount: string;
  unitCost: string | null;
  note: string;
}

/** Пересчёт калькуляции заказа: состав по спецификациям строк заказа + разовые расходы */
export async function recalculateOrderCalculation(db: Db, workspaceId: string, input: CalculationInput): Promise<string> {
  const [order] = await db.select().from(documents).where(and(eq(documents.id, input.customerOrderId), eq(documents.workspaceId, workspaceId))).limit(1);
  if (!order) throw new DomainError(404, 'not_found', 'document not found');
  if (order.type !== 'customer_order') throw new DomainError(422, 'invalid_type', 'This is not a customer order');
  const [existing] = await db.select().from(orderCalculations).where(eq(orderCalculations.documentId, order.id)).limit(1);
  const priceSource = input.priceSource ?? (existing?.priceSource as CostPriceSource | undefined) ?? 'avg';
  const markupPct = input.markupPct ?? existing?.markupPct ?? '0';
  const extra = existing ? await db.select().from(orderCalculationLines).where(and(eq(orderCalculationLines.calculationId, existing.id), eq(orderCalculationLines.kind, 'extra'))) : [];
  const lines = await calcLines(db, workspaceId, order.id, priceSource, dec(markupPct));
  const costTotal = lines.rows.reduce((sum, l) => sum + dec(l.amount), 0n) + extra.reduce((sum, e) => sum + mul(dec(e.qty), dec(e.price)), 0n);
  const lineCostTotal = lines.rows.filter(l => l.kind !== 'extra').reduce((sum, l) => sum + dec(l.amount), 0n);
  // расчётная цена строк заказа: себестоимость единицы изделия × (1 + наценка)
  const priceTotal = lines.orderPrices.reduce((sum, p) => sum + mul(dec(p.price), dec(p.qty)), 0n);
  const values = {
    workspaceId,
    documentId: order.id,
    priceSource,
    markupPct,
    costTotal: fmt(costTotal, 2),
    lineCostTotal: fmt(lineCostTotal, 2),
    priceTotal: fmt(priceTotal, 2),
    updatedAt: new Date(),
  };
  const calc = existing
    ? (await db.update(orderCalculations).set(values).where(eq(orderCalculations.id, existing.id)).returning())[0]!
    : (await db.insert(orderCalculations).values(values).returning())[0]!;
  // строки пересобираются целиком: разовые расходы сохраняются
  await db.delete(orderCalculationLines).where(eq(orderCalculationLines.calculationId, calc.id));
  const rows: (typeof orderCalculationLines.$inferInsert)[] = [
    ...lines.rows.map((l, n) => ({ workspaceId, calculationId: calc.id, documentLineId: l.documentLineId, kind: l.kind, productId: l.productId, name: l.name, unitCode: l.unitCode, qty: l.qty, price: l.price, amount: l.amount, unitCost: l.unitCost, note: l.note, sortOrder: n })),
    ...extra.map((e, n) => ({ workspaceId, calculationId: calc.id, documentLineId: null, kind: 'extra' as const, productId: null, name: e.name, unitCode: e.unitCode, qty: e.qty, price: e.price, amount: fmt(mul(dec(e.qty), dec(e.price)), 2), unitCost: null, note: e.note, sortOrder: lines.rows.length + n })),
  ];
  if (rows.length) await db.insert(orderCalculationLines).values(rows);
  return calc.id;
}

/** Состав заказа по спецификациям: строки заказа разворачиваются по своим параметрам.
    Себестоимость единицы изделия — та же, что плановая (computeBomCost): материалы, работы с фиксированными затратами,
    полуфабрикаты по своим спецификациям и накладные %, только цены материалов — по источнику калькуляции.
    Строки состава — расшифровка развёртки; фиксированные затраты и накладные идут отдельной строкой */
async function calcLines(db: Db, workspaceId: string, orderId: string, priceSource: CostPriceSource, markup: bigint): Promise<{ rows: CalcLine[]; orderPrices: { lineId: string; qty: string; price: string }[] }> {
  const graph = await loadProductionGraph(db);
  const rates = new Map(graph.centers.map(w => [w.id, w.hourlyRate]));
  const orderLines = await db.select().from(documentLines).where(eq(documentLines.documentId, orderId)).orderBy(asc(documentLines.sortOrder));
  // цены всех материалов и расходов спецификаций — один раз на калькуляцию
  const matIds = graph.mats.map(p => p.id);
  const matById = new Map(graph.mats.map(p => [p.id, p]));
  const matAvg = await loadAvgCosts(db, matIds);
  const matLast = await loadLastPurchasePrices(db, matIds);
  const priceOf = (pid: string) => resolveCostPrice(priceSource, matById.get(pid) ?? {}, matAvg.get(pid), matLast.get(pid));
  const pricing = { materialPrice: priceOf, workCenterRate: (wid: string) => rates.get(wid) };
  const byId = new Map(graph.inputs.map(i => [i.id, i]));
  const out: CalcLine[] = [];
  /** Расчётные цены строк заказа (по наценке) */
  const orderPrices: { lineId: string; qty: string; price: string }[] = [];
  for (const l of orderLines) {
    const choice = await resolveSpecForProduct(db, workspaceId, l.productId);
    if (!choice) continue;
    const params = l.params ?? {};
    const inputs: BomItemInput[] = graph.inputs.map(i => (i.id === choice.itemId ? { ...i, params } : i));
    let explosion: Explosion;
    let unit: bigint;
    try {
      explosion = explodeBom(inputs, choice.itemId, l.qty);
      unit = dec(computeBomCost(inputs, choice.itemId, pricing).unit.total);
    } catch (e) {
      throw new DomainError(422, 'formula_error', e instanceof Error ? e.message : 'The bill of materials cannot be expanded');
    }
    const lineStart = out.length;
    for (const m of explosion.materials) {
      const p = matById.get(m.productId);
      const price = priceOf(m.productId) ?? '0';
      out.push({ kind: m.expense ? 'expense' : 'material', documentLineId: l.id, productId: m.productId, name: p?.name ?? '', unitCode: p?.unitCode ?? '796', qty: m.qty, price, amount: fmt(mul(dec(m.qty), dec(price)), 2), unitCost: null, note: '' });
    }
    for (const s of explosion.semis) {
      // полуфабрикат со склада — по своей спецификации (с переданными параметрами), как в плановой себестоимости
      const child = byId.get(s.itemId);
      const childInputs = child ? inputs.map(i => (i.id === s.itemId ? { ...i, params: passParams(params, child.paramKeys ?? []) } : i)) : inputs;
      const price = child ? computeBomCost(childInputs, s.itemId, pricing).unit.total : '0';
      out.push({ kind: 'semi', documentLineId: l.id, productId: s.productId ?? null, name: s.name, unitCode: s.unitCode ?? '796', qty: s.qty, price, amount: fmt(mul(dec(s.qty), dec(price)), 2), unitCost: null, note: '' });
    }
    for (const w of explosion.works) {
      const rate = w.rate ?? (w.workCenterId ? (rates.get(w.workCenterId) ?? null) : null);
      const price = rate ?? '0';
      out.push({ kind: 'work', documentLineId: l.id, productId: w.operationId ?? null, name: w.operation, unitCode: '356', qty: w.hours, price, amount: fmt(mul(dec(w.hours), dec(price)), 2), unitCost: null, note: '' });
    }
    // фиксированные затраты работ и накладные: разница плановой себестоимости строки и расшифровки
    const total = mul(unit, dec(l.qty));
    const rest = total - out.slice(lineStart).reduce((sum, x) => sum + dec(x.amount), 0n);
    if (rest !== 0n) out.push({ kind: 'work', documentLineId: l.id, productId: null, name: 'Fixed costs and overhead', unitCode: '796', qty: '1', price: fmt(rest, 2), amount: fmt(rest, 2), unitCost: null, note: '' });
    for (const x of out.slice(lineStart)) x.unitCost = fmt(unit, 2);
    // расчётная цена строки заказа: себестоимость единицы × (1 + наценка)
    orderPrices.push({ lineId: l.id, qty: l.qty, price: fmt(withPct(unit, markup), 2) });
  }
  return { rows: out, orderPrices };
}

/** Разовые расходы калькуляции: строки заменяются целиком */
export async function setCalculationExtra(db: Db, workspaceId: string, calculationId: string, extra: ExtraLine[]): Promise<void> {
  const [calc] = await db.select().from(orderCalculations).where(and(eq(orderCalculations.id, calculationId), eq(orderCalculations.workspaceId, workspaceId))).limit(1);
  if (!calc) throw new DomainError(404, 'not_found', 'calculation not found');
  await db.delete(orderCalculationLines).where(and(eq(orderCalculationLines.calculationId, calc.id), eq(orderCalculationLines.kind, 'extra')));
  const rows: (typeof orderCalculationLines.$inferInsert)[] = extra.map((e, n) => ({ workspaceId, calculationId: calc.id, documentLineId: null, kind: 'extra' as const, productId: null, name: e.name, unitCode: '796', qty: e.qty, price: e.price, amount: fmt(mul(dec(e.qty), dec(e.price)), 2), unitCost: null, note: e.note, sortOrder: 1000 + n }));
  if (rows.length) await db.insert(orderCalculationLines).values(rows);
  await db.update(orderCalculations).set({ updatedAt: new Date() }).where(eq(orderCalculations.id, calc.id));
}

/** Применить цену к строкам заказа: цена строки = себестоимость единицы × (1 + наценка) */
export async function applyCalculationPrices(db: Db, workspaceId: string, calculationId: string): Promise<number> {
  const [calc] = await db.select().from(orderCalculations).where(and(eq(orderCalculations.id, calculationId), eq(orderCalculations.workspaceId, workspaceId))).limit(1);
  if (!calc) throw new DomainError(404, 'not_found', 'calculation not found');
  const lines = await db.select().from(orderCalculationLines).where(eq(orderCalculationLines.calculationId, calc.id));
  // себестоимость единицы по каждой строке заказа — сохранена в строках калькуляции при пересчёте
  const byLine = new Map<string, string>();
  for (const l of lines) if (l.documentLineId && l.kind !== 'extra' && l.unitCost !== null) byLine.set(l.documentLineId, l.unitCost);
  const markup = dec(calc.markupPct);
  const [docRow] = await db.select({ priceIncludesVat: documents.priceIncludesVat, status: documents.status }).from(documents).where(eq(documents.id, calc.documentId)).limit(1);
  // цены меняются только в черновике: у проведённого заказа сначала отменяют проведение
  if (docRow?.status !== 'draft') throw new DomainError(422, 'not_draft', 'Prices can only be applied to a draft order: unpost it first');
  const includesVat = docRow?.priceIncludesVat ?? true;
  let applied = 0;
  for (const [lineId, unitCost] of byLine) {
    const [docLine] = await db.select().from(documentLines).where(and(eq(documentLines.id, lineId), eq(documentLines.workspaceId, workspaceId))).limit(1);
    if (!docLine) continue;
    const price = fmt(withPct(dec(unitCost), markup), 2);
    // суммы строки и итоги документа пересчитываются вместе с ценой
    const amounts = computeLine({ qty: docLine.qty, price, discountPct: docLine.discountPct, vatRate: docLine.vatRate }, includesVat);
    await db.update(documentLines).set({ price, net: amounts.net, vatAmount: amounts.vatAmount, total: amounts.total }).where(eq(documentLines.id, lineId));
    applied++;
  }
  // итоги документа — по обновлённым строкам
  const docLines = await db.select().from(documentLines).where(eq(documentLines.documentId, calc.documentId));
  const t = computeTotals(docLines.map(l => ({ net: l.net, vatAmount: l.vatAmount, total: l.total, vatRate: l.vatRate })));
  await db.update(documents).set({ amountNet: t.net, vatTotal: t.vat, total: t.total, updatedAt: new Date() }).where(eq(documents.id, calc.documentId));
  return applied;
}
