/* Заказ на производство и выпуск продукции: снимок развёрнутой спецификации, списание материалов и полуфабрикатов,
   приход продукции по фактической себестоимости (материалы по средней + работы + накладные), автоматический резерв
   выпущенной продукции под связанный заказ покупателя и «один документ выпуска за день на участок».

   Модель: заказ на производство (`production_order`) и выпуск (`production`) — обычные документы, а производственные данные
   лежат рядом: production_items (что выпускаем), production_components (снимок состава), production_headers (изготовитель и сроки).
   Правила — в docs/architecture.md, раздел «Производство». */
import { and, asc, desc, eq, inArray, isNull, ne, notInArray, or, sql } from 'drizzle-orm';
import { allocateDisassembly, checkCostShares, computeBomCost, dec, div, explodeBom, fmt, FULFIL_TYPES, mul, pctOf, resolveMaterialPrice, roundDiv, BomFormulaError, DisassemblyShareError, type BomItemInput, type SpecParamDef, type Explosion, type MaterialOwner } from '@gr8r/shared';
import type { Db } from './client';
import { DomainError } from './errors';
import { DOCUMENT_HOOKS, STATE_HOOKS } from './document-hooks';
import { createDocument, postDocument, unpostDocument, assertProcessingOrder, type DocCtx } from './documents';
import { recordEvent } from './events';
import { applyCustomerStockMoves, revertCustomerStockMoves, type CustomerMoveRequest } from './customer-stock';
import { applyStockMoves, loadAvgCosts, loadInventorySettings, revalueMove, type MoveRequest } from './stock';
import { materialRows, reduceReservation, releaseOrderMaterials, reserveChildOutput, reserveOrderMaterials, restoreReservation, supplierForProduct } from './materials';
import { bomLines, companies, documentLines, documents, manufacturedItems, pieceworkLines, productionOperations, productManufacturing, productionComponents, productionHeaders, productionItems, productionPlacements, productionStages, products, stockMoves, stockReservations, warehouses, workCenters, workspaces } from './schema';
import { FINAL_STAGE, itemStagePlan, listProductionKinds, stageDef, stageKey, type StageDef } from './production-stages';
import { checkParamValues, loadSpecParams, resolveSpecForProduct, specParamFields } from './specs';
import { ensureVariant, isVariant } from './variants';
import { uuidv7 } from './uuid';

export type ItemRow = typeof manufacturedItems.$inferSelect;

/** Вид операции производственного документа: сборка или разборка */
export type ProductionOperation = 'assembly' | 'disassembly';

/** Вид операции документа: у производственных — из поля operation, у остальных — пусто */
export const operationOfDoc = (doc: { operation?: string | null }): ProductionOperation => (doc.operation === 'disassembly' ? 'disassembly' : 'assembly');

/* ---------------- справочники и план ---------------- */

/** Строка состава выпуска: материал, полуфабрикат, работа, расход или выходной продукт разборки */
export interface PlannedComponent {
  kind: 'material' | 'semi' | 'work' | 'expense' | 'output';
  /** Чей материал: наш (списывается со своего склада по средней) или давальца (с остатка давальца, только количества) */
  ownerKind: MaterialOwner;
  /** Материал или полуфабрикат на складе */
  productId: string | null;
  /** Продукция (для полуфабриката) */
  itemId: string | null;
  /** Участок (работа) */
  workCenterId: string | null;
  /** Название работы */
  operation: string;
  /** Операция (товар каталога) — работа спецификации может ссылаться на операцию */
  operationId: string | null;
  qty: string;
  hours: string;
  /** Ставка за час из строки спецификации; пусто — ставка участка */
  rate: string | null;
  fixedCost: string | null;
  /** Плановая стоимость строки */
  plannedCost: string;
  /** Этап, на котором расходуется материал или выполняется работа; пусто — этап изделия не задан */
  stageId: string | null;
  /** Строка состава заказа, из которой взята эта строка (выпуск наследует состав заказа) */
  sourceComponentId?: string | null;
  /** Выходной продукт разборки: доля стоимости исходного товара, % (пусто — доли не заданы) */
  costShare?: string | null;
}

/** Источник цены материала — настройка воркспейса */
export async function loadPriceSource(db: Db, workspaceId: string): Promise<'purchase' | 'price' | 'avg_cost'> {
  const [ws] = await db.select({ settings: workspaces.settings }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  const v = ws?.settings?.materialPriceSource;
  return v === 'price' || v === 'avg_cost' ? v : 'purchase';
}

/** Продукция со строками спецификаций, участки и товары: всё, что нужно планированию и расчёту себестоимости */
export async function loadProductionGraph(db: Db) {
  const items = await db.select().from(manufacturedItems).where(isNull(manufacturedItems.archivedAt)).orderBy(asc(manufacturedItems.name));
  const lines = await db.select().from(bomLines).orderBy(asc(bomLines.itemId), asc(bomLines.sortOrder), asc(bomLines.createdAt));
  const centers = await db.select().from(workCenters);
  const productIds = [...new Set(lines.map(l => l.productId).filter((x): x is string => !!x))];
  const mats = productIds.length ? await db.select().from(products).where(inArray(products.id, productIds)) : [];
  const avg = productIds.length ? await loadAvgCosts(db, productIds) : new Map<string, string>();
  const byItem = new Map<string, typeof bomLines.$inferSelect[]>();
  for (const l of lines) byItem.set(l.itemId, [...(byItem.get(l.itemId) ?? []), l]);
  const specParams = await loadSpecParams(db);
  const inputs: BomItemInput[] = items.map(i => ({
    id: i.id,
    name: i.name,
    unitCode: i.unitCode,
    productId: i.productId,
    mode: i.mode,
    batchQty: i.batchQty,
    overheadPct: i.overheadPct,
    // ключи, доступные в формулах строк: параметры спецификации и характеристики категории товара
    paramKeys: specParams.get(i.id)?.keys ?? [],
    lines: (byItem.get(i.id) ?? []).map(l => ({ id: l.id, kind: l.kind, qty: l.qty, productId: l.productId, costShare: l.costShare, scrapPct: l.scrapPct, unitCode: l.unitCode, childItemId: l.childItemId, semiMode: l.semiMode, operation: l.operation, workCenterId: l.workCenterId, hours: l.hours, rate: l.rate, fixedCost: l.fixedCost, stageId: l.stageId, qtyExpr: l.qtyExpr, condition: l.condition })),
  }));
  return { items, byItem, centers, mats, avg, inputs };
}

/** Себестоимость единицы изделия по спецификации (плановая) */
function unitCost(graph: Awaited<ReturnType<typeof loadProductionGraph>>, itemId: string, source: 'purchase' | 'price' | 'avg_cost', params?: Record<string, unknown> | null): string | null {
  try {
    const prod = new Map(graph.mats.map(p => [p.id, p]));
    const rates = new Map(graph.centers.map(w => [w.id, w.hourlyRate]));
    // значения параметров позиции считают формулы строк её спецификации
    const inputs = params === undefined ? graph.inputs : graph.inputs.map(i => (i.id === itemId ? { ...i, params } : i));
    const tree = computeBomCost(inputs, itemId, {
      materialPrice: pid => (prod.has(pid) ? resolveMaterialPrice(source, prod.get(pid)!, graph.avg.get(pid)) : null),
      workCenterRate: wid => rates.get(wid),
    });
    return tree.unit.total;
  } catch {
    return null;
  }
}

/** План состава выпуска: развёртка спецификации на количество с плановыми стоимостями.
    Значения параметров изделия (`params`) считают формулы количества и условия строк.
    У разборки (`mode = 'disassembly'`) состав другой: исходный товар (что разбирают) — материалом, а строки
    спецификации — выходные продукты (kind `output`) и работы */
export async function planComponents(db: Db, workspaceId: string, itemId: string, qty: string, params?: Record<string, unknown> | null): Promise<PlannedComponent[]> {
  const graph = await loadProductionGraph(db);
  const source = await loadPriceSource(db, workspaceId);
  const prod = new Map(graph.mats.map(p => [p.id, p]));
  const rates = new Map(graph.centers.map(w => [w.id, w.hourlyRate]));
  // значения параметров — только у изделия, чья спецификация разворачивается: вложенной продукции
  // передаются по совпадающим ключам
  const inputs = params === undefined ? graph.inputs : graph.inputs.map(i => (i.id === itemId ? { ...i, params } : i));
  let explosion: Explosion;
  try {
    explosion = explodeBom(inputs, itemId, qty);
  } catch (e) {
    if (e instanceof BomFormulaError) throw new DomainError(422, 'formula_error', e.message);
    throw new DomainError(422, 'bom_cycle', e instanceof Error ? e.message : 'The bill of materials cannot be expanded');
  }
  const item = graph.items.find(i => i.id === itemId);
  const out: PlannedComponent[] = [];
  // разборка: исходный товар — то, что разбирают; он списывается со склада и обеспечивается как материал
  if (item?.mode === 'disassembly') {
    if (!item.productId) throw new DomainError(422, 'item_not_stockable', `“${item.name}” has no product of the catalogue: there is nothing to disassemble`);
    out.push({ kind: 'material', ownerKind: 'own', productId: item.productId, itemId: null, workCenterId: null, operation: '', operationId: null, qty: fmt(dec(qty), 3), hours: '0', rate: null, fixedCost: null, plannedCost: '0', stageId: null });
  }
  for (const m of explosion.materials) {
    const p = prod.get(m.productId);
    const price = p ? resolveMaterialPrice(source, p, graph.avg.get(m.productId)) : null;
    // расход подрядчику: в себестоимость входит, но со склада не списывается
    out.push({ kind: m.expense ? 'expense' : 'material', ownerKind: 'own', productId: m.productId, itemId: null, workCenterId: null, operation: '', operationId: null, qty: m.qty, hours: '0', rate: null, fixedCost: null, plannedCost: fmt(mul(dec(m.qty), dec(price ?? '0'))), stageId: m.stageId ?? null });
  }
  for (const s of explosion.semis) {
    // полуфабрикат в режиме stock списывается со склада: нужен товар каталога
    if (!s.productId) throw new DomainError(422, 'item_not_stockable', `“${s.name}” has no product of the catalogue: it cannot be written off from stock`);
    const cost = unitCost(graph, s.itemId, source);
    out.push({ kind: 'semi', ownerKind: 'own', productId: s.productId, itemId: s.itemId, workCenterId: null, operation: '', operationId: null, qty: s.qty, hours: '0', rate: null, fixedCost: null, plannedCost: fmt(mul(dec(s.qty), dec(cost ?? '0'))), stageId: s.stageId ?? null });
  }
  // выходные продукты разборки: их стоимость считается при выпуске (доля, цена или количество)
  for (const o of explosion.outputs) {
    out.push({ kind: 'output', ownerKind: 'own', productId: o.productId, itemId: null, workCenterId: null, operation: '', operationId: null, qty: o.qty, hours: '0', rate: null, fixedCost: null, plannedCost: '0', stageId: o.stageId ?? null, costShare: o.costShare ?? null });
  }
  for (const w of explosion.works) {
    const rate = w.rate ?? (w.workCenterId ? (rates.get(w.workCenterId) ?? null) : null);
    const cost = mul(dec(w.hours), dec(rate ?? '0')) + dec(w.fixedCost ?? '0');
    out.push({ kind: 'work', ownerKind: 'own', productId: null, itemId: null, workCenterId: w.workCenterId, operation: w.operation, operationId: w.operationId ?? null, qty: '0', hours: w.hours, rate, fixedCost: w.fixedCost, plannedCost: fmt(cost), stageId: w.stageId ?? null });
  }
  return out;
}

/* ---------------- этапы производства ---------------- */

/** Источник позиции: заказ на производство или строка заказа покупателя */
export interface StageSource {
  sourceItemId: string | null;
  customerOrderLineId: string | null;
}

/** Итоги по этапу: сколько выпущено и во что обошлось */
export interface StageTotal {
  qty: bigint;
  cost: bigint;
}

/** Ключ источника в итогах по этапам */
const sourceKey = (s: StageSource): string => (s.sourceItemId ? `s:${s.sourceItemId}` : `c:${s.customerOrderLineId}`);

/** Сколько выпущено по позиции на каждом этапе и сколько это стоило (проведённые выпуски) */
async function stageTotals(db: Db, sources: StageSource[]): Promise<Map<string, StageTotal>> {
  const itemIds = sources.map(s => s.sourceItemId).filter((x): x is string => !!x);
  const lineIds = sources.map(s => s.customerOrderLineId).filter((x): x is string => !!x);
  if (!itemIds.length && !lineIds.length) return new Map();
  const rows = await db
    .select({
      source: productionItems.sourceItemId,
      customer: productionItems.customerOrderLineId,
      stageId: productionHeaders.stageId,
      qty: sql<string>`sum(${productionItems.qty})`,
      cost: sql<string>`coalesce(sum(${productionItems.stageCost}), 0)`,
    })
    .from(productionItems)
    .innerJoin(documents, eq(documents.id, productionItems.documentId))
    .leftJoin(productionHeaders, eq(productionHeaders.documentId, documents.id))
    .where(
      and(
        eq(documents.type, 'production'),
        eq(documents.status, 'posted'),
        or(itemIds.length ? inArray(productionItems.sourceItemId, itemIds) : undefined, lineIds.length ? inArray(productionItems.customerOrderLineId, lineIds) : undefined),
      ),
    )
    .groupBy(productionItems.sourceItemId, productionItems.customerOrderLineId, productionHeaders.stageId);
  const out = new Map<string, StageTotal>();
  for (const r of rows) {
    const key = `${r.source ? `s:${r.source}` : `c:${r.customer}`}|${stageKey(r.stageId)}`;
    const cur = out.get(key) ?? { qty: 0n, cost: 0n };
    cur.qty += dec(r.qty);
    cur.cost += dec(r.cost);
    out.set(key, cur);
  }
  return out;
}

/** Этап выпуска изделия: по виду производства; без вида — предопределённый «Завершение производства» */
async function resolveStage(db: Db, itemId: string, stageId: string | null): Promise<StageDef> {
  const plan = await itemStagePlan(db, itemId);
  if (!plan.kindId) {
    if (stageId) throw new DomainError(422, 'stage_mismatch', 'The product has no production kind: it is produced in one stage');
    return FINAL_STAGE;
  }
  const id = stageId ?? (plan.stages.find(s => s.isFinal)?.id ?? plan.stages[plan.stages.length - 1].id);
  const st = plan.stages.find(s => s.id === id);
  if (!st) throw new DomainError(422, 'stage_mismatch', 'The stage belongs to another production kind');
  return st;
}

/** Предел этапа: сколько уже выполнено и сколько можно выполнить (предыдущий этап ограничивает) */
interface StageLimit {
  /** Выполнено на этом этапе */
  done: bigint;
  /** Сколько всего можно выполнить на этом этапе */
  cap: bigint;
  /** Предел задан предыдущим этапом, а не заказом */
  byStage: boolean;
}

async function stageLimit(db: Db, opts: { itemId: string; stage: StageDef; ordered: bigint; source: StageSource; totals: Map<string, StageTotal> }): Promise<StageLimit> {
  const plan = await itemStagePlan(db, opts.itemId);
  const idx = plan.stages.findIndex(s => s.id === opts.stage.id);
  const prev = idx > 0 ? plan.stages[idx - 1] : null;
  const done = opts.totals.get(`${sourceKey(opts.source)}|${stageKey(opts.stage.id)}`)?.qty ?? 0n;
  if (!prev) return { done, cap: opts.ordered, byStage: false };
  const prevDone = opts.totals.get(`${sourceKey(opts.source)}|${stageKey(prev.id)}`)?.qty ?? 0n;
  return { done, cap: prevDone < opts.ordered ? prevDone : opts.ordered, byStage: prevDone < opts.ordered };
}

/** Себестоимость незавершённого производства на единицу: средняя по выполненным промежуточным этапам */
async function wipUnitCost(source: StageSource, stages: StageDef[], totals: Map<string, StageTotal>): Promise<bigint> {
  let unit = 0n;
  for (const st of stages) {
    if (st.isFinal) continue;
    const t = totals.get(`${sourceKey(source)}|${stageKey(st.id)}`);
    if (!t || t.qty <= 0n) continue;
    unit += div(t.cost, t.qty);
  }
  return unit;
}

/** Этап строки состава: строка без этапа или с этапом другого вида (вид назначен или сменён после спецификации и заказа)
    относится к финальному этапу, чтобы её материалы не потерялись */
function componentStage(c: { stageId: string | null }, stages: StageDef[]): string | null {
  if (stages.some(s => s.id === c.stageId)) return c.stageId;
  return (stages.find(s => s.isFinal) ?? stages[stages.length - 1]).id;
}

/** Состав изделия должен быть привязан к этапам его вида производства */
async function assertPlanStages(db: Db, itemId: string, components: PlannedComponent[]): Promise<void> {
  const plan = await itemStagePlan(db, itemId);
  const ids = new Set(plan.stages.map(s => s.id));
  for (const c of components) {
    if (!plan.kindId) {
      if (c.stageId) throw new DomainError(422, 'stage_mismatch', 'The product has no production kind: the stage of its lines is not needed');
      continue;
    }
    if (!c.stageId) throw new DomainError(422, 'stage_required', 'Set the stage of every line of the bill of materials');
    if (!ids.has(c.stageId)) throw new DomainError(422, 'stage_mismatch', 'The stage of a line belongs to another production kind');
  }
}

/* ---------------- заказ на производство ---------------- */

export interface ProductionOrderInput {
  id?: string;
  /** Вид операции: сборка (по умолчанию) или разборка */
  operation?: ProductionOperation;
  workCenterId?: string | null;
  warehouseId?: string | null;
  targetWarehouseId?: string | null;
  date?: string;
  plannedStart?: string | null;
  plannedEnd?: string | null;
  comment?: string;
  parentDocumentId?: string | null;
  /** Заказ на переработку: выпуск делается из давальческого сырья, продукция уходит на остаток давальца */
  processingOrderId?: string | null;
  items: { itemId: string; qty: string; customerOrderLineId?: string | null; planLineId?: string | null; params?: Record<string, unknown> | null }[];
}

/** Вариант товара по строке заказа покупателя: строка ссылается на вариант — выпускается он */
async function variantOfLine(db: Db, customerOrderLineId: string | null): Promise<string | null> {
  if (!customerOrderLineId) return null;
  const [line] = await db.select({ productId: documentLines.productId }).from(documentLines).where(eq(documentLines.id, customerOrderLineId)).limit(1);
  if (!line) return null;
  return (await isVariant(db, line.productId)) ? line.productId : null;
}

/** Позиция заказа на производство с параметрами: значения проверяются по описанию параметров спецификации,
    выпускаемый вариант — по строке заказа покупателя, иначе по значениям «разреза склада» (создаётся лениво) */
async function itemParams(db: Db, ctx: DocCtx, item: ItemRow, i: { params?: Record<string, unknown> | null; customerOrderLineId?: string | null }): Promise<{ params: Record<string, unknown>; variantId: string | null }> {
  const params = i.params && Object.keys(i.params).length ? checkParamValues(await specParamFields(db, item.id), i.params) : {};
  const fromLine = await variantOfLine(db, i.customerOrderLineId ?? null);
  if (fromLine || !item.productId || !Object.keys(params).length) return { params, variantId: fromLine };
  const [product] = await db.select().from(products).where(eq(products.id, item.productId)).limit(1);
  // спецификация самого варианта выпускает его как товар спецификации
  if (!product || product.parentProductId) return { params, variantId: null };
  const variant = await ensureVariant(db, ctx.workspaceId, product, (item.params ?? []) as SpecParamDef[], params);
  return { params, variantId: variant?.id ?? null };
}

/** Позиции заказа: что выпускаем */
export async function createProductionOrder(db: Db, ctx: DocCtx, input: ProductionOrderInput): Promise<string> {
  const itemIds = [...new Set(input.items.map(i => i.itemId))];
  const items = itemIds.length ? await db.select().from(manufacturedItems).where(inArray(manufacturedItems.id, itemIds)) : [];
  const byItem = new Map(items.map(i => [i.id, i]));
  for (const i of input.items) {
    const it = byItem.get(i.itemId);
    if (!it || it.archivedAt) throw new DomainError(422, 'invalid_reference', 'The product does not exist or is archived');
    if (dec(i.qty) <= 0n) throw new DomainError(422, 'invalid_quantity', 'The quantity must be greater than zero');
  }
  // вид операции заказа должен совпадать с видом спецификации каждой позиции
  const operation = input.operation === 'disassembly' ? 'disassembly' : 'assembly';
  for (const i of input.items) {
    const it = byItem.get(i.itemId)!;
    if ((it.mode === 'disassembly' ? 'disassembly' : 'assembly') !== operation)
      throw new DomainError(422, 'operation_mismatch', `“${it.name}” is a ${it.mode === 'disassembly' ? 'disassembly' : 'assembly'} specification: the order cannot be of another kind`);
  }
  // строка заказа покупателя: должна быть у проведённого заказа покупателя
  for (const i of input.items) {
    if (i.customerOrderLineId) await assertCustomerOrderLine(db, i.customerOrderLineId);
  }
  if (input.workCenterId) await assertWorkCenter(db, input.workCenterId);
  // заказ на переработку: заказ покупателя с видом операции «Переработка» — основание заказа на производство
  if (input.processingOrderId) {
    const processing = await assertProcessingOrder(db, input.processingOrderId);
    if (processing.status !== 'posted') throw new DomainError(422, 'base_not_posted', 'Post the customer order first');
    // разборка давальческого сырья не делается (решение пользователя): ветка разборки не знает владельца материала
    if (operation === 'disassembly') throw new DomainError(422, 'processing_disassembly', 'A disassembly cannot be made from customer materials');
  }
  const id = await createDocument(db, ctx, {
    ...(input.id ? { id: input.id } : {}),
    type: 'production_order',
    organizationId: null,
    warehouseId: input.warehouseId ?? undefined,
    targetWarehouseId: input.targetWarehouseId ?? undefined,
    operation,
    date: input.date,
    comment: input.comment ?? '',
    lines: [],
  });
  await db.insert(productionHeaders).values({
    workspaceId: ctx.workspaceId,
    documentId: id,
    workCenterId: input.workCenterId ?? null,
    plannedStart: input.plannedStart ? new Date(input.plannedStart) : null,
    plannedEnd: input.plannedEnd ? new Date(input.plannedEnd) : null,
    parentDocumentId: input.parentDocumentId ?? null,
    processingOrderId: input.processingOrderId ?? null,
  });
  // заказ на переработку — основание заказа на производство
  if (input.processingOrderId) await db.update(documents).set({ basedOnId: input.processingOrderId }).where(eq(documents.id, id));
  // новый заказ сразу в состоянии «запланирован»
  await db.update(documents).set({ state: 'planned' }).where(eq(documents.id, id));
  if (input.items.length) {
    // значения параметров и вариант товара: по строке заказа покупателя или по значениям «разреза склада»
    const resolved: { params: Record<string, unknown>; variantId: string | null }[] = [];
    for (const i of input.items) resolved.push(await itemParams(db, ctx, byItem.get(i.itemId)!, i));
    await db.insert(productionItems).values(
      input.items.map((i, n) => ({
        workspaceId: ctx.workspaceId,
        documentId: id,
        itemId: i.itemId,
        qty: i.qty,
        unitCode: byItem.get(i.itemId)!.unitCode,
        customerOrderLineId: i.customerOrderLineId ?? null,
        planLineId: i.planLineId ?? null,
        params: resolved[n]!.params,
        productVariantId: resolved[n]!.variantId,
        sortOrder: n,
      })),
    );
  }
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'document.created', entity: 'document', recordId: id, actorId: ctx.memberId, payload: { documentType: 'production_order' } });
  return id;
}

export interface ProductionOrderPatch {
  /** Вид операции: сборка или разборка (смена очищает снимок состава) */
  operation?: ProductionOperation;
  workCenterId?: string | null;
  warehouseId?: string | null;
  targetWarehouseId?: string | null;
  date?: string;
  plannedStart?: string | null;
  plannedEnd?: string | null;
  comment?: string;
  parentDocumentId?: string | null;
  items?: { itemId: string; qty: string; customerOrderLineId?: string | null; planLineId?: string | null; params?: Record<string, unknown> | null }[];
}

/** Правка заказа на производство: шапка и позиции */
export async function updateProductionOrder(db: Db, ctx: DocCtx, id: string, patch: ProductionOrderPatch): Promise<void> {
  const [doc] = await db.select().from(documents).where(eq(documents.id, id)).limit(1).for('update');
  if (!doc) throw new DomainError(404, 'not_found', 'document not found');
  if (doc.type !== 'production_order') throw new DomainError(422, 'invalid_type', 'This is not a production order');
  if (doc.status !== 'draft') throw new DomainError(409, 'not_draft', 'A posted document cannot be edited: unpost it first');
  const [header] = await db.select().from(productionHeaders).where(eq(productionHeaders.documentId, id)).limit(1);
  if (patch.workCenterId !== undefined && patch.workCenterId) await assertWorkCenter(db, patch.workCenterId);
  const set: Partial<typeof productionHeaders.$inferInsert> = { updatedAt: new Date() };
  if (patch.workCenterId !== undefined) set.workCenterId = patch.workCenterId;
  if (patch.plannedStart !== undefined) set.plannedStart = patch.plannedStart ? new Date(patch.plannedStart) : null;
  if (patch.plannedEnd !== undefined) set.plannedEnd = patch.plannedEnd ? new Date(patch.plannedEnd) : null;
  if (patch.parentDocumentId !== undefined) set.parentDocumentId = patch.parentDocumentId;
  if (header) await db.update(productionHeaders).set(set).where(eq(productionHeaders.documentId, id));
  else await db.insert(productionHeaders).values({ workspaceId: ctx.workspaceId, documentId: id, workCenterId: patch.workCenterId ?? null, plannedStart: patch.plannedStart ? new Date(patch.plannedStart) : null, plannedEnd: patch.plannedEnd ? new Date(patch.plannedEnd) : null, parentDocumentId: patch.parentDocumentId ?? null });
  const docSet: Partial<typeof documents.$inferInsert> = { updatedAt: new Date() };
  if (patch.warehouseId !== undefined) docSet.warehouseId = patch.warehouseId;
  if (patch.targetWarehouseId !== undefined) docSet.targetWarehouseId = patch.targetWarehouseId;
  if (patch.date) docSet.date = patch.date;
  if (patch.comment !== undefined) docSet.comment = patch.comment;
  // смена вида операции: снимок состава больше не подходит — его пересобирают кнопкой
  const operation = patch.operation ?? operationOfDoc(doc);
  if (operation === 'disassembly' && header?.processingOrderId) throw new DomainError(422, 'processing_disassembly', 'A disassembly cannot be made from customer materials');
  if (patch.operation !== undefined && patch.operation !== operationOfDoc(doc)) {
    docSet.operation = patch.operation;
    await db.delete(productionComponents).where(eq(productionComponents.documentId, id));
  }
  await db.update(documents).set(docSet).where(eq(documents.id, id));
  if (patch.items) {
    const itemIds = [...new Set(patch.items.map(i => i.itemId))];
    const items = itemIds.length ? await db.select().from(manufacturedItems).where(inArray(manufacturedItems.id, itemIds)) : [];
    const byItem = new Map(items.map(i => [i.id, i]));
    for (const i of patch.items) {
      if (!byItem.has(i.itemId)) throw new DomainError(422, 'invalid_reference', 'The product does not exist');
      if (i.customerOrderLineId) await assertCustomerOrderLine(db, i.customerOrderLineId);
      const it = byItem.get(i.itemId)!;
      if ((it.mode === 'disassembly' ? 'disassembly' : 'assembly') !== operation)
        throw new DomainError(422, 'operation_mismatch', `“${it.name}” is a ${it.mode === 'disassembly' ? 'disassembly' : 'assembly'} specification: the order cannot be of another kind`);
    }
    const resolved: { params: Record<string, unknown>; variantId: string | null }[] = [];
    for (const i of patch.items) resolved.push(await itemParams(db, ctx, byItem.get(i.itemId)!, i));
    await db.delete(productionItems).where(eq(productionItems.documentId, id));
    if (patch.items.length)
      await db.insert(productionItems).values(
        patch.items.map((i, n) => ({
          workspaceId: ctx.workspaceId,
          documentId: id,
          itemId: i.itemId,
          qty: i.qty,
          unitCode: byItem.get(i.itemId)!.unitCode,
          customerOrderLineId: i.customerOrderLineId ?? null,
          planLineId: i.planLineId ?? null,
          params: resolved[n]!.params,
          productVariantId: resolved[n]!.variantId,
          sortOrder: n,
        })),
      );
    // снимок состава больше не соответствует позициям — пересобирается по кнопке
    await db.delete(productionComponents).where(eq(productionComponents.documentId, id));
  }
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'document.updated', entity: 'document', recordId: id, actorId: ctx.memberId, payload: { changes: Object.keys(patch) } });
}

/** Снимок спецификации в заказ: состав по каждой позиции (развёртка на количество позиции) */
export async function fillOrderFromBom(db: Db, ctx: DocCtx, id: string): Promise<void> {
  const [doc] = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
  if (!doc) throw new DomainError(404, 'not_found', 'document not found');
  if (doc.type !== 'production_order') throw new DomainError(422, 'invalid_type', 'This is not a production order');
  // пересчёт снимка — только в черновике: в проведённом сначала отменяют проведение
  if (doc.status !== 'draft') throw new DomainError(422, 'not_draft', 'The composition can only be recalculated in a draft: unpost the order first');
  // заказ на переработку: сырьё по умолчанию давальческое — строки состава помечаются чужими
  const [orderHeader] = await db.select({ processingOrderId: productionHeaders.processingOrderId }).from(productionHeaders).where(eq(productionHeaders.documentId, id)).limit(1);
  const ownerKind: MaterialOwner = orderHeader?.processingOrderId ? 'customer' : 'own';
  const items = await db.select().from(productionItems).where(eq(productionItems.documentId, id)).orderBy(asc(productionItems.sortOrder));
  if (!items.length) throw new DomainError(422, 'no_items', 'Add products to produce first');
  // снимок пересобирается: ссылки выпусков на прежние строки состава снимаем
  const old = await db.select({ id: productionComponents.id }).from(productionComponents).where(eq(productionComponents.documentId, id));
  if (old.length) await db.update(productionComponents).set({ sourceComponentId: null }).where(inArray(productionComponents.sourceComponentId, old.map(c => c.id)));
  await db.delete(productionComponents).where(eq(productionComponents.documentId, id));
  const graph = await loadProductionGraph(db);
  const source = await loadPriceSource(db, ctx.workspaceId);
  const rows: (typeof productionComponents.$inferInsert)[] = [];
  for (const it of items) {
    const plan = await planComponents(db, ctx.workspaceId, it.itemId, it.qty, it.params);
    await assertPlanStages(db, it.itemId, plan);
    for (const c of plan) rows.push({ workspaceId: ctx.workspaceId, documentId: id, itemId: it.id, kind: c.kind, ownerKind: c.kind === 'work' || c.kind === 'expense' || c.kind === 'output' ? 'own' : ownerKind, productId: c.kind === 'work' ? c.operationId : c.productId, workCenterId: c.workCenterId, operation: c.operation, qty: c.qty, hours: c.hours, rate: c.rate, fixedCost: c.fixedCost, plannedCost: c.plannedCost, stageId: c.stageId, costShare: c.costShare ?? null, sortOrder: rows.length });
    const cost = unitCost(graph, it.itemId, source, it.params);
    if (cost) await db.update(productionItems).set({ plannedUnitCost: cost }).where(eq(productionItems.id, it.id));
  }
  if (rows.length) await db.insert(productionComponents).values(rows);
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'document.updated', entity: 'document', recordId: id, actorId: ctx.memberId, payload: { changes: ['components'] } });
}

/* ---------------- выпуск ---------------- */

/** Правка признака «чей материал» у строки состава заказа на производство: в одном выпуске можно смешать
    давальское сырьё и своё (например, упаковку). Только в черновике — снимок меняется до проведения */
export async function setComponentOwner(db: Db, ctx: DocCtx, orderId: string, componentId: string, ownerKind: MaterialOwner): Promise<void> {
  const [doc] = await db.select().from(documents).where(eq(documents.id, orderId)).limit(1);
  if (!doc || doc.type !== 'production_order') throw new DomainError(404, 'not_found', 'document not found');
  if (doc.status !== 'draft') throw new DomainError(409, 'not_draft', 'A posted document cannot be edited: unpost it first');
  const [comp] = await db.select().from(productionComponents).where(eq(productionComponents.id, componentId)).limit(1);
  if (!comp || comp.documentId !== orderId) throw new DomainError(404, 'not_found', 'The material line does not exist');
  if (comp.kind === 'work' || comp.kind === 'expense') throw new DomainError(422, 'own_materials_only', 'Works and expenses are always our own');
  if (ownerKind === 'customer' && !doc.warehouseId) throw new DomainError(422, 'warehouse_required', 'Select a warehouse: customer materials are stored there');
  await db.update(productionComponents).set({ ownerKind }).where(eq(productionComponents.id, componentId));
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'document.updated', entity: 'document', recordId: orderId, actorId: ctx.memberId, payload: { changes: ['components'] } });
}

export interface ProductionLineInput {
  /** Позиция заказа на производство, которую выполняет выпуск */
  orderItemId?: string | null;
  /** Строка заказа покупателя (выпуск прямо из заказа покупателя) */
  customerOrderLineId?: string | null;
  /** Этап выпуска; пусто — «Завершение производства» */
  stageId?: string | null;
  qty: string;
}

export interface ProductionInput {
  /** Заказ на производство */
  orderId?: string | null;
  /** Заказ покупателя */
  customerOrderId?: string | null;
  date?: string;
  workCenterId?: string | null;
  warehouseId?: string | null;
  targetWarehouseId?: string | null;
  lines: ProductionLineInput[];
}

/** План выпуска: что производим (продукция и количество) и из чего (состав) */
export interface ProductionPlan {
  itemId: string;
  qty: string;
  /** Позиция заказа на производство, которую выполняет выпуск */
  sourceItemId: string | null;
  /** Строка заказа покупателя, которую выполняет выпуск */
  customerOrderLineId: string | null;
  /** Этап выпуска; пусто — предопределённый «Завершение производства» */
  stageId: string | null;
  /** Товар, который выпускается: у варианта — сам вариант, иначе товар спецификации */
  productId?: string | null;
  components: PlannedComponent[];
}

/** Выпуск по заказу на производство: одна позиция заказа — одна продукция выпуска */
export async function createProductionFromOrder(db: Db, ctx: DocCtx, orderId: string, input: ProductionInput): Promise<string> {
  const [order] = await db.select().from(documents).where(eq(documents.id, orderId)).limit(1);
  if (!order) throw new DomainError(404, 'not_found', 'document not found');
  if (order.type !== 'production_order') throw new DomainError(422, 'invalid_type', 'This is not a production order');
  if (order.status !== 'posted') throw new DomainError(422, 'base_not_posted', 'Post the production order first');
  const [header] = await db.select().from(productionHeaders).where(eq(productionHeaders.documentId, orderId)).limit(1);
  const plans = await orderPlans(db, ctx, orderId, input.lines.map(l => ({ orderItemId: l.orderItemId ?? '', qty: l.qty, stageId: l.stageId ?? null })));
  return createProductionDocuments(db, ctx, {
    date: input.date ?? order.date,
    workCenterId: input.workCenterId ?? header?.workCenterId ?? null,
    warehouseId: input.warehouseId ?? null,
    targetWarehouseId: input.targetWarehouseId ?? null,
    fallbackWarehouseId: order.warehouseId,
    fallbackTargetWarehouseId: order.targetWarehouseId,
    operation: operationOfDoc(order),
    basedOnId: orderId,
    processingOrderId: header?.processingOrderId ?? null,
    plans,
  });
}

/** Планы выпуска по позициям заказа на производство: состав — снимок заказа (пропорционально количеству) или развёртка спецификации.
    Без количества — весь остаток к выпуску на выбранном этапе */
async function orderPlans(db: Db, ctx: DocCtx, orderId: string, requested: { orderItemId: string; qty?: string; stageId?: string | null }[]): Promise<ProductionPlan[]> {
  const [order] = await db.select().from(documents).where(eq(documents.id, orderId)).limit(1);
  if (!order) throw new DomainError(404, 'not_found', 'document not found');
  if (order.type !== 'production_order') throw new DomainError(422, 'invalid_type', 'This is not a production order');
  if (order.status !== 'posted') throw new DomainError(422, 'base_not_posted', 'Post the production order first');
  const orderItems = await db.select().from(productionItems).where(eq(productionItems.documentId, orderId)).orderBy(asc(productionItems.sortOrder));
  const byId = new Map(orderItems.map(i => [i.id, i]));
  const snapshot = await db.select().from(productionComponents).where(eq(productionComponents.documentId, orderId)).orderBy(asc(productionComponents.sortOrder));
  const totals = await stageTotals(db, orderItems.map(i => ({ sourceItemId: i.id, customerOrderLineId: null })));
  const plans: ProductionPlan[] = [];
  for (const l of requested) {
    const src = l.orderItemId ? byId.get(l.orderItemId) : undefined;
    if (!src) throw new DomainError(422, 'invalid_reference', 'The position does not belong to this production order');
    const source: StageSource = { sourceItemId: src.id, customerOrderLineId: null };
    const stage = await resolveStage(db, src.itemId, l.stageId ?? null);
    const stagePlan = await itemStagePlan(db, src.itemId);
    const limit = await stageLimit(db, { itemId: src.itemId, stage, ordered: dec(src.qty), source, totals });
    const left = limit.cap - limit.done;
    const qty = l.qty ? dec(l.qty) : left;
    if (qty <= 0n) continue;
    if (qty > left) throw stageError(limit, stage, left, dec(src.qty));
    // состав: снимок заказа (пропорционально количеству) или развёртка спецификации
    const scale = div(qty, dec(src.qty));
    const own = snapshot.filter(c => c.itemId === src.id);
    const components: PlannedComponent[] = own.length
      ? own.filter(c => componentStage(c, stagePlan.stages) === stage.id).map(c => ({
          kind: c.kind,
          ownerKind: c.ownerKind,
          productId: c.kind === 'work' ? null : c.productId,
          itemId: null,
          workCenterId: c.workCenterId,
          operation: c.operation,
          operationId: c.kind === 'work' ? c.productId : null,
          qty: c.kind === 'work' ? c.qty : fmt(mul(dec(c.qty), scale), 3),
          // часы работы тоже пропорциональны количеству
          hours: c.kind === 'work' ? fmt(mul(dec(c.hours), scale), 3) : c.hours,
          rate: c.rate,
          fixedCost: c.fixedCost,
          plannedCost: fmt(mul(dec(c.plannedCost), scale)),
          stageId: c.stageId ?? null,
          sourceComponentId: c.id,
          costShare: c.costShare ?? null,
        }))
      : (await planComponents(db, ctx.workspaceId, src.itemId, fmt(qty, 3), src.params)).filter(c => componentStage(c, stagePlan.stages) === stage.id);
    plans.push({ itemId: src.itemId, qty: fmt(qty, 3), sourceItemId: src.id, customerOrderLineId: src.customerOrderLineId, stageId: stage.id, components, productId: src.productVariantId ?? null });
  }
  return plans;
}

/** Ошибка превышения: этап ограничен предыдущим или заказом */
function stageError(limit: StageLimit, stage: StageDef, left: bigint, ordered: bigint): DomainError {
  if (limit.byStage)
    return new DomainError(422, 'stage_order', `The stage “${stage.name}” waits for the previous one: only ${fmt(left, 3)} of ${fmt(limit.cap, 3)} are ready`);
  return new DomainError(422, 'over_fulfilment', `Only ${fmt(left, 3)} of ${fmt(ordered, 3)} is left to produce`);
}

/** Выпуск прямо из заказа покупателя: товар с способом пополнения «производство» */
export async function createProductionFromCustomerOrder(db: Db, ctx: DocCtx, input: ProductionInput & { customerOrderId: string }): Promise<string> {
  const [order] = await db.select().from(documents).where(eq(documents.id, input.customerOrderId)).limit(1);
  if (!order) throw new DomainError(404, 'not_found', 'document not found');
  if (order.type !== 'customer_order') throw new DomainError(422, 'invalid_type', 'This is not a customer order');
  if (order.status !== 'posted') throw new DomainError(422, 'base_not_posted', 'Post the customer order first');
  // строки по умолчанию — все производимые строки заказа, по остатку
  const wanted = input.lines.length ? input.lines : await producibleLines(db, ctx, order.id);
  const plans = await customerPlans(db, ctx, order.id, wanted.map(l => ({ customerOrderLineId: l.customerOrderLineId ?? '', qty: l.qty, stageId: l.stageId ?? null })));
  if (!plans.length) throw new DomainError(422, 'nothing_to_create', 'Everything from this customer order is already produced');
  return createProductionDocuments(db, ctx, {
    date: input.date ?? order.date,
    workCenterId: input.workCenterId ?? null,
    warehouseId: input.warehouseId ?? null,
    targetWarehouseId: input.targetWarehouseId ?? null,
    fallbackWarehouseId: order.warehouseId,
    basedOnId: order.id,
    plans,
  });
}

/** Планы выпуска по строкам заказа покупателя: производится товар со способом пополнения «производство» */
async function customerPlans(db: Db, ctx: DocCtx, customerOrderId: string, requested: { customerOrderLineId: string; qty?: string; stageId?: string | null }[]): Promise<ProductionPlan[]> {
  const [order] = await db.select().from(documents).where(eq(documents.id, customerOrderId)).limit(1);
  if (!order) throw new DomainError(404, 'not_found', 'document not found');
  if (order.type !== 'customer_order') throw new DomainError(422, 'invalid_type', 'This is not a customer order');
  if (order.status !== 'posted') throw new DomainError(422, 'base_not_posted', 'Post the customer order first');
  const lines = await db.select().from(documentLines).where(eq(documentLines.documentId, order.id));
  const byId = new Map(lines.map(l => [l.id, l]));
  const shipped = await shippedQty(db, ctx.workspaceId, lines.map(l => l.id));
  const totals = await stageTotals(db, lines.map(l => ({ sourceItemId: null, customerOrderLineId: l.id })));
  const settings = await db.select().from(productManufacturing);
  const byProduct = new Map(settings.map(s => [s.productId, s]));
  const plans: ProductionPlan[] = [];
  for (const l of requested) {
    const src = l.customerOrderLineId ? byId.get(l.customerOrderLineId) : undefined;
    if (!src) throw new DomainError(422, 'invalid_reference', 'The line does not belong to this customer order');
    // спецификация товара: своя (варианта) или по умолчанию родителя
    const choice = await resolveSpecForProduct(db, ctx.workspaceId, src.productId);
    const setting = choice ? byProduct.get(choice.rootProductId) : undefined;
    if (!choice || !setting || setting.replenishment !== 'production') throw new DomainError(422, 'not_produced', `“${src.name}” is not produced: set the way it is replenished and the default specification`);
    const specId = choice.itemId;
    const source: StageSource = { sourceItemId: null, customerOrderLineId: src.id };
    const stage = await resolveStage(db, specId, l.stageId ?? null);
    const stagePlan = await itemStagePlan(db, specId);
    const ordered = dec(src.qty) - (shipped.get(src.id) ?? 0n);
    const limit = await stageLimit(db, { itemId: specId, stage, ordered, source, totals });
    const left = limit.cap - limit.done;
    const qty = l.qty ? dec(l.qty) : left;
    if (qty <= 0n) continue;
    if (qty > left) throw stageError(limit, stage, left, ordered);
    // значения параметров строки заказа: по ним считаются формулы состава
    const components = (await planComponents(db, ctx.workspaceId, specId, fmt(qty, 3), src.params)).filter(c => componentStage(c, stagePlan.stages) === stage.id);
    // выпускается вариант товара, если строка заказа ссылается на вариант
    const variant = (await isVariant(db, src.productId)) ? src.productId : null;
    plans.push({ itemId: specId, qty: fmt(qty, 3), sourceItemId: null, customerOrderLineId: src.id, stageId: stage.id, components, productId: variant });
  }
  return plans;
}

/** Строки заказа покупателя, которые производятся: товар с пополнением «производство» и остаток к выпуску */
async function producibleLines(db: Db, ctx: DocCtx, customerOrderId: string): Promise<{ customerOrderLineId: string; qty: string; stageId: string | null }[]> {
  const lines = await db.select().from(documentLines).where(eq(documentLines.documentId, customerOrderId));
  const settings = await db.select().from(productManufacturing);
  const byProduct = new Map(settings.map(s => [s.productId, s]));
  const produced = await producedByCustomerLine(db, ctx.workspaceId, lines.map(l => l.id));
  const shipped = await shippedQty(db, ctx.workspaceId, lines.map(l => l.id));
  const out: { customerOrderLineId: string; qty: string; stageId: string | null }[] = [];
  for (const l of lines) {
    const choice = await resolveSpecForProduct(db, ctx.workspaceId, l.productId);
    const s = choice ? byProduct.get(choice.rootProductId) : undefined;
    if (!s || s.replenishment !== 'production') continue;
    const left = dec(l.qty) - (shipped.get(l.id) ?? 0n) - (produced.get(l.id) ?? 0n);
    if (left <= 0n) continue;
    out.push({ customerOrderLineId: l.id, qty: fmt(left, 3), stageId: null });
  }
  return out;
}

/** Заказ на производство по заказу покупателя: позиции — производимые строки заказа */
export async function createProductionOrderFromCustomerOrder(
  db: Db,
  ctx: DocCtx,
  input: { customerOrderId: string; date?: string; workCenterId?: string | null; warehouseId?: string | null; targetWarehouseId?: string | null },
): Promise<string> {
  const [order] = await db.select().from(documents).where(eq(documents.id, input.customerOrderId)).limit(1);
  if (!order) throw new DomainError(404, 'not_found', 'document not found');
  if (order.type !== 'customer_order') throw new DomainError(422, 'invalid_type', 'This is not a customer order');
  if (order.status !== 'posted') throw new DomainError(422, 'base_not_posted', 'Post the customer order first');
  const lines = await producibleLines(db, ctx, input.customerOrderId);
  if (!lines.length) throw new DomainError(422, 'nothing_to_create', 'None of the products of this customer order is produced: set the way it is replenished and the default specification');
  const docLines = await db.select().from(documentLines).where(eq(documentLines.documentId, input.customerOrderId));
  const byLine = new Map(docLines.map(l => [l.id, l]));
  const items: { itemId: string; qty: string; customerOrderLineId: string; params: Record<string, unknown> }[] = [];
  for (const l of lines) {
    const src = byLine.get(l.customerOrderLineId);
    if (!src) continue;
    const choice = await resolveSpecForProduct(db, ctx.workspaceId, src.productId);
    if (!choice) continue;
    items.push({ itemId: choice.itemId, qty: l.qty, customerOrderLineId: l.customerOrderLineId, params: src.params ?? {} });
  }
  return createProductionOrder(db, ctx, {
    workCenterId: input.workCenterId,
    warehouseId: input.warehouseId ?? order.warehouseId,
    targetWarehouseId: input.targetWarehouseId,
    date: input.date,
    comment: `Production for customer order ${order.number ?? ''}`.trim(),
    items,
  });
}

/** Создание (или дополнение) документа выпуска: строки продукции, материалов и работы */
async function writeProduction(
  db: Db,
  ctx: DocCtx,
  input: {
    date?: string;
    workCenterId?: string | null;
    warehouseId?: string | null;
    targetWarehouseId?: string | null;
    /** Склад заказа — запасной вариант, если участок своих складов не задал */
    fallbackWarehouseId?: string | null;
    fallbackTargetWarehouseId?: string | null;
    /** Этап выпуска; пусто — «Завершение производства» */
    stageId: string | null;
    /** Вид операции: сборка (по умолчанию) или разборка */
    operation?: ProductionOperation;
    basedOnId: string | null;
    /** Заказ на переработку: выпуск из давальческого сырья */
    processingOrderId?: string | null;
    plans: ProductionPlan[];
  },
): Promise<string> {
  if (!input.plans.length) throw new DomainError(422, 'no_items', 'Add products to produce');
  const { warehouseId, targetWarehouseId } = await resolveWarehouses(db, input.workCenterId, input.warehouseId, input.targetWarehouseId, input.fallbackWarehouseId, input.fallbackTargetWarehouseId);
  const isFinal = await isFinalStage(db, input.stageId);
  const disassembly = input.operation === 'disassembly';
  const rows = await buildProductionRows(db, input.plans, isFinal, disassembly);
  const docId = await createDocument(db, ctx, {
    type: 'production',
    organizationId: null,
    warehouseId,
    targetWarehouseId,
    // вид операции: выпуск из давальческого сырья — «переработка», иначе сборка или разборка
    operation: input.processingOrderId ? 'processing' : (input.operation ?? 'assembly'),
    date: input.date,
    lines: rows.docLines.map(l => ({ id: l.id, productId: l.productId, name: l.name, unitCode: l.unitCode, qty: l.qty, price: '0', discountPct: '0', vatRate: 'none' as const, stockRole: l.stockRole })),
  });
  await db.insert(productionHeaders).values({ workspaceId: ctx.workspaceId, documentId: docId, workCenterId: input.workCenterId ?? null, plannedStart: null, plannedEnd: null, parentDocumentId: null, stageId: input.stageId, processingOrderId: input.processingOrderId ?? null });
  const itemRows = await db.insert(productionItems).values(
    rows.itemLines.map((l, n) => ({ workspaceId: ctx.workspaceId, documentId: docId, itemId: l.itemId, qty: l.qty, unitCode: l.unitCode, customerOrderLineId: l.customerOrderLineId, sourceItemId: l.sourceItemId, stageId: input.stageId, documentLineId: l.documentLineId, productVariantId: l.variantId, sortOrder: n })),
  ).returning();
  // связь состава с позицией: строки плана и позиции идут в одном порядке
  const itemIdByLine = new Map(rows.itemLines.map((l, n) => [l.id, itemRows[n].id]));
  if (rows.componentLines.length) await db.insert(productionComponents).values(
    rows.componentLines.map((c, n) => ({ workspaceId: ctx.workspaceId, documentId: docId, itemId: itemIdByLine.get(c.itemId) ?? null, kind: c.kind, ownerKind: c.ownerKind, productId: c.productId, workCenterId: c.workCenterId, operation: c.operation, qty: c.qty, hours: c.hours, rate: c.rate, fixedCost: c.fixedCost, plannedCost: c.plannedCost, documentLineId: c.documentLineId, sourceComponentId: c.sourceComponentId ?? null, stageId: c.stageId ?? input.stageId, costShare: c.costShare ?? null, sortOrder: n })),
  );
  if (input.basedOnId) await db.update(documents).set({ basedOnId: input.basedOnId }).where(eq(documents.id, docId));
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'document.created', entity: 'document', recordId: docId, actorId: ctx.memberId, payload: { documentType: 'production' } });
  return docId;
}

/** Строки выпуска: продукция (приход), материалы (расход) и работы */
/** Финальный этап: продукция приходуется только им */
async function isFinalStage(db: Db, stageId: string | null): Promise<boolean> {
  if (!stageId) return true;
  const [row] = await db.select({ isFinal: productionStages.isFinal }).from(productionStages).where(eq(productionStages.id, stageId)).limit(1);
  return row?.isFinal ?? true;
}

async function buildProductionRows(
  db: Db,
  plans: ProductionPlan[],
  isFinal: boolean,
  disassembly: boolean,
): Promise<{
  warehouseId: string | null;
  targetWarehouseId: string | null;
  docLines: { id: string; productId: string; name: string; unitCode: string; qty: string; stockRole: 'in' | 'out' }[];
  itemLines: { id: string; documentLineId: string | null; itemId: string; qty: string; sourceItemId: string | null; customerOrderLineId: string | null; productId: string; name: string; unitCode: string; variantId: string | null }[];
  componentLines: { id: string; itemId: string; kind: 'material' | 'semi' | 'work' | 'expense' | 'output'; ownerKind: MaterialOwner; productId: string | null; workCenterId: string | null; operation: string; qty: string; hours: string; rate: string | null; fixedCost: string | null; plannedCost: string; documentLineId: string | null; stageId: string | null; sourceComponentId?: string | null; costShare?: string | null }[];
}> {
  const itemIds = [...new Set(plans.map(p => p.itemId))];
  const products_ = await db.select().from(manufacturedItems).where(inArray(manufacturedItems.id, itemIds));
  const byItem = new Map(products_.map(i => [i.id, i]));
  for (const p of plans) {
    const it = byItem.get(p.itemId);
    if (!it) throw new DomainError(422, 'invalid_reference', 'The product does not exist');
    if (!it.productId) throw new DomainError(422, 'item_not_stockable', `“${it.name}” has no product of the catalogue: it cannot be produced to stock`);
  }
  const docLines: { id: string; productId: string; name: string; unitCode: string; qty: string; stockRole: 'in' | 'out' }[] = [];
  const itemLines: { id: string; documentLineId: string | null; itemId: string; qty: string; sourceItemId: string | null; customerOrderLineId: string | null; productId: string; name: string; unitCode: string; variantId: string | null }[] = [];
  const componentLines: { id: string; itemId: string; kind: 'material' | 'semi' | 'work' | 'expense' | 'output'; ownerKind: MaterialOwner; productId: string | null; workCenterId: string | null; operation: string; qty: string; hours: string; rate: string | null; fixedCost: string | null; plannedCost: string; documentLineId: string | null; stageId: string | null; sourceComponentId?: string | null; costShare?: string | null }[] = [];
  for (const p of plans) {
    const it = byItem.get(p.itemId)!;
    const lineId = uuidv7();
    // разборка: исходный товар (что разбирают) списывается со склада, выходные продукты приходуются
    if (disassembly) {
      for (const c of p.components) {
        if (c.kind === 'work') {
          componentLines.push({ id: uuidv7(), itemId: lineId, kind: 'work', ownerKind: 'own', productId: c.operationId, workCenterId: c.workCenterId, operation: c.operation, qty: '0', hours: c.hours, rate: c.rate, fixedCost: c.fixedCost, plannedCost: c.plannedCost, documentLineId: null, stageId: c.stageId, sourceComponentId: c.sourceComponentId ?? null });
          continue;
        }
        const prod = await db.select({ name: products.name, unitCode: products.unitCode }).from(products).where(eq(products.id, c.productId!)).limit(1);
        const compLineId = uuidv7();
        docLines.push({ id: compLineId, productId: c.productId!, name: prod[0]?.name ?? '', unitCode: prod[0]?.unitCode ?? '796', qty: c.qty, stockRole: c.kind === 'output' ? 'in' : 'out' });
        componentLines.push({ id: uuidv7(), itemId: lineId, kind: c.kind, ownerKind: 'own', productId: c.productId, workCenterId: null, operation: '', qty: c.qty, hours: '0', rate: null, fixedCost: null, plannedCost: c.plannedCost, documentLineId: compLineId, stageId: c.stageId, sourceComponentId: c.sourceComponentId ?? null, costShare: c.costShare ?? null });
      }
      itemLines.push({ id: lineId, documentLineId: null, itemId: p.itemId, qty: p.qty, sourceItemId: p.sourceItemId, customerOrderLineId: p.customerOrderLineId, productId: it.productId!, name: it.name, unitCode: it.unitCode, variantId: null });
      continue;
    }
    // продукция приходуется только финальным этапом: на промежуточном строки продукции в документе нет
    // у варианта выпускается сам вариант, а не товар спецификации
    const outProductId = p.productId ?? it.productId!;
    const outName = p.productId ? (await db.select({ name: products.name }).from(products).where(eq(products.id, outProductId)).limit(1))[0]?.name ?? it.name : it.name;
    // выпускаемый товар — вариант (у него есть родитель): он и приходуется на склад
    const variantRow = p.productId ? (await db.select({ parentProductId: products.parentProductId }).from(products).where(eq(products.id, outProductId)).limit(1))[0] : undefined;
    const variantId = variantRow?.parentProductId ? outProductId : null;
    if (isFinal) docLines.push({ id: lineId, productId: outProductId, name: outName, unitCode: it.unitCode, qty: p.qty, stockRole: 'in' });
    itemLines.push({ id: lineId, documentLineId: isFinal ? lineId : null, itemId: p.itemId, qty: p.qty, sourceItemId: p.sourceItemId, customerOrderLineId: p.customerOrderLineId, productId: outProductId, name: outName, unitCode: it.unitCode, variantId });
    for (const c of p.components) {
      if (c.kind === 'work') {
        componentLines.push({ id: uuidv7(), itemId: lineId, kind: 'work', ownerKind: c.ownerKind, productId: c.operationId, workCenterId: c.workCenterId, operation: c.operation, qty: '0', hours: c.hours, rate: c.rate, fixedCost: c.fixedCost, plannedCost: c.plannedCost, documentLineId: null, stageId: c.stageId, sourceComponentId: c.sourceComponentId ?? null });
        continue;
      }
      // расход подрядчику: в себестоимость входит, со склада не списывается — строки документа у него нет
      if (c.kind === 'expense') {
        componentLines.push({ id: uuidv7(), itemId: lineId, kind: 'expense', ownerKind: c.ownerKind, productId: c.productId, workCenterId: null, operation: '', qty: c.qty, hours: '0', rate: null, fixedCost: null, plannedCost: c.plannedCost, documentLineId: null, stageId: c.stageId, sourceComponentId: c.sourceComponentId ?? null });
        continue;
      }
      const materialLineId = uuidv7();
      const prod = await db.select({ name: products.name, unitCode: products.unitCode }).from(products).where(eq(products.id, c.productId!)).limit(1);
      docLines.push({ id: materialLineId, productId: c.productId!, name: prod[0]?.name ?? '', unitCode: prod[0]?.unitCode ?? '796', qty: c.qty, stockRole: 'out' });
      componentLines.push({ id: uuidv7(), itemId: lineId, kind: c.kind, ownerKind: c.ownerKind, productId: c.productId, workCenterId: null, operation: '', qty: c.qty, hours: '0', rate: null, fixedCost: null, plannedCost: c.plannedCost, documentLineId: materialLineId, stageId: c.stageId, sourceComponentId: c.sourceComponentId ?? null });
    }
  }
  return { warehouseId: null, targetWarehouseId: null, docLines, itemLines, componentLines };
}

/** Склады выпуска: участок задаёт свои склады, потом запасной вариант (склад заказа), потом склад по умолчанию */
async function resolveWarehouses(db: Db, workCenterId: string | null | undefined, warehouseId: string | null | undefined, targetWarehouseId: string | null | undefined, fallbackFrom?: string | null, fallbackTo?: string | null): Promise<{ warehouseId: string | null; targetWarehouseId: string | null }> {
  let from = warehouseId ?? null;
  let to = targetWarehouseId ?? null;
  if (workCenterId) {
    const [wc] = await db.select().from(workCenters).where(eq(workCenters.id, workCenterId)).limit(1);
    if (!wc) throw new DomainError(422, 'invalid_reference', 'The work center does not exist');
    from = warehouseId ?? wc.warehouseId ?? fallbackFrom ?? null;
    to = targetWarehouseId ?? wc.outputWarehouseId ?? fallbackTo ?? null;
  } else {
    from = from ?? fallbackFrom ?? null;
    to = to ?? fallbackTo ?? null;
  }
  if (!to) {
    const [def] = await db.select({ id: warehouses.id }).from(warehouses).orderBy(sql`${warehouses.isDefault} desc`).limit(1);
    to = def?.id ?? null;
  }
  return { warehouseId: from, targetWarehouseId: to };
}

/** Документ выпуска за эту дату, участок, этап, вид операции и заказ на переработку: в него дописываются новые строки (как в 1С — один документ за день) */
async function findDayDocument(db: Db, _workspaceId: string, date: string, workCenterId: string | null, stageId: string | null, operation: ProductionOperation | 'processing', processingOrderId: string | null = null): Promise<string | null> {
  if (!workCenterId) return null;
  const [row] = await db
    .select({ id: documents.id })
    .from(documents)
    .innerJoin(productionHeaders, eq(productionHeaders.documentId, documents.id))
    .where(
      and(
        eq(documents.type, 'production'),
        eq(documents.date, date),
        eq(productionHeaders.workCenterId, workCenterId),
        stageId ? eq(productionHeaders.stageId, stageId) : isNull(productionHeaders.stageId),
        // старые выпуски без вида операции — сборка
        sql`coalesce(${documents.operation}, 'assembly') = ${operation}`,
        // выпуски из давальческого сырья в общий документ дня не попадают
        processingOrderId ? eq(productionHeaders.processingOrderId, processingOrderId) : isNull(productionHeaders.processingOrderId),
        ne(documents.status, 'cancelled'),
      ),
    )
    .orderBy(asc(documents.createdAt))
    .limit(1);
  return row?.id ?? null;
}

/** Дополнение существующего документа выпуска: снимаем проведение, добавляем строки и проводим заново */
async function appendProduction(
  db: Db,
  ctx: DocCtx,
  docId: string,
  input: { date?: string; workCenterId?: string | null; warehouseId?: string | null; targetWarehouseId?: string | null; stageId: string | null; operation?: ProductionOperation; processingOrderId?: string | null; plans: ProductionPlan[] },
): Promise<void> {
  const [doc] = await db.select().from(documents).where(eq(documents.id, docId)).limit(1).for('update');
  if (!doc) throw new DomainError(404, 'not_found', 'document not found');
  const wasPosted = doc.status === 'posted';
  // прежние позиции документа не меняются, поэтому запрет отмены промежуточного этапа здесь не нужен
  if (wasPosted) await unpostDocument(db, ctx, docId, { repost: true });
  const rows = await buildProductionRows(db, input.plans, await isFinalStage(db, input.stageId), input.operation === 'disassembly');
  const [last] = await db.select({ m: sql<number>`coalesce(max(${documentLines.sortOrder}), -1)` }).from(documentLines).where(eq(documentLines.documentId, docId));
  const sortOrder = Number(last?.m ?? -1) + 1;
  if (rows.docLines.length) await db.insert(documentLines).values(
    rows.docLines.map((l, n) => ({
      id: l.id,
      workspaceId: ctx.workspaceId,
      documentId: docId,
      sortOrder: sortOrder + n,
      productId: l.productId,
      name: l.name,
      unitCode: l.unitCode,
      qty: l.qty,
      price: '0',
      discountPct: '0',
      vatRate: 'none',
      net: '0',
      vatAmount: '0',
      total: '0',
      stockRole: l.stockRole,
    })),
  );
  const [lastItem] = await db.select({ m: sql<number>`coalesce(max(${productionItems.sortOrder}), -1)` }).from(productionItems).where(eq(productionItems.documentId, docId));
  const itemRows = await db
    .insert(productionItems)
    .values(rows.itemLines.map((l, n) => ({ workspaceId: ctx.workspaceId, documentId: docId, itemId: l.itemId, qty: l.qty, unitCode: l.unitCode, customerOrderLineId: l.customerOrderLineId, sourceItemId: l.sourceItemId, stageId: input.stageId, documentLineId: l.documentLineId, productVariantId: l.variantId, sortOrder: Number(lastItem?.m ?? -1) + 1 + n })))
    .returning();
  // связь состава с позицией: строки плана и позиции идут в одном порядке
  const itemIdByLine = new Map(rows.itemLines.map((l, n) => [l.id, itemRows[n].id]));
  if (rows.componentLines.length) await db.insert(productionComponents).values(
    rows.componentLines.map((c, n) => ({ workspaceId: ctx.workspaceId, documentId: docId, itemId: itemIdByLine.get(c.itemId) ?? null, kind: c.kind, ownerKind: c.ownerKind, productId: c.productId, workCenterId: c.workCenterId, operation: c.operation, qty: c.qty, hours: c.hours, rate: c.rate, fixedCost: c.fixedCost, plannedCost: c.plannedCost, documentLineId: c.documentLineId, sourceComponentId: c.sourceComponentId ?? null, stageId: c.stageId ?? input.stageId, costShare: c.costShare ?? null, sortOrder: n })),
  );
  if (wasPosted) await postDocument(db, ctx, docId);
}

/** Выпуск за дату, участок и этап: дописывается в существующий документ дня или создаётся новый */
async function createOrAppendProduction(
  db: Db,
  ctx: DocCtx,
  input: { date?: string; workCenterId?: string | null; warehouseId?: string | null; targetWarehouseId?: string | null; fallbackWarehouseId?: string | null; fallbackTargetWarehouseId?: string | null; stageId: string | null; operation?: ProductionOperation; basedOnId: string | null; processingOrderId?: string | null; plans: ProductionPlan[] },
): Promise<string> {
  const date = input.date ?? new Date().toISOString().slice(0, 10);
  const operation = input.operation ?? 'assembly';
  const existing = await findDayDocument(db, ctx.workspaceId, date, input.workCenterId ?? null, input.stageId, input.processingOrderId ? 'processing' : operation, input.processingOrderId ?? null);
  if (existing) {
    await appendProduction(db, ctx, existing, { ...input, date });
    return existing;
  }
  return writeProduction(db, ctx, { ...input, date });
}

/** Выпуск: планы разных этапов идут в разные документы (на участок, дату и этап — один документ) */
async function createProductionDocuments(
  db: Db,
  ctx: DocCtx,
  input: { date?: string; workCenterId?: string | null; warehouseId?: string | null; targetWarehouseId?: string | null; fallbackWarehouseId?: string | null; fallbackTargetWarehouseId?: string | null; operation?: ProductionOperation; basedOnId: string | null; processingOrderId?: string | null; plans: ProductionPlan[] },
): Promise<string> {
  if (!input.plans.length) throw new DomainError(422, 'no_items', 'Add products to produce');
  const groups = new Map<string, ProductionPlan[]>();
  for (const p of input.plans) groups.set(stageKey(p.stageId), [...(groups.get(stageKey(p.stageId)) ?? []), p]);
  const ids: string[] = [];
  for (const [, plans] of groups) ids.push(await createOrAppendProduction(db, ctx, { ...input, stageId: plans[0].stageId, plans }));
  return ids[0];
}

/* ---------------- рабочее место «Выпуск продукции» ---------------- */

/** Строка рабочего места: что и сколько осталось выпустить */
export interface WorkbenchRow {
  /** Строка заказа: позиция заказа на производство или строка заказа покупателя */
  id: string;
  /** Источник строки */
  source: 'customer_order' | 'production_order';
  /** Заказ, которому строка принадлежит */
  orderId: string;
  /** Товар каталога */
  productId: string;
  /** Название товара */
  productName: string;
  /** Продукция (спецификация), которую выпускаем */
  itemId: string;
  /** Название продукции */
  itemName: string;
  unitCode: string;
  /** Заказано */
  qty: string;
  /** Уже выпущено */
  produced: string;
  /** Отгружено покупателю (у заказа покупателя) */
  shipped: string;
  /** Осталось к выпуску */
  remaining: string;
  /** Этап выпуска по умолчанию (финальный): у изделия без вида производства — «Завершение производства» */
  stage: string;
  /** Вид производства изделия */
  productionKindId: string | null;
  productionKindName: string | null;
  /** Этапы выпуска изделия: у каждого сколько выполнено и сколько осталось */
  stages: WorkbenchStage[];
}

/** Этап выпуска в рабочем месте */
export interface WorkbenchStage {
  /** Этап; пусто — предопределённый «Завершение производства» */
  id: string | null;
  name: string;
  sortOrder: number;
  /** Финальный этап: продукция приходуется только им */
  isFinal: boolean;
  /** Выполнено на этапе */
  done: string;
  /** Осталось на этапе */
  remaining: string;
  /** Сколько можно выполнить сейчас: предыдущий этап ограничивает */
  available: string;
}

/** Заказ рабочего места с его строками */
export interface WorkbenchOrder {
  id: string;
  type: 'customer_order' | 'production_order';
  number: string | null;
  date: string;
  state: string | null;
  comment: string;
  counterparty: { id: string; name: string } | null;
  /** Плановый срок: у заказа покупателя — срок, у заказа на производство — плановый финиш */
  dueDate: string | null;
  /** Участок-изготовитель (у заказа на производство) */
  workCenterId: string | null;
  workCenterName: string | null;
  rows: WorkbenchRow[];
}

export interface WorkbenchFilters {
  customerOrderId?: string;
  productionOrderId?: string;
  counterpartyId?: string;
  productId?: string;
  state?: string;
  from?: string;
  to?: string;
  q?: string;
  /** Вид производства */
  productionKindId?: string;
  /** Только продукция с этапами */
  staged?: boolean;
  limit: number;
  offset: number;
}

/** Заказы рабочего места: заказы покупателей и заказы на производство с остатком к выпуску */
export async function listWorkbench(db: Db, workspaceId: string, filters: WorkbenchFilters) {
  const centers = await db.select({ id: workCenters.id, name: workCenters.name }).from(workCenters).where(isNull(workCenters.archivedAt));
  const byCenter = new Map(centers.map(c => [c.id, c.name]));
  const items = await db.select().from(manufacturedItems);
  const byItem = new Map(items.map(i => [i.id, i]));
  // производимые товары: пополнение «производство» со спецификацией по умолчанию
  const settings = await db.select().from(productManufacturing).where(eq(productManufacturing.replenishment, 'production'));
  const producible = new Map(settings.filter(s => s.defaultItemId).map(s => [s.productId, s.defaultItemId!]));
  const orders: WorkbenchOrder[] = [];

  /* --- заказы покупателей --- */
  const customerDocs = await db.select().from(documents).where(and(eq(documents.type, 'customer_order'), eq(documents.status, 'posted')));
  const customerIds = customerDocs.map(d => d.id);
  const customerLines = customerIds.length ? await db.select().from(documentLines).where(inArray(documentLines.documentId, customerIds)) : [];
  const producedByLine = await producedByCustomerLine(db, workspaceId, customerLines.map(l => l.id));
  const shippedByLine = await shippedQty(db, workspaceId, customerLines.map(l => l.id));
  const coveredByLine = await coveredByOrders(db, workspaceId, customerLines.map(l => l.id));
  const counterparties = new Map((await db.select({ id: companies.id, name: companies.name }).from(companies)).map(c => [c.id, c.name]));
  for (const doc of customerDocs) {
    if (filters.customerOrderId && doc.id !== filters.customerOrderId) continue;
    if (filters.counterpartyId && doc.counterpartyId !== filters.counterpartyId) continue;
    if (filters.productionOrderId) continue;
    if (filters.state) continue; // состояние — только у заказа на производство
    if (filters.q && !`${doc.number ?? ''} ${doc.comment}`.toLowerCase().includes(filters.q.toLowerCase())) continue;
    if (filters.from && !(doc.dueDate && doc.dueDate >= filters.from)) continue;
    if (filters.to && !(doc.dueDate && doc.dueDate <= filters.to)) continue;
    const rows: WorkbenchRow[] = [];
    for (const line of customerLines.filter(l => l.documentId === doc.id)) {
      const itemId = producible.get(line.productId);
      if (!itemId) continue;
      const item = byItem.get(itemId);
      if (!item?.productId) continue; // изделие без товара каталога на склад не приходуется
      const produced = producedByLine.get(line.id) ?? 0n;
      const shipped = shippedByLine.get(line.id) ?? 0n;
      const covered = coveredByLine.get(line.id) ?? 0n;
      const left = dec(line.qty) - produced - shipped - covered;
      if (left <= 0n) continue;
      if (filters.productId && line.productId !== filters.productId) continue;
      if (!matchKind(filters, item)) continue;
      rows.push({
        id: line.id,
        source: 'customer_order',
        orderId: doc.id,
        productId: line.productId,
        productName: line.name,
        itemId,
        itemName: item.name,
        unitCode: line.unitCode,
        qty: fmt(dec(line.qty), 3),
        produced: fmt(produced, 3),
        shipped: fmt(shipped, 3),
        remaining: fmt(left, 3),
        stage: 'final',
        productionKindId: null,
        productionKindName: null,
        stages: [],
      });
    }
    if (!rows.length) continue;
    orders.push({
      id: doc.id,
      type: 'customer_order',
      number: doc.number,
      date: doc.date,
      state: null,
      comment: doc.comment,
      counterparty: doc.counterpartyId ? { id: doc.counterpartyId, name: counterparties.get(doc.counterpartyId) ?? '' } : null,
      dueDate: doc.dueDate,
      workCenterId: null,
      workCenterName: null,
      rows,
    });
  }

  /* --- заказы на производство --- */
  const orderDocs = await db.select().from(documents).where(and(eq(documents.type, 'production_order'), eq(documents.status, 'posted')));
  const orderIds = orderDocs.map(d => d.id);
  const headers = orderIds.length ? await db.select().from(productionHeaders).where(inArray(productionHeaders.documentId, orderIds)) : [];
  const byHeader = new Map(headers.map(h => [h.documentId, h]));
  const orderItems = orderIds.length ? await db.select().from(productionItems).where(inArray(productionItems.documentId, orderIds)) : [];
  const producedByItem = await producedQty(db, workspaceId, orderItems.map(i => i.id));
  for (const doc of orderDocs) {
    if (filters.customerOrderId) continue;
    if (filters.productionOrderId && doc.id !== filters.productionOrderId) continue;
    if (filters.counterpartyId) continue;
    if (filters.state ? doc.state !== filters.state : doc.state === 'done' || doc.state === 'closed') continue;
    if (filters.q && !`${doc.number ?? ''} ${doc.comment}`.toLowerCase().includes(filters.q.toLowerCase())) continue;
    const header = byHeader.get(doc.id);
    const plannedEnd = header?.plannedEnd ? new Date(header.plannedEnd).toISOString().slice(0, 10) : null;
    if (filters.from && !(plannedEnd && plannedEnd >= filters.from)) continue;
    if (filters.to && !(plannedEnd && plannedEnd <= filters.to)) continue;
    const rows: WorkbenchRow[] = [];
    for (const item of orderItems.filter(i => i.documentId === doc.id)) {
      const made = byItem.get(item.itemId);
      if (!made?.productId) continue;
      const produced = producedByItem.get(item.id) ?? 0n;
      const left = dec(item.qty) - produced;
      if (left <= 0n) continue;
      if (filters.productId && made.productId !== filters.productId) continue;
      if (!matchKind(filters, made)) continue;
      rows.push({
        id: item.id,
        source: 'production_order',
        orderId: doc.id,
        productId: made.productId,
        productName: made.name,
        itemId: made.id,
        itemName: made.name,
        unitCode: item.unitCode,
        qty: fmt(dec(item.qty), 3),
        produced: fmt(produced, 3),
        shipped: '0.000',
        remaining: fmt(left, 3),
        stage: 'final',
        productionKindId: null,
        productionKindName: null,
        stages: [],
      });
    }
    if (!rows.length) continue;
    orders.push({
      id: doc.id,
      type: 'production_order',
      number: doc.number,
      date: doc.date,
      state: doc.state,
      comment: doc.comment,
      counterparty: null,
      dueDate: plannedEnd,
      workCenterId: header?.workCenterId ?? null,
      workCenterName: header?.workCenterId ? (byCenter.get(header.workCenterId) ?? null) : null,
      rows,
    });
  }

  // этапы выпуска: по каждой строке — сколько выполнено на этапе и сколько осталось
  const kinds = await listProductionKinds(db, workspaceId);
  const stagesByKind = new Map(kinds.map(k => [k.id, k.stages]));
  const kindName = new Map(kinds.map(k => [k.id, k.name]));
  const sources: StageSource[] = [];
  for (const o of orders)
    for (const r of o.rows) sources.push(r.source === 'customer_order' ? { sourceItemId: null, customerOrderLineId: r.id } : { sourceItemId: r.id, customerOrderLineId: null });
  const totals = await stageTotals(db, sources);
  for (const o of orders) {
    for (const r of o.rows) {
      const item = byItem.get(r.itemId);
      const kindId = item?.productionKindId ?? null;
      const stages = kindId ? (stagesByKind.get(kindId) ?? []) : [FINAL_STAGE];
      const source: StageSource = r.source === 'customer_order' ? { sourceItemId: null, customerOrderLineId: r.id } : { sourceItemId: r.id, customerOrderLineId: null };
      // сколько изделий планируется выпустить: остаток плюс уже выпущенное
      const planned = dec(r.remaining) + dec(r.produced);
      r.productionKindId = kindId;
      r.productionKindName = kindId ? (kindName.get(kindId) ?? null) : null;
      r.stage = stageKey(stages[stages.length - 1]?.id ?? null);
      r.stages = stages.map((st, i) => {
        const done = totals.get(`${sourceKey(source)}|${stageKey(st.id)}`)?.qty ?? 0n;
        const prev = i > 0 ? stages[i - 1] : null;
        const prevDone = prev ? (totals.get(`${sourceKey(source)}|${stageKey(prev.id)}`)?.qty ?? 0n) : null;
        const cap = prevDone !== null && prevDone < planned ? prevDone : planned;
        return {
          id: st.id,
          name: st.name,
          sortOrder: st.sortOrder,
          isFinal: st.isFinal,
          done: fmt(done, 3),
          remaining: fmt(planned > done ? planned - done : 0n, 3),
          available: fmt(cap > done ? cap - done : 0n, 3),
        };
      });
    }
  }

  orders.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id < b.id ? 1 : -1));
  const total = orders.length;
  const page = orders.slice(filters.offset, filters.offset + filters.limit);
  return { orders: page, total, workCenters: centers };
}

/** Отбор по виду производства: вид изделия и «только продукция с этапами» */
function matchKind(filters: WorkbenchFilters, item: { productionKindId: string | null }): boolean {
  if (filters.productionKindId && item.productionKindId !== filters.productionKindId) return false;
  if (filters.staged && !item.productionKindId) return false;
  return true;
}

/** Сколько закрыто открытыми заказами на производство: строка заказа покупателя не показывается дважды */
async function coveredByOrders(db: Db, _workspaceId: string, customerLineIds: string[]): Promise<Map<string, bigint>> {
  if (!customerLineIds.length) return new Map();
  const rows = await db
    .select({ line: productionItems.customerOrderLineId, qty: sql<string>`sum(${productionItems.qty})` })
    .from(productionItems)
    .innerJoin(documents, eq(documents.id, productionItems.documentId))
    .where(and(inArray(productionItems.customerOrderLineId, customerLineIds), eq(documents.type, 'production_order'), eq(documents.status, 'posted'), notInArray(documents.state, ['done', 'closed'])))
    .groupBy(productionItems.customerOrderLineId);
  return new Map(rows.map(r => [r.line!, dec(r.qty)]));
}

/** Строка рабочего места, которую надо выпустить */
export interface WorkbenchExecuteRow {
  orderId: string;
  source: 'customer_order' | 'production_order';
  lineId: string;
  /** Этап выпуска; пусто — «Завершение производства» */
  stageId?: string | null;
  /** Количество (расширенный режим); пусто — весь остаток */
  qty?: string;
  /** Участок-изготовитель; пусто — участок заказа на производство */
  workCenterId?: string | null;
  /** Отметка мастера: кто и сколько выполнил (строки сдельных нарядов исполнителей) */
  assignments?: { assignmentId: string; qty: string }[];
}

/** Выполнение рабочего места: на участок и дату — один документ выпуска, строки — из отмеченных заказов */
export async function executeWorkbench(
  db: Db,
  ctx: DocCtx,
  input: { date?: string; mode: 'simple' | 'extended'; rows: WorkbenchExecuteRow[] },
): Promise<{ id: string; number: string | null; workCenterId: string; qty: string; stageId: string | null; assignments: { assignmentId: string; qty: string }[] }[]> {
  const date = input.date ?? new Date().toISOString().slice(0, 10);
  // группируем строки по участку: на участок и дату — один документ выпуска
  const groups = new Map<string, WorkbenchExecuteRow[]>();
  for (const row of input.rows) {
    const centerId = row.workCenterId ?? (await orderWorkCenter(db, row)) ?? null;
    if (!centerId) throw new DomainError(422, 'work_center_required', 'Choose a work center for every line');
    await assertWorkCenter(db, centerId);
    groups.set(centerId, [...(groups.get(centerId) ?? []), row]);
  }
  const out: { id: string; number: string | null; workCenterId: string; qty: string; stageId: string | null; assignments: { assignmentId: string; qty: string }[] }[] = [];
  // строка заказа покупателя, закрытая открытым заказом на производство, в выпуск не идёт
  const customerRows = input.rows.filter(r => r.source === 'customer_order');
  if (customerRows.length) {
    const covered = await coveredByOrders(db, ctx.workspaceId, customerRows.map(r => r.lineId));
    if (customerRows.some(r => (covered.get(r.lineId) ?? 0n) > 0n)) throw new DomainError(422, 'already_ordered', 'The line is already covered by a production order: release it from that order');
  }
  for (const [centerId, rows] of groups) {
    const plans: ProductionPlan[] = [];
    const orderIds = [...new Set(rows.map(r => `${r.orderId}:${r.source}`))];
    for (const key of orderIds) {
      const [orderId, source] = key.split(':');
      const own = rows.filter(r => r.orderId === orderId && r.source === source);
      const qty = (r: WorkbenchExecuteRow) => {
        if (input.mode !== 'extended') return undefined;
        if (!r.qty) throw new DomainError(422, 'quantity_required', 'Set the quantity of every line in the extended mode');
        return r.qty;
      };
      if (source === 'production_order') plans.push(...(await orderPlans(db, ctx, orderId, own.map(r => ({ orderItemId: r.lineId, qty: qty(r), stageId: r.stageId ?? null })))));
      else plans.push(...(await customerPlans(db, ctx, orderId, own.map(r => ({ customerOrderLineId: r.lineId, qty: qty(r), stageId: r.stageId ?? null })))));
    }
    if (!plans.length) continue;
    // на участок, дату и этап — один документ выпуска
    const byStage = new Map<string, ProductionPlan[]>();
    for (const p of plans) byStage.set(stageKey(p.stageId), [...(byStage.get(stageKey(p.stageId)) ?? []), p]);
    // отметки мастера идут в выпуск этапа своей операции; отметка без этапа — в первый документ группы
    const marks = rows.flatMap(r => r.assignments ?? []);
    const markStage = new Map<string, string>();
    if (marks.length) {
      const ops = await db.select({ id: productionOperations.id, stageId: productionOperations.stageId }).from(productionOperations).where(inArray(productionOperations.id, marks.map(m => m.assignmentId)));
      for (const op of ops) markStage.set(op.id, stageKey(op.stageId));
    }
    const stageKeys = [...byStage.keys()];
    const marksOf = (key: string) => marks.filter(m => {
      const k = markStage.get(m.assignmentId);
      return k !== undefined && stageKeys.includes(k) ? k === key : key === stageKeys[0];
    });
    for (const [key, stagePlans] of byStage) {
      const docId = await createOrAppendProduction(db, ctx, { date, workCenterId: centerId, stageId: stagePlans[0].stageId, basedOnId: rows[0]?.orderId ?? null, plans: stagePlans });
      const [doc] = await db.select({ status: documents.status, number: documents.number }).from(documents).where(eq(documents.id, docId)).limit(1);
      // документ дня мог быть уже проведён — дописывание перепроводит его само
      if (doc?.status === 'draft') await postDocument(db, ctx, docId);
      const [after] = await db.select({ number: documents.number }).from(documents).where(eq(documents.id, docId)).limit(1);
      out.push({ id: docId, number: after?.number ?? null, workCenterId: centerId, qty: fmt(stagePlans.reduce((sum, p) => sum + dec(p.qty), 0n), 3), stageId: stagePlans[0].stageId, assignments: marksOf(key) });
    }
  }
  return out;
}

/** Участок заказа на производство: участок строки рабочего места по умолчанию */
async function orderWorkCenter(db: Db, row: WorkbenchExecuteRow): Promise<string | null> {
  if (row.source !== 'production_order') return null;
  const [header] = await db.select({ workCenterId: productionHeaders.workCenterId }).from(productionHeaders).where(eq(productionHeaders.documentId, row.orderId)).limit(1);
  return header?.workCenterId ?? null;
}

/* ---------------- помощники ---------------- */

async function assertWorkCenter(db: Db, id: string): Promise<void> {
  const [wc] = await db.select({ id: workCenters.id }).from(workCenters).where(eq(workCenters.id, id)).limit(1);
  if (!wc) throw new DomainError(422, 'invalid_reference', 'The work center does not exist');
}

/** Строка заказа покупателя: должна быть у проведённого заказа покупателя */
async function assertCustomerOrderLine(db: Db, lineId: string): Promise<void> {
  const [row] = await db
    .select({ id: documentLines.id, type: documents.type, status: documents.status })
    .from(documentLines)
    .innerJoin(documents, eq(documents.id, documentLines.documentId))
    .where(eq(documentLines.id, lineId))
    .limit(1);
  if (!row || row.type !== 'customer_order') throw new DomainError(422, 'invalid_reference', 'The customer order line does not exist');
  if (row.status !== 'posted') throw new DomainError(422, 'base_not_posted', 'Post the customer order first');
}

/** Заказанное количество по позиции: заказ на производство или строка заказа покупателя */
async function orderedQty(db: Db, ws: string, source: StageSource): Promise<bigint> {
  if (source.sourceItemId) {
    const [row] = await db.select({ qty: productionItems.qty }).from(productionItems).where(eq(productionItems.id, source.sourceItemId)).limit(1);
    return dec(row?.qty);
  }
  if (source.customerOrderLineId) {
    const [row] = await db.select({ qty: documentLines.qty }).from(documentLines).where(eq(documentLines.id, source.customerOrderLineId)).limit(1);
    const shipped = (await shippedQty(db, ws, [source.customerOrderLineId])).get(source.customerOrderLineId) ?? 0n;
    return dec(row?.qty) - shipped;
  }
  return 0n;
}

/** Выполнен ли более поздний этап по той же позиции: промежуточный этап тогда нельзя отменить */
async function laterStageRelease(db: Db, itemId: string, source: StageSource, sortOrder: number): Promise<{ name: string } | null> {
  const plan = await itemStagePlan(db, itemId);
  // позже — любой этап с большим номером, включая финальный
  const later = plan.stages.filter(s => s.sortOrder > sortOrder && s.id);
  if (!later.length) return null;
  const rows = await db
    .select({ stageId: productionHeaders.stageId })
    .from(productionItems)
    .innerJoin(documents, eq(documents.id, productionItems.documentId))
    .leftJoin(productionHeaders, eq(productionHeaders.documentId, documents.id))
    .where(
      and(
        eq(documents.type, 'production'),
        eq(documents.status, 'posted'),
        inArray(productionHeaders.stageId, later.map(s => s.id!)),
        source.sourceItemId ? eq(productionItems.sourceItemId, source.sourceItemId) : eq(productionItems.customerOrderLineId, source.customerOrderLineId!),
      ),
    )
    .limit(1);
  if (!rows.length) return null;
  const st = later.find(s => s.id === rows[0].stageId);
  return { name: st?.name ?? '' };
}

/** Сколько уже выпущено по позициям заказа на производство */
/** Сколько уже выпущено по позициям заказа на производство: приём продукции — только финальным этапом */
async function producedQty(db: Db, _workspaceId: string, orderItemIds: string[]): Promise<Map<string, bigint>> {
  if (!orderItemIds.length) return new Map();
  const rows = await db
    .select({ source: productionItems.sourceItemId, qty: sql<string>`sum(${productionItems.qty})` })
    .from(productionItems)
    .innerJoin(documents, eq(documents.id, productionItems.documentId))
    .leftJoin(productionHeaders, eq(productionHeaders.documentId, documents.id))
    .leftJoin(productionStages, eq(productionStages.id, productionHeaders.stageId))
    .where(and(inArray(productionItems.sourceItemId, orderItemIds), eq(documents.status, 'posted'), sql`(${productionHeaders.stageId} is null or ${productionStages.isFinal} is true)`))
    .groupBy(productionItems.sourceItemId);
  return new Map(rows.map(r => [r.source!, dec(r.qty)]));
}

/** Сколько уже выпущено по строкам заказа покупателя */
/** Сколько уже выпущено по строкам заказа покупателя: приём продукции — только финальным этапом */
async function producedByCustomerLine(db: Db, _workspaceId: string, customerLineIds: string[]): Promise<Map<string, bigint>> {
  if (!customerLineIds.length) return new Map();
  const rows = await db
    .select({ line: productionItems.customerOrderLineId, qty: sql<string>`sum(${productionItems.qty})` })
    .from(productionItems)
    .innerJoin(documents, eq(documents.id, productionItems.documentId))
    .leftJoin(productionHeaders, eq(productionHeaders.documentId, documents.id))
    .leftJoin(productionStages, eq(productionStages.id, productionHeaders.stageId))
    .where(and(inArray(productionItems.customerOrderLineId, customerLineIds), eq(documents.status, 'posted'), sql`(${productionHeaders.stageId} is null or ${productionStages.isFinal} is true)`))
    .groupBy(productionItems.customerOrderLineId);
  return new Map(rows.map(r => [r.line!, dec(r.qty)]));
}

/** Сколько отгружено по строкам заказа покупателя (проведённые документы-исполнители цепочки) */
async function shippedQty(db: Db, _workspaceId: string, customerLineIds: string[]): Promise<Map<string, bigint>> {
  if (!customerLineIds.length) return new Map();
  const rows = await db
    .select({ line: documentLines.originLineId, qty: sql<string>`sum(${documentLines.qty})` })
    .from(documentLines)
    .innerJoin(documents, eq(documents.id, documentLines.documentId))
    .where(and(inArray(documentLines.originLineId, customerLineIds), eq(documents.status, 'posted'), inArray(documents.type, FULFIL_TYPES)))
    .groupBy(documentLines.originLineId);
  return new Map(rows.map(r => [r.line!, dec(r.qty)]));
}

/* ---------------- проведение выпуска ---------------- */

/** План выпуска: что производим (позиции документа) и из чего (состав) */
async function loadPlan(db: Db, documentId: string) {
  const items = await db.select().from(productionItems).where(eq(productionItems.documentId, documentId)).orderBy(asc(productionItems.sortOrder));
  const components = await db.select().from(productionComponents).where(eq(productionComponents.documentId, documentId)).orderBy(asc(productionComponents.sortOrder));
  return { items, components };
}

/** Себестоимость позиции выпуска: материалы (факт — по списанной строке) + работы + накладные.
    Работы берутся фактические (сумма проведённых нарядов), если по строке состава есть наряд; иначе — оценка нормы.
    Расход подрядчику (услуга переработчика в отчёте) — сумма строки состава.
    Давальческие материалы (ownerKind = customer) себестоимости не дают: их списывает выпуск, цена у них нулевая */
function itemCost(item: typeof productionItems.$inferSelect, components: (typeof productionComponents.$inferSelect)[], outCost: Map<string, bigint>, overheadPct: bigint, lineQty: Map<string, bigint>, workCosts?: Map<string, bigint>): bigint {
  const own = components.filter(c => c.itemId === item.id);
  let materials = 0n;
  let works = 0n;
  for (const c of own) {
    if (c.kind === 'work') {
      const actual = workCosts?.get(c.id);
      works += actual !== undefined ? actual : mul(dec(c.hours), dec(c.rate ?? '0')) + dec(c.fixedCost ?? '0');
      continue;
    }
    // расход подрядчику (услуга переработчика в отчёте): сумма берётся из строки состава — цена услуги в ней и есть затрата
    if (c.kind === 'expense') {
      materials += c.actualCost !== null ? dec(c.actualCost) : dec(c.plannedCost);
      continue;
    }
    // фактическое количество — по строке документа (её и списывают), плановое — из снимка
    const qty = c.documentLineId ? (lineQty.get(c.documentLineId) ?? dec(c.qty)) : dec(c.qty);
    const unit = c.documentLineId ? (outCost.get(c.documentLineId) ?? 0n) : 0n;
    if (c.ownerKind === 'customer') continue; // сырьё давальца: только количества, в себестоимость услуги не входит
    materials += mul(qty, unit);
  }
  const overhead = roundDiv((materials + works) * overheadPct, 100n * 1_000_000n);
  return materials + works + overhead;
}

/** Фактическая стоимость работ по выпуску: сумма проведённых сдельных нарядов по каждой строке состава */
async function releaseWorkCosts(db: Db, releaseId: string): Promise<Map<string, bigint>> {
  const rows = await db
    .select({ componentId: pieceworkLines.componentId, amount: sql<string>`coalesce(sum(${pieceworkLines.amount}), 0)` })
    .from(pieceworkLines)
    .innerJoin(documents, eq(documents.id, pieceworkLines.documentId))
    .where(and(eq(pieceworkLines.releaseDocumentId, releaseId), eq(documents.status, 'posted'), sql`${pieceworkLines.componentId} is not null`))
    .groupBy(pieceworkLines.componentId);
  return new Map(rows.map(r => [r.componentId!, dec(r.amount)]));
}

/* ---------------- разборка: списание исходного товара и приход выходных продуктов ----------------

   Стоимость разборки — стоимость списанного исходного товара + работы + накладные (overhead_pct спецификации).
   Она делится между выходными продуктами: по долям стоимости (сумма 100 %), иначе по цене продажи × количество,
   иначе по количеству. Остаток округления — на последней строке, сумма приходов равна распределяемой стоимости. */

/** Проверка долей стоимости выходов разборки: если задана хоть одна — заданы все, и сумма ровно 100 % */
function assertCostShares(components: (typeof productionComponents.$inferSelect)[]): void {
  const outs = components.filter(c => c.kind === 'output');
  if (!outs.length) return;
  try {
    checkCostShares(outs.map(c => ({ costShare: c.costShare ?? null })));
  } catch (e) {
    if (e instanceof DisassemblyShareError) throw new DomainError(422, e.code, e.message);
    throw e;
  }
}

/** Распределение стоимости разборки по выходным продуктам: цена единицы прихода и сумма по каждой строке */
interface DisassemblySplit {
  /** Цена единицы прихода по строке документа */
  units: Map<string, bigint>;
  /** Распределённая сумма по строке документа */
  amounts: Map<string, bigint>;
  /** Всего по позиции: списанное + работы + накладные */
  totals: Map<string, bigint>;
}

async function disassemblySplit(
  db: Db,
  items: (typeof productionItems.$inferSelect)[],
  components: (typeof productionComponents.$inferSelect)[],
  opts: {
    /** Цена списания исходного товара по строке документа */
    sourceCost: Map<string, bigint>;
    /** Фактическая стоимость работ по строке состава */
    workCosts: Map<string, bigint>;
    /** Накладные спецификации по позиции */
    overheadByItem: Map<string, bigint>;
    /** Количество по строке документа */
    qtyByLine: Map<string, bigint>;
  },
): Promise<DisassemblySplit> {
  const outIds = [...new Set(components.filter(c => c.kind === 'output').map(c => c.productId).filter((x): x is string => !!x))];
  const priceRows = outIds.length ? await db.select({ id: products.id, price: products.price }).from(products).where(inArray(products.id, outIds)) : [];
  const priceOf = new Map(priceRows.map(p => [p.id, p.price]));
  const units = new Map<string, bigint>();
  const amounts = new Map<string, bigint>();
  const totals = new Map<string, bigint>();
  for (const it of items) {
    const own = components.filter(c => c.itemId === it.id);
    // стоимость исходного товара: по фактически списанной строке документа
    let source = 0n;
    for (const c of own) {
      if (c.kind !== 'material') continue;
      const qty = c.documentLineId ? (opts.qtyByLine.get(c.documentLineId) ?? dec(c.qty)) : dec(c.qty);
      const unit = c.documentLineId ? (opts.sourceCost.get(c.documentLineId) ?? 0n) : 0n;
      source += mul(qty, unit);
    }
    // работы: фактические (наряды) или оценка нормы
    let works = 0n;
    for (const c of own) {
      if (c.kind !== 'work') continue;
      const actual = opts.workCosts.get(c.id);
      works += actual !== undefined ? actual : mul(dec(c.hours), dec(c.rate ?? '0')) + dec(c.fixedCost ?? '0');
    }
    const overhead = pctOf(source + works, opts.overheadByItem.get(it.itemId) ?? 0n);
    const total = source + works + overhead;
    totals.set(it.id, total);
    const outs = own.filter(c => c.kind === 'output');
    if (!outs.length) continue;
    let alloc: { productId: string; qty: string; amount: bigint }[];
    try {
      alloc = allocateDisassembly(
        total,
        outs.map(c => ({ productId: c.productId!, qty: fmt(opts.qtyByLine.get(c.documentLineId ?? '') ?? dec(c.qty), 3), costShare: c.costShare ?? null, price: priceOf.get(c.productId!) ?? null })),
      );
    } catch (e) {
      if (e instanceof DisassemblyShareError) throw new DomainError(422, e.code, e.message);
      throw e;
    }
    outs.forEach((c, i) => {
      const lineId = c.documentLineId;
      if (!lineId) return;
      const qty = opts.qtyByLine.get(lineId) ?? dec(c.qty);
      amounts.set(lineId, alloc[i]!.amount);
      units.set(lineId, qty > 0n ? div(alloc[i]!.amount, qty) : 0n);
    });
  }
  return { units, amounts, totals };
}

/** Продукция выпуска уже отгружена: себестоимость пересчитывать нельзя (корректировка — этап 6) */
async function assertNotShipped(db: Db, move: { seq: number; warehouseId: string; productId: string }): Promise<void> {
  const [row] = await db
    .select({ id: stockMoves.id, number: documents.number })
    .from(stockMoves)
    .innerJoin(documents, eq(documents.id, stockMoves.documentId))
    .where(and(eq(stockMoves.warehouseId, move.warehouseId), eq(stockMoves.productId, move.productId), sql`${stockMoves.qty} < 0`, sql`${stockMoves.seq} > ${move.seq}`))
    .limit(1);
  if (row) throw new DomainError(422, 'cost_locked', `The produced goods are already shipped (${row.number ?? 'document'}): their cost cannot be recalculated, adjust it when closing the period`);
}

/** Пересчёт себестоимости проведённого выпуска по фактическим работам (после проведения наряда).
    Цена прихода продукции и средняя склада пересчитываются в той же транзакции; если продукцию уже отгрузили — ошибка. */
export async function recalcReleaseCost(db: Db, ctx: DocCtx, releaseId: string): Promise<void> {
  const [doc] = await db.select().from(documents).where(eq(documents.id, releaseId)).limit(1);
  if (!doc || doc.type !== 'production' || doc.status !== 'posted') return; // черновик посчитается при проведении
  const { items, components } = await loadPlan(db, releaseId);
  if (!items.length) return;
  const moves = await db
    .select({ id: stockMoves.id, lineId: stockMoves.documentLineId, qty: stockMoves.qty, cost: stockMoves.cost, warehouseId: stockMoves.warehouseId, productId: stockMoves.productId, seq: stockMoves.seq })
    .from(stockMoves)
    .where(eq(stockMoves.documentId, releaseId));
  const outCost = new Map<string, bigint>();
  const lineQty = new Map<string, bigint>();
  const incoming = new Map<string, (typeof moves)[number]>();
  for (const m of moves) {
    if (!m.lineId) continue;
    const qty = dec(m.qty) < 0n ? -dec(m.qty) : dec(m.qty);
    lineQty.set(m.lineId, qty);
    if (dec(m.qty) < 0n) outCost.set(m.lineId, dec(m.cost));
    else incoming.set(m.lineId, m);
  }
  const prodIds = [...new Set(items.map(i => i.itemId))];
  const overheads = prodIds.length ? await db.select({ id: manufacturedItems.id, overheadPct: manufacturedItems.overheadPct }).from(manufacturedItems).where(inArray(manufacturedItems.id, prodIds)) : [];
  const overheadByItem = new Map(overheads.map(o => [o.id, dec(o.overheadPct)]));
  // незавершённое производство: стоимость выполненных промежуточных этапов на единицу
  const wipByItem = new Map<string, bigint>();
  for (const it of items) {
    const source: StageSource = { sourceItemId: it.sourceItemId, customerOrderLineId: it.customerOrderLineId };
    if (!source.sourceItemId && !source.customerOrderLineId) continue;
    const plan = await itemStagePlan(db, it.itemId);
    const totals = await stageTotals(db, [source]);
    wipByItem.set(it.id, await wipUnitCost(source, plan.stages, totals));
  }
  const workCosts = await releaseWorkCosts(db, releaseId);
  const [header] = await db.select({ stageId: productionHeaders.stageId }).from(productionHeaders).where(eq(productionHeaders.documentId, releaseId)).limit(1);
  const stage = await stageDef(db, header?.stageId ?? null);
  // разборка: пересчитываем стоимость списанного + работы + накладные и заново делим её между выходами
  if (doc.operation === 'disassembly') {
    const sourceCost = new Map<string, bigint>();
    const qtyByLine = new Map<string, bigint>();
    const incoming = new Map<string, (typeof moves)[number]>();
    for (const m of moves) {
      if (!m.lineId) continue;
      const qty = dec(m.qty) < 0n ? -dec(m.qty) : dec(m.qty);
      qtyByLine.set(m.lineId, qty);
      if (dec(m.qty) < 0n) sourceCost.set(m.lineId, dec(m.cost));
      else incoming.set(m.lineId, m);
    }
    const prodIds = [...new Set(items.map(i => i.itemId))];
    const overheads = prodIds.length ? await db.select({ id: manufacturedItems.id, overheadPct: manufacturedItems.overheadPct }).from(manufacturedItems).where(inArray(manufacturedItems.id, prodIds)) : [];
    const overheadByItem = new Map(overheads.map(o => [o.id, dec(o.overheadPct)]));
    const split = await disassemblySplit(db, items, components, { sourceCost, workCosts, overheadByItem, qtyByLine });
    for (const it of items) await db.update(productionItems).set({ stageCost: fmt(split.totals.get(it.id) ?? 0n) }).where(eq(productionItems.id, it.id));
    for (const c of components) {
      if (c.kind !== 'output' || !c.documentLineId) continue;
      const move = incoming.get(c.documentLineId);
      if (!move) continue;
      await assertNotShipped(db, move);
      await revalueMove(db, ctx.workspaceId, move.id, split.units.get(c.documentLineId) ?? 0n);
      await db.update(productionComponents).set({ actualCost: fmt(split.amounts.get(c.documentLineId) ?? 0n) }).where(eq(productionComponents.id, c.id));
    }
    return;
  }
  for (const it of items) {
    if (!it.documentLineId) {
      // промежуточный этап: продукции нет, меняется только затрата этапа (НЗП); если следующий этап уже выпущен, НЗП учтено в нём
      const source: StageSource = { sourceItemId: it.sourceItemId, customerOrderLineId: it.customerOrderLineId };
      if (source.sourceItemId || source.customerOrderLineId) {
        const later = await laterStageRelease(db, it.itemId, source, stage.sortOrder);
        if (later) throw new DomainError(422, 'cost_locked', `The stage “${later.name}” is already released: the cost of the stage “${stage.name}” cannot be recalculated, adjust it when closing the period`);
      }
      await db.update(productionItems).set({ stageCost: fmt(itemCost(it, components, outCost, overheadByItem.get(it.itemId) ?? 0n, lineQty, workCosts)) }).where(eq(productionItems.id, it.id));
      continue;
    }
    const move = incoming.get(it.documentLineId);
    if (!move) continue;
    const qty = lineQty.get(it.documentLineId) ?? dec(it.qty);
    if (qty <= 0n) continue;
    await assertNotShipped(db, move);
    const cost = itemCost(it, components, outCost, overheadByItem.get(it.itemId) ?? 0n, lineQty, workCosts);
    const wip = wipByItem.get(it.id) ?? 0n;
    const unit = div(cost + mul(wip, qty), qty);
    await revalueMove(db, ctx.workspaceId, move.id, unit);
    await db.update(productionItems).set({ stageCost: fmt(cost) }).where(eq(productionItems.id, it.id));
  }
}

/** Пересчёт себестоимости выпусков, к которым относится сдельный наряд (после его проведения) */
export async function recalcPieceworkReleases(db: Db, ctx: DocCtx, pieceworkId: string): Promise<void> {
  const lines = await db.select({ releaseId: pieceworkLines.releaseDocumentId }).from(pieceworkLines).where(eq(pieceworkLines.documentId, pieceworkId));
  const ids = [...new Set(lines.map(l => l.releaseId).filter((x): x is string => !!x))];
  for (const id of ids) await recalcReleaseCost(db, ctx, id);
}

/* ---------------- обеспечение материалов ---------------- */

/** Списанные выпуском материалы уменьшают резерв заказа на производство */
async function reduceReleaseReservations(db: Db, releaseId: string): Promise<void> {
  const comps = await db.select().from(productionComponents).where(eq(productionComponents.documentId, releaseId));
  for (const c of comps) {
    if (!c.sourceComponentId || c.kind === 'work' || !c.actualQty) continue;
    await reduceReservation(db, c.sourceComponentId, dec(c.actualQty));
  }
}

/** Закрытие заказа на производство: остаток резерва материалов снимается */
STATE_HOOKS.production_order = async (db, _ctx, doc, _from, to) => {
  if (to !== 'closed') return;
  await releaseOrderMaterials(db, doc.id);
};

/** Дочерние заказы на полуфабрикаты: по дефициту полуфабриката в составе заказа создаются черновики заказов на производство.
    Количество дочернего заказа — «Размещено» у строки материала родителя */
export async function createSemiOrders(db: Db, ctx: DocCtx, orderId: string, input: { date?: string }): Promise<{ created: { id: string; itemId: string; itemName: string; qty: string }[]; skipped: { productName: string; qty: string }[] }> {
  const [doc] = await db.select().from(documents).where(eq(documents.id, orderId)).limit(1);
  if (!doc || doc.type !== 'production_order') throw new DomainError(404, 'not_found', 'document not found');
  if (doc.status !== 'posted') throw new DomainError(422, 'base_not_posted', 'Post the production order first');
  const [header] = await db.select().from(productionHeaders).where(eq(productionHeaders.documentId, orderId)).limit(1);
  const rows = await materialRows(db, orderId);
  const created: { id: string; itemId: string; itemName: string; qty: string }[] = [];
  const skipped: { productName: string; qty: string }[] = [];
  for (const row of rows.filter(r => r.kind === 'semi')) {
    const deficit = dec(row.required) - dec(row.reserved) - dec(row.placed) - dec(row.free);
    if (deficit <= 0n) continue;
    // полуфабрикат: продукция, у которой этот товар каталога
    const [semi] = await db
      .select()
      .from(manufacturedItems)
      .where(and(eq(manufacturedItems.productId, row.productId), eq(manufacturedItems.kind, 'semi'), isNull(manufacturedItems.archivedAt)))
      .limit(1);
    if (!semi) {
      skipped.push({ productName: row.productName, qty: fmt(deficit, 3) });
      continue;
    }
    const id = await createProductionOrder(db, ctx, {
      workCenterId: header?.workCenterId ?? null,
      warehouseId: doc.warehouseId,
      targetWarehouseId: doc.targetWarehouseId,
      date: input.date,
      parentDocumentId: orderId,
      comment: `Semi-finished goods for production order ${doc.number ?? ''}`.trim(),
      items: [{ itemId: semi.id, qty: fmt(deficit, 3) }],
    });
    // размещение: дочерний заказ закрывает потребность родителя
    await db.insert(productionPlacements).values({ workspaceId: ctx.workspaceId, componentId: row.componentId, documentId: id, documentLineId: null, qty: fmt(deficit, 3) });
    created.push({ id, itemId: semi.id, itemName: semi.name, qty: fmt(deficit, 3) });
  }
  return { created, skipped };
}

/** Заказы поставщику по не обеспеченным материалам заказа на производство: строки заказа поставщику привязываются
    к строкам состава (размещение), при поступлении товар резервируется под заказ */
export async function createSupplierOrdersForOrder(
  db: Db,
  ctx: DocCtx,
  orderId: string,
  input: { date?: string; supplierId?: string | null; comment?: string },
): Promise<{ orders: { id: string; supplierId: string; supplierName: string; lines: { productId: string; productName: string; qty: string }[] }[]; withoutSupplier: { productId: string; productName: string; qty: string }[] }> {
  const [doc] = await db.select().from(documents).where(eq(documents.id, orderId)).limit(1);
  if (!doc || doc.type !== 'production_order') throw new DomainError(404, 'not_found', 'document not found');
  if (doc.status !== 'posted') throw new DomainError(422, 'base_not_posted', 'Post the production order first');
  const rows = (await materialRows(db, orderId)).filter(r => r.kind === 'material' && dec(r.notEnsured) > 0n);
  if (!rows.length) throw new DomainError(422, 'nothing_to_create', 'All materials of this production order are provided');
  const groups = new Map<string, { productId: string; productName: string; qty: string; componentId: string }[]>();
  const withoutSupplier: { productId: string; productName: string; qty: string }[] = [];
  for (const row of rows) {
    const supplierId = input.supplierId ?? (await supplierForProduct(db, row.productId));
    if (supplierId) {
      const [exists] = await db.select({ id: companies.id }).from(companies).where(eq(companies.id, supplierId)).limit(1);
      if (!exists) throw new DomainError(422, 'invalid_reference', 'The supplier does not exist');
    }
    if (!supplierId) {
      withoutSupplier.push({ productId: row.productId, productName: row.productName, qty: row.notEnsured });
      continue;
    }
    groups.set(supplierId, [...(groups.get(supplierId) ?? []), { productId: row.productId, productName: row.productName, qty: row.notEnsured, componentId: row.componentId }]);
  }
  const orders: { id: string; supplierId: string; supplierName: string; lines: { productId: string; productName: string; qty: string }[] }[] = [];
  for (const [supplierId, lines] of groups) {
    const [supplier] = await db.select({ id: companies.id, name: companies.name }).from(companies).where(eq(companies.id, supplierId)).limit(1);
    if (!supplier) continue;
    const prices = await db.select({ id: products.id, purchasePrice: products.purchasePrice }).from(products).where(inArray(products.id, lines.map(l => l.productId)));
    const price = new Map(prices.map(p => [p.id, p.purchasePrice]));
    const id = await createDocument(db, ctx, {
      type: 'supplier_order',
      counterpartyId: supplierId,
      warehouseId: doc.warehouseId ?? undefined,
      date: input.date,
      comment: input.comment?.trim() || `For production order ${doc.number ?? ''}`.trim(),
      lines: lines.map(l => ({ productId: l.productId, qty: l.qty, price: price.get(l.productId) ?? '0', discountPct: '0' })),
    });
    await db.update(documents).set({ basedOnId: orderId }).where(eq(documents.id, id));
    const created = await db.select().from(documentLines).where(eq(documentLines.documentId, id)).orderBy(asc(documentLines.sortOrder));
    for (const [n, l] of created.entries()) {
      const src = lines[n];
      if (!src) continue;
      await db.insert(productionPlacements).values({ workspaceId: ctx.workspaceId, componentId: src.componentId, documentId: id, documentLineId: l.id, qty: src.qty });
    }
    orders.push({ id, supplierId, supplierName: supplier.name, lines: lines.map(l => ({ productId: l.productId, productName: l.productName, qty: l.qty })) });
  }
  return { orders, withoutSupplier };
}

DOCUMENT_HOOKS.production_order = {
  /** У заказа на производство нет строк документа: состав проверяет сам */
  check: async (db, _ctx, doc) => {    const { items } = await loadPlan(db, doc.id);
    if (!items.length) throw new DomainError(422, 'no_items', 'Add products to produce before posting');
  },
  /** После проведения: материалы резервируются под заказ — столько, сколько свободно на складе материалов */
  afterPost: async (db, ctx, doc) => {
    await reserveOrderMaterials(db, ctx.workspaceId, doc.id);
  },
  /** После отмены проведения: резерв материалов снимается целиком */
  afterUnpost: async (db, _ctx, doc) => {
    await releaseOrderMaterials(db, doc.id);
  },
};

DOCUMENT_HOOKS.production = {
  /** Проверки до проведения: состав документа, порядок этапов и превышение заказанного */
  check: async (db, ctx, doc, lines) => {
    const { items, components } = await loadPlan(db, doc.id);
    if (!items.length) throw new DomainError(422, 'no_items', 'Add products to produce before posting');
    const disassembly = doc.operation === 'disassembly';
    const [header] = await db.select({ stageId: productionHeaders.stageId, processingOrderId: productionHeaders.processingOrderId }).from(productionHeaders).where(eq(productionHeaders.documentId, doc.id)).limit(1);
    const stageId = header?.stageId ?? null;
    const final = await isFinalStage(db, stageId);
    if (disassembly) {
      // разборка: исходный товар списывается, выходные продукты приходуются
      const sourceLines = new Set(components.filter(c => c.kind === 'material').map(c => c.documentLineId).filter((x): x is string => !!x));
      const outputLines = new Set(components.filter(c => c.kind === 'output').map(c => c.documentLineId).filter((x): x is string => !!x));
      for (const l of lines) {
        if (l.stockRole === 'out' && !sourceLines.has(l.id)) throw new DomainError(422, 'production_item_required', 'The goods to disassemble must belong to the composition of the production document');
        if (l.stockRole === 'in' && !outputLines.has(l.id)) throw new DomainError(422, 'production_item_required', 'The output line must belong to the composition of the production document');
      }
      if (!outputLines.size) throw new DomainError(422, 'no_outputs', 'Add outputs to the composition before posting');
      // доли стоимости выходов: заданы у всех или ни у одной, сумма — 100 %
      assertCostShares(components);
      if (!doc.targetWarehouseId) throw new DomainError(422, 'warehouse_required', 'Select a warehouse for the outputs before posting');
      if (!doc.warehouseId) throw new DomainError(422, 'warehouse_required', 'Select a warehouse for the goods to disassemble before posting');
    } else {
      const producedLines = items.map(i => i.documentLineId).filter((x): x is string => !!x);
      for (const l of lines) {
        if (l.stockRole !== 'in') continue;
        if (!producedLines.includes(l.id)) throw new DomainError(422, 'production_item_required', 'The produced line must belong to a position of the production document');
      }
      // склад продукции нужен только финальному этапу: промежуточный этап продукцию не приходует
      if (final && !doc.targetWarehouseId) throw new DomainError(422, 'warehouse_required', 'Select a warehouse for the finished goods before posting');
      if (lines.some(l => l.stockRole === 'out') && !doc.warehouseId) throw new DomainError(422, 'warehouse_required', 'Select a warehouse for the materials before posting');
    }
    // выпуск из давальческого сырья: заказ на переработку должен быть проведён, сырьё — на своём остатке
    if (header?.processingOrderId) {
      // разборка давальческого сырья не делается (решение пользователя): ветка разборки не знает владельца материала
      if (disassembly) throw new DomainError(422, 'processing_disassembly', 'A disassembly cannot be made from customer materials');
      const order = await assertProcessingOrder(db, header.processingOrderId);
      if (order.status !== 'posted') throw new DomainError(422, 'base_not_posted', 'Post the customer order first');
      if (!order.counterpartyId) throw new DomainError(422, 'counterparty_required', 'The processing order has no customer');
    }
    // продукция должна быть складским товаром
    const prodIds = [...new Set(lines.filter(l => l.stockRole === 'in' || (disassembly && l.stockRole === 'out')).map(l => l.productId))];
    if (prodIds.length) {
      const kinds = await db.select({ id: products.id, kind: products.kind }).from(products).where(inArray(products.id, prodIds));
      const bad = kinds.find(p => p.kind !== 'goods');
      if (bad) throw new DomainError(422, 'item_not_stockable', 'Only goods can be produced to stock');
    }
    // порядок этапов и заказанное количество
    for (const it of items) {
      const source: StageSource = { sourceItemId: it.sourceItemId, customerOrderLineId: it.customerOrderLineId };
      if (!source.sourceItemId && !source.customerOrderLineId) continue;
      const ordered = await orderedQty(db, ctx.workspaceId, source);
      const totals = await stageTotals(db, [source]);
      const stage = await resolveStage(db, it.itemId, stageId);
      const limit = await stageLimit(db, { itemId: it.itemId, stage, ordered, source, totals });
      const qty = dec(it.qty);
      if (limit.done + qty > limit.cap) {
        if (limit.byStage) throw new DomainError(422, 'stage_order', `The stage “${stage.name}” waits for the previous one: only ${fmt(limit.cap, 3)} of ${fmt(ordered, 3)} are ready`);
        throw new DomainError(422, 'over_fulfilment', 'More is produced than ordered');
      }
    }
  },
  /** Проведение: списание материалов по средней и приход продукции по себестоимости (на финальном этапе).
      Выпуск по заказу на переработку: давальские материалы списываются с остатка давальца, продукция приходуется
      туда же (себестоимость услуги — наши затраты), наш склад выпуск не трогает */
  post: async (db, ctx, doc, lines) => {
    const { items, components } = await loadPlan(db, doc.id);
    // разборка: списывается исходный товар, приходуются выходные продукты (стоимость делится между ними)
    if (doc.operation === 'disassembly') {
      const lineQty = new Map(lines.map(l => [l.id, dec(l.qty)]));
      const workCosts = await releaseWorkCosts(db, doc.id);
      const prodIds = [...new Set(items.map(i => i.itemId))];
      const overheads = prodIds.length ? await db.select({ id: manufacturedItems.id, overheadPct: manufacturedItems.overheadPct }).from(manufacturedItems).where(inArray(manufacturedItems.id, prodIds)) : [];
      const overheadByItem = new Map(overheads.map(o => [o.id, dec(o.overheadPct)]));
      const settings = await loadInventorySettings(db, ctx.workspaceId);
      // сначала расход: списывается исходный товар по средней (нехватка — 422)
      const outReqs: MoveRequest[] = lines.filter(l => l.stockRole === 'out').map(l => ({ warehouseId: doc.warehouseId!, productId: l.productId, lineId: l.id, qty: dec(l.qty), direction: 'out' as const }));
      const outCost = await applyStockMoves(db, ctx.workspaceId, { id: doc.id, date: doc.date }, outReqs, settings);
      // стоимость разборки делится между выходными продуктами: списанное + работы + накладные
      const split = await disassemblySplit(db, items, components, { sourceCost: outCost, workCosts, overheadByItem, qtyByLine: lineQty });
      // затем приход выходных продуктов по распределённой стоимости
      const inReqs: MoveRequest[] = lines.filter(l => l.stockRole === 'in').map(l => ({ warehouseId: doc.targetWarehouseId!, productId: l.productId, lineId: l.id, qty: dec(l.qty), direction: 'in' as const, cost: split.units.get(l.id) }));
      await applyStockMoves(db, ctx.workspaceId, { id: doc.id, date: doc.date }, inReqs, settings);
      // факт по составу: списанное количество и себестоимость строки
      for (const c of components) {
        if (c.kind === 'work') {
          await db.update(productionComponents).set({ actualQty: c.hours, actualCost: fmt(mul(dec(c.hours), dec(c.rate ?? '0')) + dec(c.fixedCost ?? '0')) }).where(eq(productionComponents.id, c.id));
          continue;
        }
        if (!c.documentLineId) continue;
        const qty = lineQty.get(c.documentLineId) ?? dec(c.qty);
        if (c.kind === 'output') {
          await db.update(productionComponents).set({ actualQty: fmt(qty), actualCost: fmt(split.amounts.get(c.documentLineId) ?? 0n) }).where(eq(productionComponents.id, c.id));
          continue;
        }
        const unit = outCost.get(c.documentLineId) ?? 0n;
        await db.update(productionComponents).set({ actualQty: fmt(qty), actualCost: fmt(mul(qty, unit)) }).where(eq(productionComponents.id, c.id));
      }
      // себестоимость позиции: списанное + работы + накладные (всего, что поделили между выходами)
      for (const it of items) await db.update(productionItems).set({ stageCost: fmt(split.totals.get(it.id) ?? 0n) }).where(eq(productionItems.id, it.id));
      return;
    }
    const [headerRow] = await db.select({ processingOrderId: productionHeaders.processingOrderId }).from(productionHeaders).where(eq(productionHeaders.documentId, doc.id)).limit(1);
    const processingOrderId = headerRow?.processingOrderId ?? null;
    // чей материал по строке состава: давальческое сырьё списывается со своего остатка, своё — по средней склада
    const customerLineIds = new Set(components.filter(c => c.ownerKind === 'customer' && c.documentLineId).map(c => c.documentLineId!));
    let ownerCompanyId: string | null = null;
    if (processingOrderId) {
      const [order] = await db.select({ counterpartyId: documents.counterpartyId }).from(documents).where(eq(documents.id, processingOrderId)).limit(1);
      if (!order?.counterpartyId) throw new DomainError(422, 'counterparty_required', 'The processing order has no customer');
      ownerCompanyId = order.counterpartyId;
    }
    const reqs: MoveRequest[] = [];
    const custReqs: CustomerMoveRequest[] = [];
    // склад двигают только товары: услуга переработчика идёт в себестоимость, а не в расход со склада
    const kinds = new Map((await db.select({ id: products.id, kind: products.kind }).from(products).where(inArray(products.id, [...new Set(lines.map(l => l.productId))]))).map(p => [p.id, p.kind]));
    for (const l of lines) {
      if (kinds.get(l.productId) !== 'goods') continue;
      if (l.stockRole === 'out') {
        if (customerLineIds.has(l.id) && processingOrderId) {
          if (ownerCompanyId) custReqs.push({ warehouseId: doc.warehouseId!, productId: l.productId, lineId: l.id, qty: dec(l.qty), direction: 'out', ownerCompanyId, processingOrderId });
          continue;
        }
        reqs.push({ warehouseId: doc.warehouseId!, productId: l.productId, lineId: l.id, qty: dec(l.qty), direction: 'out' });
      } else if (l.stockRole === 'in') {
        // продукция из давальческого сырья остаётся давальцу: она приходуется на его остаток, без стоимости
        if (processingOrderId && ownerCompanyId) custReqs.push({ warehouseId: doc.targetWarehouseId!, productId: l.productId, lineId: l.id, qty: dec(l.qty), direction: 'in', ownerCompanyId, processingOrderId });
        else reqs.push({ warehouseId: doc.targetWarehouseId!, productId: l.productId, lineId: l.id, qty: dec(l.qty), direction: 'in' });
      }
    }
    // цена прихода продукции: себестоимость её позиции (материалы по факту + работы + накладные)
    const itemByLine = new Map(items.filter(i => i.documentLineId).map(i => [i.documentLineId!, i]));
    const qtyByItem = new Map<string, bigint>();
    for (const l of lines) {
      const it = itemByLine.get(l.id);
      if (it) qtyByItem.set(it.id, (qtyByItem.get(it.id) ?? 0n) + dec(l.qty));
    }
    // накладные берём из спецификации продукции: overhead_pct её изделия
    const prodIds = [...new Set(items.map(i => i.itemId))];
    const overheads = prodIds.length ? await db.select({ id: manufacturedItems.id, overheadPct: manufacturedItems.overheadPct }).from(manufacturedItems).where(inArray(manufacturedItems.id, prodIds)) : [];
    const overheadByItem = new Map(overheads.map(o => [o.id, dec(o.overheadPct)]));
    const lineQty = new Map(lines.map(l => [l.id, dec(l.qty)]));
    // фактические работы: сумма проведённых сдельных нарядов по строкам состава (иначе — оценка нормы)
    const workCosts = await releaseWorkCosts(db, doc.id);
    // незавершённое производство: стоимость выполненных промежуточных этапов на единицу
    const wipByItem = new Map<string, bigint>();
    for (const it of items) {
      const source: StageSource = { sourceItemId: it.sourceItemId, customerOrderLineId: it.customerOrderLineId };
      if (!source.sourceItemId && !source.customerOrderLineId) continue;
      const plan = await itemStagePlan(db, it.itemId);
      const totals = await stageTotals(db, [source]);
      wipByItem.set(it.id, await wipUnitCost(source, plan.stages, totals));
    }
    const outCost = await applyStockMoves(db, ctx.workspaceId, { id: doc.id, date: doc.date }, reqs, await loadInventorySettings(db, ctx.workspaceId), {
      inCost: (lineId, costs) => {
        const it = lineId ? itemByLine.get(lineId) : undefined;
        if (!it) return undefined;
        // выпуск по заказу на переработку: прихода продукции на своём складе нет — стоимость не считается
        if (processingOrderId) return undefined;
        const cost = itemCost(it, components, costs, overheadByItem.get(it.itemId) ?? 0n, lineQty, workCosts);
        const qty = qtyByItem.get(it.id) ?? 0n;
        if (qty <= 0n) return undefined;
        // себестоимость продукции = затраты этапа + незавершённое производство предыдущих этапов
        const wip = wipByItem.get(it.id) ?? 0n;
        return div(cost + mul(wip, qty), qty);
      },
    });
    // давальские движения выпуска: сырьё давальца и продукция на его остатке (наш склад не меняется)
    if (custReqs.length && ownerCompanyId) await applyCustomerStockMoves(db, ctx.workspaceId, { id: doc.id, date: doc.date }, custReqs);
    // факт по составу: списанное количество и себестоимость строки
    for (const c of components) {
      if (c.kind === 'work') {
        await db.update(productionComponents).set({ actualQty: c.hours, actualCost: fmt(mul(dec(c.hours), dec(c.rate ?? '0')) + dec(c.fixedCost ?? '0')) }).where(eq(productionComponents.id, c.id));
        continue;
      }
      // расход подрядчику: услуга переработчика по цене отчёта (плановой сумме строки состава)
      if (c.kind === 'expense') {
        await db.update(productionComponents).set({ actualQty: c.qty, actualCost: c.plannedCost }).where(eq(productionComponents.id, c.id));
        continue;
      }
      if (!c.documentLineId) continue;
      const qty = lineQty.get(c.documentLineId) ?? dec(c.qty);
      const unit = outCost.get(c.documentLineId) ?? 0n;
      await db.update(productionComponents).set({ actualQty: fmt(qty), actualCost: fmt(mul(qty, unit)) }).where(eq(productionComponents.id, c.id));
    }
    // себестоимость этапа по позиции: наши материалы + работы + накладные — по заказу на переработку это себестоимость услуги
    for (const it of items) {
      const cost = itemCost(it, components, outCost, overheadByItem.get(it.itemId) ?? 0n, lineQty, workCosts);
      await db.update(productionItems).set({ stageCost: fmt(cost) }).where(eq(productionItems.id, it.id));
    }
  },
  /** Отмена проведения промежуточного этапа, если следующий этап уже выполнен, запрещена */
  beforeUnpost: async (db, _ctx, doc) => {
    const { items } = await loadPlan(db, doc.id);
    const [header] = await db.select({ stageId: productionHeaders.stageId }).from(productionHeaders).where(eq(productionHeaders.documentId, doc.id)).limit(1);
    const stageId = header?.stageId ?? null;
    if (!stageId) return; // предопределённый финальный этап
    const stage = await stageDef(db, stageId);
    if (stage.isFinal) return;
    for (const it of items) {
      const source: StageSource = { sourceItemId: it.sourceItemId, customerOrderLineId: it.customerOrderLineId };
      if (!source.sourceItemId && !source.customerOrderLineId) continue;
      const later = await laterStageRelease(db, it.itemId, source, stage.sortOrder);
      if (later) throw new DomainError(409, 'stage_conflict', `The stage “${stage.name}” cannot be unposted: the stage “${later.name}” is already released`);
    }
  },
  /** После проведения: выпущенная продукция резервируется под связанный заказ покупателя (только финальный этап) */
  afterPost: async (db, ctx, doc) => {
    // списанные материалы уменьшают резерв заказа на производство
    await reduceReleaseReservations(db, doc.id);
    // выпуск дочернего заказа резервирует полуфабрикат под строку материала родителя
    await reserveChildOutput(db, ctx.workspaceId, doc.id);
    const { items } = await loadPlan(db, doc.id);
    const [header] = await db.select({ stageId: productionHeaders.stageId }).from(productionHeaders).where(eq(productionHeaders.documentId, doc.id)).limit(1);
    if (!(await isFinalStage(db, header?.stageId ?? null))) return;
    const customerLines = items.filter(i => i.customerOrderLineId && i.documentLineId);
    if (!customerLines.length) return;
    const already = await producedByCustomerLine(db, ctx.workspaceId, customerLines.map(i => i.customerOrderLineId!));
    for (const it of customerLines) {
      const [src] = await db.select({ qty: documentLines.qty, productId: documentLines.productId, name: documentLines.name }).from(documentLines).where(eq(documentLines.id, it.customerOrderLineId!)).limit(1);
      if (!src) continue;
      const shipped = (await shippedQty(db, ctx.workspaceId, [it.customerOrderLineId!])).get(it.customerOrderLineId!) ?? 0n;
      // produced считает и этот выпуск — вычитаем его
      const other = (already.get(it.customerOrderLineId!) ?? 0n) - dec(it.qty);
      const want = dec(src.qty) - shipped - other;
      if (want <= 0n) continue;
      // если заказ покупателя уже резервирует товар на этом складе, второй резерв не нужен
      const [own] = await db
        .select({ id: stockReservations.id })
        .from(stockReservations)
        .where(and(eq(stockReservations.documentLineId, it.customerOrderLineId!), eq(stockReservations.warehouseId, doc.targetWarehouseId!), eq(stockReservations.productId, src.productId)))
        .limit(1);
      if (own) continue;
      const qty = dec(it.qty) < want ? dec(it.qty) : want;
      await db
        .insert(stockReservations)
        .values({ workspaceId: ctx.workspaceId, documentId: doc.id, productionLineId: it.documentLineId!, warehouseId: doc.targetWarehouseId!, productId: src.productId, qty: fmt(qty, 3) })
        .onConflictDoNothing();
    }
  },
  /** После отмены проведения: резерв снимается, факт по составу обнуляется */
  afterUnpost: async (db, ctx, doc) => {
    const { items, components } = await loadPlan(db, doc.id);
    // давальские движения выпуска откатываются (сырьё и продукция давальца)
    await revertCustomerStockMoves(db, ctx.workspaceId, doc.id);
    // отменённый выпуск возвращает списанное в резерв заказа
    for (const c of components) {
      if (!c.sourceComponentId || c.kind === 'work' || !c.actualQty) continue;
      await restoreReservation(db, ctx.workspaceId, c.sourceComponentId, dec(c.actualQty), doc.warehouseId);
    }
    const ids = items.map(i => i.documentLineId).filter((x): x is string => !!x);
    if (ids.length) await db.delete(stockReservations).where(inArray(stockReservations.productionLineId, ids));
    for (const c of components) if (c.actualQty !== null || c.actualCost !== null) await db.update(productionComponents).set({ actualQty: null, actualCost: null }).where(eq(productionComponents.id, c.id));
    for (const it of items) if (it.stageCost !== null) await db.update(productionItems).set({ stageCost: null }).where(eq(productionItems.id, it.id));
  },
};

/* ---------------- карточка и журнал ---------------- */

/** Карточка производственного документа: позиции, состав, выпуски */
export async function productionDetail(db: Db, id: string) {
  const [doc] = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
  if (!doc) throw new DomainError(404, 'not_found', 'document not found');
  const [header] = await db.select().from(productionHeaders).where(eq(productionHeaders.documentId, id)).limit(1);
  const { items, components } = await loadPlan(db, id);
  const prodIds = [...new Set(items.map(i => i.itemId))];
  const prods = prodIds.length ? await db.select().from(manufacturedItems).where(inArray(manufacturedItems.id, prodIds)) : [];
  const byProd = new Map(prods.map(p => [p.id, p]));
  const [workCenter] = header?.workCenterId ? await db.select({ id: workCenters.id, name: workCenters.name }).from(workCenters).where(eq(workCenters.id, header.workCenterId)).limit(1) : [];
  const produced = await producedQty(db, doc.workspaceId, items.map(i => i.id));
  const outputs = await db
    .select({ id: documents.id, number: documents.number, status: documents.status, date: documents.date })
    .from(documents)
    .where(eq(documents.basedOnId, id))
    .orderBy(asc(documents.createdAt));
  return {
    ...doc,
    workCenter: workCenter ?? null,
    plannedStart: header?.plannedStart ?? null,
    plannedEnd: header?.plannedEnd ?? null,
    parentDocumentId: header?.parentDocumentId ?? null,
    processingOrderId: header?.processingOrderId ?? null,
    items: items.map(i => ({ ...i, name: byProd.get(i.itemId)?.name ?? '', productId: byProd.get(i.itemId)?.productId ?? null, produced: fmt(produced.get(i.id) ?? 0n, 3) })),
    components: components.map(c => ({ ...c })),
    outputs,
  };
}

/** Журнал заказов на производство */
export async function listProductionOrders(db: Db, _workspaceId: string, params: { state?: string; from?: string; to?: string; q?: string; limit: number; offset: number }) {
  const conds = [
    eq(documents.type, 'production_order'),
    params.state ? eq(documents.state, params.state) : undefined,
    params.from ? sql`${productionHeaders.plannedStart} is not null and ${productionHeaders.plannedStart} >= ${params.from}` : undefined,
    params.to ? sql`${productionHeaders.plannedEnd} is not null and ${productionHeaders.plannedEnd} <= ${params.to}` : undefined,
    params.q ? sql`${documents.comment} ilike ${'%' + params.q + '%'}` : undefined,
  ];
  const rows = await db
    .select({ doc: documents, header: productionHeaders })
    .from(documents)
    .leftJoin(productionHeaders, eq(productionHeaders.documentId, documents.id))
    .where(and(...conds))
    .orderBy(desc(documents.date), desc(documents.createdAt))
    .limit(params.limit)
    .offset(params.offset);
  const ids = rows.map(r => r.doc.id);
  const items = ids.length ? await db.select().from(productionItems).where(inArray(productionItems.documentId, ids)) : [];
  const centers = await db.select({ id: workCenters.id, name: workCenters.name }).from(workCenters);
  const byCenter = new Map(centers.map(c => [c.id, c.name]));
  const count = await db.select({ n: sql<number>`count(*)` }).from(documents).leftJoin(productionHeaders, eq(productionHeaders.documentId, documents.id)).where(and(...conds));
  return {
    items: rows.map(r => ({ ...r.doc, workCenterName: r.header?.workCenterId ? (byCenter.get(r.header.workCenterId) ?? null) : null, plannedStart: r.header?.plannedStart ?? null, plannedEnd: r.header?.plannedEnd ?? null, itemCount: items.filter(i => i.documentId === r.doc.id).length })),
    total: Number(count[0]?.n ?? 0),
  };
}
