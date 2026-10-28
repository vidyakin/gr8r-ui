/* Виды цен и прайс-листы (задача 1178): справочник видов, история цен, подстановка цены по приоритету на дату,
   документ «Установка цен», поступление как источник цен, прайс-лист и публичные ссылки. Правила — docs/architecture/pricing.md. */
import { createHash, randomBytes } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  applyMarkup,
  dec,
  fmt,
  hasKindCycle,
  isCostKind,
  nineAllowed,
  pickPriceKind,
  priceStr,
  roundPrice,
  SYSTEM_PRICE_KINDS,
  type RoundingRule,
} from '@gr8r/shared';
import type { Db } from './client';
import { DOCUMENT_HOOKS } from './document-hooks';
import type { DocCtx } from './documents';
import { DomainError } from './errors';
import { recordEvent } from './events';
import './materials'; // хук поступления регистрируется там: наш хук дополняет его, а не заменяет
import {
  companies,
  contracts,
  documentLines,
  documents,
  organizations,
  priceKinds,
  priceListLinks,
  priceSettingLines,
  productCategories,
  productPrices,
  products,
  units,
  workOrderKinds,
  workspaces,
} from './schema';
import { loadAvgCosts } from './stock';

const today = () => new Date().toISOString().slice(0, 10);
export type PriceKindRow = typeof priceKinds.$inferSelect;
type DocRow = typeof documents.$inferSelect;

export const kindRule = (k: Pick<PriceKindRow, 'roundingStep' | 'roundingMode' | 'roundToNine'>): RoundingRule => ({ step: String(k.roundingStep), mode: k.roundingMode, nine: k.roundToNine });

/* ---------------- справочник видов цен ---------------- */

/** Системные виды создаются вместе с воркспейсом и при первом обращении (старые воркспейсы получают их миграцией) */
export async function ensurePriceKinds(db: Db, workspaceId: string): Promise<{ retail: PriceKindRow; purchase: PriceKindRow }> {
  let rows = await db.select().from(priceKinds).where(and(eq(priceKinds.workspaceId, workspaceId), sql`${priceKinds.systemKey} is not null`));
  const have = new Set(rows.map(r => r.systemKey));
  const missing = SYSTEM_PRICE_KINDS.filter(k => !have.has(k.key));
  if (missing.length) {
    await db
      .insert(priceKinds)
      .values(missing.map((k, i) => ({ workspaceId, name: k.name, method: 'manual' as const, systemKey: k.key, sortOrder: k.key === 'retail' ? 0 : 1 + i })))
      .onConflictDoNothing();
    rows = await db.select().from(priceKinds).where(and(eq(priceKinds.workspaceId, workspaceId), sql`${priceKinds.systemKey} is not null`));
  }
  return { retail: rows.find(r => r.systemKey === 'retail')!, purchase: rows.find(r => r.systemKey === 'purchase')! };
}

/** Список видов; без права на себестоимость закупочные, расчётные от себестоимости и цены поставщиков скрыты */
export async function listPriceKinds(db: Db, workspaceId: string, opts: { canSeeCost: boolean; archived?: boolean }): Promise<(PriceKindRow & { supplierName: string | null; baseKindName: string | null })[]> {
  await ensurePriceKinds(db, workspaceId);
  const rows = await db
    .select()
    .from(priceKinds)
    .where(and(eq(priceKinds.workspaceId, workspaceId), opts.archived ? undefined : isNull(priceKinds.archivedAt)))
    .orderBy(asc(priceKinds.sortOrder), asc(priceKinds.createdAt));
  const visible = opts.canSeeCost ? rows : rows.filter(k => !isCostKind(k));
  const byId = new Map(rows.map(r => [r.id, r]));
  const supplierIds = [...new Set(visible.map(k => k.supplierId).filter((x): x is string => !!x))];
  const names = supplierIds.length ? new Map((await db.select({ id: companies.id, name: companies.name }).from(companies).where(inArray(companies.id, supplierIds))).map(c => [c.id, c.name])) : new Map<string, string>();
  return visible.map(k => ({ ...k, supplierName: k.supplierId ? (names.get(k.supplierId) ?? null) : null, baseKindName: k.baseKindId ? (byId.get(k.baseKindId)?.name ?? null) : null }));
}

export interface PriceKindInput {
  id?: string | undefined;
  name: string;
  method?: 'manual' | 'derived' | 'cost_based' | undefined;
  baseKindId?: string | null | undefined;
  markupPct?: string | undefined;
  costBasis?: 'avg_cost' | 'last_purchase' | null | undefined;
  roundingStep?: string | undefined;
  roundingMode?: 'math' | 'up' | undefined;
  roundToNine?: boolean | undefined;
  includesVat?: boolean | undefined;
  supplierId?: string | null | undefined;
  updateFromReceipts?: boolean | undefined;
}

async function validateKind(db: Db, workspaceId: string, id: string | null, k: Required<Pick<PriceKindInput, 'method' | 'roundingStep' | 'roundToNine'>> & PriceKindInput): Promise<void> {
  if (k.roundToNine && !nineAllowed(k.roundingStep)) throw new DomainError(422, 'price_nine_step', 'The "up to 9" rounding needs a step of 10 or 100');
  if (k.supplierId) {
    const [c] = await db.select({ id: companies.id }).from(companies).where(eq(companies.id, k.supplierId)).limit(1);
    if (!c) throw new DomainError(422, 'invalid_reference', 'The supplier does not exist');
    if (k.method !== 'manual') throw new DomainError(422, 'price_supplier_manual', 'A supplier price kind is entered manually');
  }
  if (k.method === 'derived') {
    if (!k.baseKindId) throw new DomainError(422, 'price_base_required', 'Select the base price kind');
    const all = await db.select({ id: priceKinds.id, baseKindId: priceKinds.baseKindId, archivedAt: priceKinds.archivedAt }).from(priceKinds).where(eq(priceKinds.workspaceId, workspaceId));
    const base = all.find(x => x.id === k.baseKindId);
    if (!base) throw new DomainError(422, 'invalid_reference', 'The base price kind does not exist');
    if (id && hasKindCycle(id, x => (x === id ? k.baseKindId : all.find(a => a.id === x)?.baseKindId))) throw new DomainError(422, 'price_kind_cycle', 'The price kinds refer to each other in a circle');
  }
  if (k.method === 'cost_based' && !k.costBasis) throw new DomainError(422, 'price_basis_required', 'Select the cost basis');
}

export async function createPriceKind(db: Db, ctx: DocCtx, input: PriceKindInput): Promise<string> {
  await ensurePriceKinds(db, ctx.workspaceId);
  const method = input.method ?? 'manual';
  const roundingStep = input.roundingStep ?? '0.01';
  const roundToNine = input.roundToNine ?? false;
  await validateKind(db, ctx.workspaceId, null, { ...input, method, roundingStep, roundToNine });
  const [row] = await db
    .insert(priceKinds)
    .values({
      ...(input.id ? { id: input.id } : {}),
      workspaceId: ctx.workspaceId,
      name: input.name.trim(),
      method,
      baseKindId: method === 'derived' ? (input.baseKindId ?? null) : null,
      markupPct: input.markupPct ?? '0',
      costBasis: method === 'cost_based' ? (input.costBasis ?? null) : null,
      roundingStep,
      roundingMode: input.roundingMode ?? 'math',
      roundToNine,
      includesVat: input.includesVat ?? true,
      supplierId: input.supplierId ?? null,
      updateFromReceipts: input.updateFromReceipts ?? false,
      sortOrder: 100,
    })
    .returning();
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'price_kind.created', entity: 'price_kind', recordId: row!.id, actorId: ctx.memberId, payload: { name: row!.name } });
  return row!.id;
}

export async function updatePriceKind(db: Db, ctx: DocCtx, id: string, patch: Partial<Omit<PriceKindInput, 'id' | 'method'>>): Promise<void> {
  const [cur] = await db.select().from(priceKinds).where(eq(priceKinds.id, id)).limit(1).for('update');
  if (!cur) throw new DomainError(404, 'not_found', 'price kind not found');
  const next = {
    ...cur,
    ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
    ...(cur.systemKey ? {} : { ...(patch.baseKindId !== undefined ? { baseKindId: patch.baseKindId } : {}), ...(patch.costBasis !== undefined ? { costBasis: patch.costBasis } : {}), ...(patch.supplierId !== undefined ? { supplierId: patch.supplierId } : {}) }),
    ...(patch.markupPct !== undefined ? { markupPct: patch.markupPct } : {}),
    ...(patch.roundingStep !== undefined ? { roundingStep: patch.roundingStep } : {}),
    ...(patch.roundingMode !== undefined ? { roundingMode: patch.roundingMode } : {}),
    ...(patch.roundToNine !== undefined ? { roundToNine: patch.roundToNine } : {}),
    ...(patch.includesVat !== undefined ? { includesVat: patch.includesVat } : {}),
    ...(patch.updateFromReceipts !== undefined ? { updateFromReceipts: patch.updateFromReceipts } : {}),
  };
  await validateKind(db, ctx.workspaceId, id, { ...next, roundingStep: String(next.roundingStep), name: next.name });
  const { id: _i, workspaceId: _w, createdAt: _c, ...set } = next;
  await db.update(priceKinds).set({ ...set, updatedAt: new Date() }).where(eq(priceKinds.id, id));
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'price_kind.updated', entity: 'price_kind', recordId: id, actorId: ctx.memberId, payload: {} });
}

/** Архив: системные не архивируются; вид, на который опирается расчётный, тоже */
export async function archivePriceKind(db: Db, ctx: DocCtx, id: string): Promise<void> {
  const [cur] = await db.select().from(priceKinds).where(eq(priceKinds.id, id)).limit(1);
  if (!cur) throw new DomainError(404, 'not_found', 'price kind not found');
  if (cur.systemKey) throw new DomainError(422, 'price_kind_system', 'A system price kind cannot be archived');
  const [dep] = await db.select({ name: priceKinds.name }).from(priceKinds).where(and(eq(priceKinds.baseKindId, id), isNull(priceKinds.archivedAt))).limit(1);
  if (dep) throw new DomainError(422, 'price_kind_in_use', `The price kind is the base of “${dep.name}”`);
  await db.update(priceKinds).set({ archivedAt: new Date(), updatedAt: new Date() }).where(eq(priceKinds.id, id));
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'price_kind.archived', entity: 'price_kind', recordId: id, actorId: ctx.memberId, payload: {} });
}

/* ---------------- подстановка цены на дату ---------------- */

export interface ResolvedPrice {
  price: string | null;
  /** manual — запись истории; rule — расчёт по правилу вида; parent — цена товара-родителя (вариант); cache — карточка товара без истории */
  source: 'manual' | 'rule' | 'parent' | 'cache' | null;
}

/** Цены товаров по одному виду на дату. Порядок: своя запись → правило вида → карточка товара (розничная/закупочная) → родитель варианта.
    Батч: история читается одним запросом `distinct on`. skipManualOf — не брать ручные записи этого вида (пересчёт «по правилу») */
export async function resolvePrices(db: Db, workspaceId: string, kindId: string, productIds: string[], date: string, opts: { skipManualOf?: string } = {}): Promise<Map<string, ResolvedPrice>> {
  const out = new Map<string, ResolvedPrice>();
  if (!productIds.length) return out;
  const kinds = new Map((await db.select().from(priceKinds).where(eq(priceKinds.workspaceId, workspaceId))).map(k => [k.id, k]));
  const top = kinds.get(kindId);
  if (!top) throw new DomainError(404, 'not_found', 'price kind not found');
  // замыкание: виды цепочки и товары с родителями
  const chain = new Set<string>();
  for (let k: PriceKindRow | undefined = top; k && !chain.has(k.id); k = k.baseKindId ? kinds.get(k.baseKindId) : undefined) chain.add(k.id);
  const retail = [...kinds.values()].find(k => k.systemKey === 'retail');
  const purchase = [...kinds.values()].find(k => k.systemKey === 'purchase');
  if ([...chain].some(id => kinds.get(id)!.costBasis === 'last_purchase') && purchase) chain.add(purchase.id);
  const prodRows = await db.select({ id: products.id, parentId: products.parentProductId, price: products.price, purchasePrice: products.purchasePrice }).from(products).where(inArray(products.id, productIds));
  const parents = [...new Set(prodRows.map(p => p.parentId).filter((x): x is string => !!x))];
  const parentRows = parents.length ? await db.select({ id: products.id, parentId: products.parentProductId, price: products.price, purchasePrice: products.purchasePrice }).from(products).where(inArray(products.id, parents)) : [];
  const prod = new Map([...prodRows, ...parentRows].map(p => [p.id, p]));
  const allIds = [...prod.keys()];
  // ручные записи на дату
  const hist = new Map<string, string>();
  const rows = await db.execute<{ price_kind_id: string; product_id: string; price: string }>(sql`
    select distinct on (price_kind_id, product_id) price_kind_id, product_id, price::text as price
    from product_prices
    where workspace_id = ${workspaceId} and date <= ${date} and price_kind_id in ${sql`(${sql.join([...chain].map(c => sql`${c}::uuid`), sql`, `)})`} and product_id in ${sql`(${sql.join(allIds.map(c => sql`${c}::uuid`), sql`, `)})`}
    order by price_kind_id, product_id, date desc, id desc`);
  for (const r of rows) hist.set(`${r.price_kind_id}|${r.product_id}`, r.price);
  // база расчёта «от себестоимости»
  const needAvg = [...chain].some(id => kinds.get(id)!.costBasis === 'avg_cost');
  const avg = needAvg ? await loadAvgCosts(db, allIds) : new Map<string, string>();
  const needLast = [...chain].some(id => kinds.get(id)!.costBasis === 'last_purchase');
  const last = new Map<string, string>();
  if (needLast) {
    const lr = await db.execute<{ product_id: string; price: string }>(sql`
      select distinct on (l.product_id) l.product_id, l.price::text as price
      from document_lines l join documents d on d.id = l.document_id
      where l.workspace_id = ${workspaceId} and d.type = 'receipt' and d.status = 'posted' and d.date <= ${date}
        and l.product_id in ${sql`(${sql.join(allIds.map(c => sql`${c}::uuid`), sql`, `)})`}
      order by l.product_id, d.date desc, d.posted_at desc nulls last`);
    for (const r of lr) last.set(r.product_id, r.price);
  }
  const memo = new Map<string, ResolvedPrice>();
  const calc = (kid: string, pid: string, depth: number): ResolvedPrice => {
    const key = `${kid}|${pid}`;
    const hit = memo.get(key);
    if (hit) return hit;
    const none: ResolvedPrice = { price: null, source: null };
    if (depth > 12) return none;
    const kind = kinds.get(kid);
    const p = prod.get(pid);
    if (!kind || !p) return none;
    let res: ResolvedPrice = none;
    const own = opts.skipManualOf === kid && depth === 0 ? undefined : hist.get(key);
    if (own !== undefined) res = { price: own, source: 'manual' };
    else if (kind.method === 'derived' && kind.baseKindId) {
      const b = calc(kind.baseKindId, pid, depth + 1);
      if (b.price !== null) res = { price: priceStr(applyMarkup(dec(b.price), kind.markupPct, kindRule(kind))), source: 'rule' };
    } else if (kind.method === 'cost_based') {
      const base = kind.costBasis === 'avg_cost' ? avg.get(pid) : (last.get(pid) ?? (purchase ? calc(purchase.id, pid, depth + 1).price : null));
      if (base !== undefined && base !== null) res = { price: priceStr(applyMarkup(dec(base), kind.markupPct, kindRule(kind))), source: 'rule' };
    }
    if (res.price === null && kind.systemKey) {
      const c = kind.systemKey === 'retail' ? p.price : p.purchasePrice;
      if (dec(c) > 0n) res = { price: c, source: 'cache' };
    }
    if (res.price === null && p.parentId && p.parentId !== pid) {
      const par = calc(kid, p.parentId, depth + 1);
      if (par.price !== null) res = { price: par.price, source: 'parent' };
    }
    memo.set(key, res);
    return res;
  };
  void retail;
  for (const pid of productIds) out.set(pid, calc(kindId, pid, 0));
  return out;
}

export interface DocumentPriceContext {
  party: 'customer' | 'supplier';
  priceKindId?: string | null | undefined;
  contractId?: string | null | undefined;
  counterpartyId?: string | null | undefined;
  workOrderKindId?: string | null | undefined;
}

/** Вид цен документа по приоритету: шапка ← договор ← контрагент ← вид заказ-наряда ← розничная (закупка: ← вид поставщика ← закупочная) */
export async function documentPriceKind(db: Db, workspaceId: string, c: DocumentPriceContext): Promise<{ kindId: string; source: string; kindName: string }> {
  const sys = await ensurePriceKinds(db, workspaceId);
  const [contract] = c.contractId ? await db.select({ k: contracts.priceKindId }).from(contracts).where(eq(contracts.id, c.contractId)).limit(1) : [];
  const [company] = c.counterpartyId ? await db.select({ k: companies.priceKindId }).from(companies).where(eq(companies.id, c.counterpartyId)).limit(1) : [];
  const [wok] = c.workOrderKindId ? await db.select({ k: workOrderKinds.priceKindId }).from(workOrderKinds).where(eq(workOrderKinds.id, c.workOrderKindId)).limit(1) : [];
  const [supplierKind] =
    c.party === 'supplier' && c.counterpartyId
      ? await db.select({ id: priceKinds.id }).from(priceKinds).where(and(eq(priceKinds.supplierId, c.counterpartyId), isNull(priceKinds.archivedAt))).orderBy(asc(priceKinds.createdAt)).limit(1)
      : [];
  const picked = pickPriceKind({
    party: c.party,
    headerKindId: c.priceKindId,
    contractKindId: contract?.k,
    companyKindId: company?.k,
    workOrderKindId: wok?.k,
    supplierKindId: supplierKind?.id,
    retailKindId: sys.retail.id,
    purchaseKindId: sys.purchase.id,
  });
  const [k] = await db.select({ name: priceKinds.name }).from(priceKinds).where(eq(priceKinds.id, picked.kindId)).limit(1);
  return { ...picked, kindName: k?.name ?? '' };
}

/** Цены товаров для документа: вид по приоритету + цена на дату. Нет цены — null (интерфейс берёт карточку товара) */
export async function resolveForDocument(db: Db, workspaceId: string, input: DocumentPriceContext & { productIds: string[]; date?: string | undefined }) {
  const kind = await documentPriceKind(db, workspaceId, input);
  const res = await resolvePrices(db, workspaceId, kind.kindId, input.productIds, input.date ?? today());
  return { priceKindId: kind.kindId, priceKindName: kind.kindName, source: kind.source, prices: Object.fromEntries([...res].map(([id, r]) => [id, r.price])) as Record<string, string | null> };
}

/** Цена одного товара вида «Розничная» (или вида контрагента) на дату — запись на приём и прочий серверный код */
export async function resolveOne(db: Db, workspaceId: string, productId: string, ctx: DocumentPriceContext, date?: string): Promise<string | null> {
  const r = await resolveForDocument(db, workspaceId, { ...ctx, productIds: [productId], ...(date ? { date } : {}) });
  return r.prices[productId] ?? null;
}

/** Цены товара по всем видам на дату — карточка товара */
export async function productPricesByKind(db: Db, workspaceId: string, productId: string, date: string, canSeeCost: boolean) {
  const kinds = await listPriceKinds(db, workspaceId, { canSeeCost });
  const result = [];
  for (const k of kinds) {
    const r = (await resolvePrices(db, workspaceId, k.id, [productId], date)).get(productId)!;
    result.push({ priceKindId: k.id, name: k.name, method: k.method, systemKey: k.systemKey, price: r.price, source: r.source });
  }
  return result;
}

/** История цен товара: записи по видам, от новых к старым */
export async function productPriceHistory(db: Db, workspaceId: string, productId: string, canSeeCost: boolean) {
  const kinds = new Map((await listPriceKinds(db, workspaceId, { canSeeCost, archived: true })).map(k => [k.id, k]));
  const rows = await db
    .select({ id: productPrices.id, priceKindId: productPrices.priceKindId, date: productPrices.date, price: productPrices.price, documentId: productPrices.documentId, number: documents.number })
    .from(productPrices)
    .leftJoin(documents, eq(documents.id, productPrices.documentId))
    .where(and(eq(productPrices.workspaceId, workspaceId), eq(productPrices.productId, productId)))
    .orderBy(desc(productPrices.date), desc(productPrices.id))
    .limit(300);
  return rows.filter(r => kinds.has(r.priceKindId)).map(r => ({ ...r, priceKindName: kinds.get(r.priceKindId)!.name }));
}

/* ---------------- кэш цены в карточке товара и ручные правки ---------------- */

/** products.price / purchase_price — кэш текущей цены «Розничной» и «Закупочной». Пересчитывается из истории на сегодня.
    Запись с будущей датой кэш не меняет; когда её дата наступит, кэш обновит следующая установка (известное ограничение) —
    подстановка в документы всегда считает по истории и от кэша не зависит */
export async function refreshPriceCache(db: Db, workspaceId: string, productIds: string[]): Promise<void> {
  if (!productIds.length) return;
  const sys = await ensurePriceKinds(db, workspaceId);
  const ids = [...new Set(productIds)];
  for (const [kind, column] of [[sys.retail, 'price'], [sys.purchase, 'purchase_price']] as const) {
    const res = await resolvePrices(db, workspaceId, kind.id, ids, today());
    // «нет цены» после отмены установки — ноль, пока история пуста совсем
    const any = await db.select({ productId: productPrices.productId }).from(productPrices).where(and(eq(productPrices.priceKindId, kind.id), inArray(productPrices.productId, ids)));
    const hasHistory = new Set(any.map(a => a.productId));
    for (const pid of ids) {
      const r = res.get(pid)!;
      const value = r.source === 'manual' ? r.price : hasHistory.has(pid) ? null : '0.00';
      if (value === null) continue;
      await db.execute(sql`update products set ${sql.raw(column)} = ${value}, updated_at = now() where id = ${pid}`);
    }
  }
}

/** Цена, введённая в карточке товара или при создании, — запись истории «Розничной» / «Закупочной» на сегодня */
export async function recordProductPrice(db: Db, workspaceId: string, productId: string, which: 'retail' | 'purchase', price: string, date = today()): Promise<void> {
  const sys = await ensurePriceKinds(db, workspaceId);
  const kind = sys[which];
  // правки одного дня не копятся: ручная запись того же дня заменяется
  await db.delete(productPrices).where(and(eq(productPrices.priceKindId, kind.id), eq(productPrices.productId, productId), eq(productPrices.date, date), isNull(productPrices.documentId)));
  await db.insert(productPrices).values({ workspaceId, priceKindId: kind.id, productId, date, price: fmt(dec(price), 2) });
}

/** Перенос текущих цен карточек в историю (демо-данные и товары, созданные прямой вставкой) */
export async function backfillProductPrices(db: Db, workspaceId: string): Promise<void> {
  const sys = await ensurePriceKinds(db, workspaceId);
  const rows = await db.select({ id: products.id, price: products.price, purchasePrice: products.purchasePrice, createdAt: products.createdAt }).from(products).where(eq(products.workspaceId, workspaceId));
  const have = new Set((await db.select({ k: productPrices.priceKindId, p: productPrices.productId }).from(productPrices).where(eq(productPrices.workspaceId, workspaceId))).map(r => `${r.k}|${r.p}`));
  const values = [];
  for (const r of rows) {
    const date = r.createdAt.toISOString().slice(0, 10);
    if (dec(r.price) > 0n && !have.has(`${sys.retail.id}|${r.id}`)) values.push({ workspaceId, priceKindId: sys.retail.id, productId: r.id, date, price: r.price! });
    if (dec(r.purchasePrice) > 0n && !have.has(`${sys.purchase.id}|${r.id}`)) values.push({ workspaceId, priceKindId: sys.purchase.id, productId: r.id, date, price: r.purchasePrice! });
  }
  for (let i = 0; i < values.length; i += 500) await db.insert(productPrices).values(values.slice(i, i + 500));
}

/* ---------------- документ «Установка цен» ---------------- */

export interface PriceSettingLineInput {
  id?: string | undefined;
  productId: string;
  priceKindId: string;
  price: string;
}
export interface PriceSettingInput {
  id?: string | undefined;
  date?: string | undefined;
  organizationId?: string | null | undefined;
  comment?: string | undefined;
  lines?: PriceSettingLineInput[] | undefined;
}

async function loadSetting(db: Db, id: string, lock = false): Promise<DocRow> {
  const q = db.select().from(documents).where(eq(documents.id, id)).limit(1);
  const [row] = await (lock ? q.for('update') : q);
  if (!row || row.type !== 'price_setting') throw new DomainError(404, 'not_found', 'document not found');
  return row;
}

async function defaultOrganizationId(db: Db): Promise<string> {
  const [o] = await db.select({ id: organizations.id }).from(organizations).where(isNull(organizations.archivedAt)).orderBy(desc(organizations.isDefault), asc(organizations.createdAt)).limit(1);
  if (!o) throw new DomainError(422, 'organization_required', 'Add an organization in Settings → Organizations first');
  return o.id;
}

async function saveSettingLines(db: Db, ctx: DocCtx, doc: DocRow, inputs: PriceSettingLineInput[]): Promise<void> {
  const seen = new Set<string>();
  for (const l of inputs) {
    const key = `${l.productId}|${l.priceKindId}`;
    if (seen.has(key)) throw new DomainError(422, 'duplicate_price_line', 'A product can be listed once per price kind');
    seen.add(key);
  }
  await db.delete(priceSettingLines).where(eq(priceSettingLines.documentId, doc.id));
  if (inputs.length)
    await db.insert(priceSettingLines).values(inputs.map((l, i) => ({ ...(l.id ? { id: l.id } : {}), workspaceId: ctx.workspaceId, documentId: doc.id, sortOrder: i, productId: l.productId, priceKindId: l.priceKindId, price: fmt(dec(l.price), 2) })));
}

export async function createPriceSetting(db: Db, ctx: DocCtx, input: PriceSettingInput): Promise<string> {
  await ensurePriceKinds(db, ctx.workspaceId);
  const organizationId = input.organizationId ?? (await defaultOrganizationId(db));
  const [row] = await db
    .insert(documents)
    .values({ ...(input.id ? { id: input.id } : {}), workspaceId: ctx.workspaceId, type: 'price_setting', date: input.date ?? today(), organizationId, comment: input.comment ?? '', responsibleId: ctx.memberId, createdBy: ctx.memberId })
    .returning();
  if (input.lines?.length) await saveSettingLines(db, ctx, row!, input.lines);
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'document.created', entity: 'document', recordId: row!.id, actorId: ctx.memberId, payload: { documentType: 'price_setting' } });
  return row!.id;
}

export async function updatePriceSetting(db: Db, ctx: DocCtx, id: string, patch: Omit<PriceSettingInput, 'id'>): Promise<void> {
  const doc = await loadSetting(db, id, true);
  if (doc.status !== 'draft') throw new DomainError(409, 'not_draft', 'Only a draft can be edited: unpost the document first');
  const set: Partial<typeof documents.$inferInsert> = { updatedAt: new Date() };
  if (patch.date) set.date = patch.date;
  if (patch.organizationId) set.organizationId = patch.organizationId;
  if (patch.comment !== undefined) set.comment = patch.comment;
  await db.update(documents).set(set).where(eq(documents.id, id));
  if (patch.lines) await saveSettingLines(db, ctx, doc, patch.lines);
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'document.updated', entity: 'document', recordId: id, actorId: ctx.memberId, payload: { documentType: 'price_setting' } });
}

export async function priceSettingDetail(db: Db, id: string) {
  const doc = await loadSetting(db, id);
  const lines = await db
    .select({ l: priceSettingLines, name: products.name, sku: products.sku, unitCode: products.unitCode, kindName: priceKinds.name })
    .from(priceSettingLines)
    .innerJoin(products, eq(products.id, priceSettingLines.productId))
    .innerJoin(priceKinds, eq(priceKinds.id, priceSettingLines.priceKindId))
    .where(eq(priceSettingLines.documentId, id))
    .orderBy(asc(priceSettingLines.sortOrder));
  return { ...doc, lines: lines.map(r => ({ ...r.l, productName: r.name, sku: r.sku, unitCode: r.unitCode, priceKindName: r.kindName })) };
}

export async function listPriceSettings(db: Db, workspaceId: string, p: { status?: string[] | undefined; limit: number; offset: number }) {
  const conds = [eq(documents.workspaceId, workspaceId), eq(documents.type, 'price_setting'), p.status?.length ? inArray(documents.status, p.status as ('draft' | 'posted' | 'cancelled')[]) : undefined];
  const rows = await db
    .select({ d: documents, n: sql<number>`(select count(*)::int from price_setting_lines l where l.document_id = documents.id)` })
    .from(documents)
    .where(and(...conds))
    .orderBy(desc(documents.date), desc(documents.createdAt))
    .limit(p.limit)
    .offset(p.offset);
  const [count] = await db.select({ n: sql<number>`count(*)::int` }).from(documents).where(and(...conds));
  return { items: rows.map(r => ({ id: r.d.id, number: r.d.number, date: r.d.date, status: r.d.status, comment: r.d.comment, lineCount: r.n })), total: Number(count?.n ?? 0) };
}

/** Товары для заполнения: активные, не в архиве, не операции; категория — с подкатегориями */
async function fillProducts(db: Db, workspaceId: string, categoryId: string | null | undefined): Promise<string[]> {
  const cat = categoryId ? sql`and p.category_id in (select c.id from product_categories c, product_categories r where r.id = ${categoryId} and (c.path = r.path or c.path like r.path || '/%'))` : sql``;
  const rows = await db.execute<{ id: string }>(sql`select p.id from products p where p.workspace_id = ${workspaceId} and p.archived_at is null and p.is_active and p.kind <> 'operation' ${cat} order by p.name limit 5000`);
  return rows.map(r => r.id);
}

async function assertKinds(db: Db, ids: string[]): Promise<Map<string, PriceKindRow>> {
  const rows = await db.select().from(priceKinds).where(inArray(priceKinds.id, ids));
  if (rows.length !== new Set(ids).size) throw new DomainError(422, 'invalid_reference', 'The price kind does not exist');
  const arch = rows.find(r => r.archivedAt);
  if (arch) throw new DomainError(422, 'price_kind_archived', `The price kind “${arch.name}” is archived`);
  return new Map(rows.map(r => [r.id, r]));
}

/** Заполнение: по всем, по категории (текущие цены видов) или из поступления (цены строк). Существующие пары не затираются */
export async function fillPriceSetting(db: Db, ctx: DocCtx, id: string, f: { mode: 'all' | 'category' | 'receipt'; priceKindIds: string[]; categoryId?: string | null | undefined; receiptId?: string | null | undefined }): Promise<void> {
  const doc = await loadSetting(db, id, true);
  if (doc.status !== 'draft') throw new DomainError(409, 'not_draft', 'Only a draft can be edited: unpost the document first');
  await assertKinds(db, f.priceKindIds);
  const exist = await db.select({ productId: priceSettingLines.productId, priceKindId: priceSettingLines.priceKindId }).from(priceSettingLines).where(eq(priceSettingLines.documentId, id));
  const have = new Set(exist.map(e => `${e.productId}|${e.priceKindId}`));
  const add: { productId: string; priceKindId: string; price: string }[] = [];
  if (f.mode === 'receipt') {
    if (!f.receiptId) throw new DomainError(422, 'receipt_required', 'Select the receipt');
    const [r] = await db.select({ type: documents.type }).from(documents).where(eq(documents.id, f.receiptId)).limit(1);
    if (r?.type !== 'receipt') throw new DomainError(422, 'invalid_reference', 'The document is not a receipt');
    const lines = await db.select({ productId: documentLines.productId, price: documentLines.price }).from(documentLines).where(eq(documentLines.documentId, f.receiptId));
    for (const k of f.priceKindIds) for (const l of lines) add.push({ productId: l.productId, priceKindId: k, price: l.price });
  } else {
    if (f.mode === 'category' && !f.categoryId) throw new DomainError(422, 'category_required', 'Select the category');
    const ids = await fillProducts(db, ctx.workspaceId, f.mode === 'category' ? f.categoryId : null);
    for (const k of f.priceKindIds) {
      const res = await resolvePrices(db, ctx.workspaceId, k, ids, doc.date);
      for (const pid of ids) add.push({ productId: pid, priceKindId: k, price: res.get(pid)?.price ?? '0.00' });
    }
  }
  const fresh = add.filter(a => {
    const key = `${a.productId}|${a.priceKindId}`;
    if (have.has(key)) return false;
    have.add(key);
    return true;
  });
  const base = exist.length;
  for (let i = 0; i < fresh.length; i += 500) {
    await db.insert(priceSettingLines).values(fresh.slice(i, i + 500).map((a, j) => ({ workspaceId: ctx.workspaceId, documentId: id, sortOrder: base + i + j, productId: a.productId, priceKindId: a.priceKindId, price: fmt(dec(a.price), 2) })));
  }
  await db.update(documents).set({ updatedAt: new Date() }).where(eq(documents.id, id));
}

/** Массовое изменение строк черновика */
export async function massChangePriceSetting(
  db: Db,
  ctx: DocCtx,
  id: string,
  m: { action: 'percent' | 'round' | 'rule'; percent?: string | undefined; roundingStep?: string | undefined; roundingMode?: 'math' | 'up' | undefined; roundToNine?: boolean | undefined; priceKindIds?: string[] | undefined },
): Promise<{ changed: number }> {
  const doc = await loadSetting(db, id, true);
  if (doc.status !== 'draft') throw new DomainError(409, 'not_draft', 'Only a draft can be edited: unpost the document first');
  const lines = await db.select().from(priceSettingLines).where(eq(priceSettingLines.documentId, id));
  const target = lines.filter(l => !m.priceKindIds?.length || m.priceKindIds.includes(l.priceKindId));
  const kinds = new Map((await db.select().from(priceKinds).where(eq(priceKinds.workspaceId, ctx.workspaceId))).map(k => [k.id, k]));
  const rule: RoundingRule = { step: m.roundingStep ?? '0.01', mode: m.roundingMode ?? 'math', nine: m.roundToNine ?? false };
  if (m.action !== 'rule' && rule.nine && !nineAllowed(rule.step)) throw new DomainError(422, 'price_nine_step', 'The "up to 9" rounding needs a step of 10 or 100');
  const next = new Map<string, string>();
  if (m.action === 'percent') {
    if (m.percent === undefined) throw new DomainError(422, 'percent_required', 'Enter the percent');
    for (const l of target) next.set(l.id, priceStr(applyMarkup(dec(l.price), m.percent, rule)));
  } else if (m.action === 'round') {
    for (const l of target) next.set(l.id, priceStr(roundPrice(dec(l.price), rule)));
  } else {
    // расчёт по правилу вида: только расчётные виды, ручная запись не учитывается
    const byKind = new Map<string, typeof lines>();
    for (const l of target) if (kinds.get(l.priceKindId)?.method !== 'manual') byKind.set(l.priceKindId, [...(byKind.get(l.priceKindId) ?? []), l]);
    for (const [kid, ls] of byKind) {
      const res = await resolvePrices(db, ctx.workspaceId, kid, ls.map(l => l.productId), doc.date, { skipManualOf: kid });
      for (const l of ls) {
        const p = res.get(l.productId)?.price;
        if (p !== null && p !== undefined) next.set(l.id, p);
      }
    }
  }
  for (const [lid, price] of next) await db.update(priceSettingLines).set({ price }).where(eq(priceSettingLines.id, lid));
  await db.update(documents).set({ updatedAt: new Date() }).where(eq(documents.id, id));
  return { changed: next.size };
}

DOCUMENT_HOOKS.price_setting = {
  check: async (db, _ctx, doc) => {
    const lines = await db.select().from(priceSettingLines).where(eq(priceSettingLines.documentId, doc.id));
    if (!lines.length) throw new DomainError(422, 'no_lines', 'Add at least one line before posting');
    const kinds = await assertKinds(db, [...new Set(lines.map(l => l.priceKindId))]);
    for (const l of lines) if (dec(l.price) < 0n || !kinds.has(l.priceKindId)) throw new DomainError(422, 'invalid_amount', 'The price must not be negative');
  },
  post: async (db, ctx, doc) => {
    const lines = await db.select().from(priceSettingLines).where(eq(priceSettingLines.documentId, doc.id)).orderBy(asc(priceSettingLines.sortOrder));
    await db.delete(productPrices).where(eq(productPrices.documentId, doc.id));
    // цена до установки: действующая на дату документа (до записи новых строк)
    const byKind = new Map<string, string[]>();
    for (const l of lines) byKind.set(l.priceKindId, [...(byKind.get(l.priceKindId) ?? []), l.productId]);
    const old = new Map<string, string | null>();
    for (const [kid, pids] of byKind) {
      const res = await resolvePrices(db, ctx.workspaceId, kid, pids, doc.date);
      for (const pid of pids) old.set(`${kid}|${pid}`, res.get(pid)?.price ?? null);
    }
    for (const l of lines) await db.update(priceSettingLines).set({ oldPrice: old.get(`${l.priceKindId}|${l.productId}`) ?? null }).where(eq(priceSettingLines.id, l.id));
    for (let i = 0; i < lines.length; i += 500) {
      await db.insert(productPrices).values(lines.slice(i, i + 500).map(l => ({ workspaceId: ctx.workspaceId, priceKindId: l.priceKindId, productId: l.productId, date: doc.date, price: l.price, documentId: doc.id, lineId: l.id })));
    }
    await refreshPriceCache(db, ctx.workspaceId, lines.map(l => l.productId));
  },
  afterPost: async (db, ctx, doc) => {
    await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'document.price_setting_posted', entity: 'document', recordId: doc.id, actorId: ctx.memberId, payload: { documentType: 'price_setting' } });
  },
  afterUnpost: async (db, ctx, doc) => {
    const rows = await db.delete(productPrices).where(eq(productPrices.documentId, doc.id)).returning({ productId: productPrices.productId });
    await refreshPriceCache(db, ctx.workspaceId, rows.map(r => r.productId));
  },
};

/* ---------------- поступление как источник цен ---------------- */

/** Виды, которые поступление обновляет: вид цен поставщика этого контрагента и «Закупочная» — если у них включено «обновлять из поступлений» */
const receiptKinds = async (db: Db, doc: DocRow): Promise<PriceKindRow[]> => {
  const rows = await db.select().from(priceKinds).where(and(eq(priceKinds.workspaceId, doc.workspaceId), eq(priceKinds.updateFromReceipts, true), isNull(priceKinds.archivedAt)));
  return rows.filter(k => k.systemKey === 'purchase' || (k.supplierId !== null && k.supplierId === doc.counterpartyId));
};

const prevReceiptHook = DOCUMENT_HOOKS.receipt;
DOCUMENT_HOOKS.receipt = {
  ...prevReceiptHook,
  afterPost: async (db, ctx, doc, lines) => {
    await prevReceiptHook?.afterPost?.(db, ctx, doc, lines);
    const kinds = await receiptKinds(db, doc);
    if (!kinds.length) return;
    const goods = lines.filter(l => dec(l.price) > 0n);
    for (const k of kinds) {
      await db.delete(productPrices).where(and(eq(productPrices.documentId, doc.id), eq(productPrices.priceKindId, k.id)));
      if (goods.length) await db.insert(productPrices).values(goods.map(l => ({ workspaceId: ctx.workspaceId, priceKindId: k.id, productId: l.productId, date: doc.date, price: l.price, documentId: doc.id, lineId: l.id })));
    }
    if (kinds.some(k => k.systemKey)) await refreshPriceCache(db, ctx.workspaceId, goods.map(l => l.productId));
  },
  afterUnpost: async (db, ctx, doc, lines) => {
    await prevReceiptHook?.afterUnpost?.(db, ctx, doc, lines);
    const rows = await db.delete(productPrices).where(eq(productPrices.documentId, doc.id)).returning({ productId: productPrices.productId });
    if (rows.length) await refreshPriceCache(db, ctx.workspaceId, rows.map(r => r.productId));
  },
};

/* ---------------- прайс-лист ---------------- */

export interface PriceListQuery {
  kindIds?: string[] | undefined;
  categoryId?: string | undefined;
  /** Несколько категорий (публичная ссылка): объединение поддеревьев */
  categoryIds?: string[] | undefined;
  date?: string | undefined;
  inStock?: boolean | undefined;
  q?: string | undefined;
  limit: number;
  offset: number;
}

export interface PriceListRow {
  productId: string;
  sku: string;
  name: string;
  unit: string;
  categoryId: string | null;
  categoryName: string | null;
  prices: Record<string, string | null>;
  stockQty: string;
}

/** Строки прайс-листа: товары и услуги с ценами выбранных видов на дату. Видимость видов решает вызывающий (kinds передаются готовыми) */
export async function priceListRows(db: Db, workspaceId: string, kinds: PriceKindRow[], q: PriceListQuery): Promise<{ rows: PriceListRow[]; total: number }> {
  const date = q.date ?? today();
  const cats = q.categoryIds?.length ? q.categoryIds : q.categoryId ? [q.categoryId] : [];
  const catCond = cats.length
    ? sql`and p.category_id in (select c.id from product_categories c join product_categories r on (c.path = r.path or c.path like r.path || '/%') where r.id in ${sql`(${sql.join(cats.map(c => sql`${c}::uuid`), sql`, `)})`})`
    : sql``;
  const search = q.q ? sql`and (p.name ilike ${'%' + q.q.replace(/[\\%_]/g, m => '\\' + m) + '%'} or p.sku ilike ${'%' + q.q.replace(/[\\%_]/g, m => '\\' + m) + '%'})` : sql``;
  const stock = q.inStock ? sql`and (p.kind <> 'goods' or coalesce((select sum(b.qty) from stock_balances b where b.product_id = p.id), 0) > 0)` : sql``;
  const where = sql`p.workspace_id = ${workspaceId} and p.archived_at is null and p.is_active and p.kind in ('goods','service','work') ${catCond} ${search} ${stock}`;
  const [{ n }] = (await db.execute<{ n: number }>(sql`select count(*)::int as n from products p where ${where}`)) as { n: number }[];
  const list = await db.execute<{ id: string; sku: string; name: string; unit_code: string; category_id: string | null; category_name: string | null; qty: string }>(sql`
    select p.id, p.sku, p.name, p.unit_code, p.category_id, c.name as category_name,
      coalesce((select sum(b.qty) from stock_balances b where b.product_id = p.id), 0)::text as qty
    from products p left join product_categories c on c.id = p.category_id
    where ${where} order by c.name nulls first, p.name limit ${q.limit} offset ${q.offset}`);
  const ids = list.map(r => r.id);
  const symbols = new Map((await db.select({ code: units.code, symbol: units.symbol }).from(units).where(eq(units.workspaceId, workspaceId))).map(u => [u.code, u.symbol]));
  const perKind = new Map<string, Map<string, ResolvedPrice>>();
  for (const k of kinds) perKind.set(k.id, await resolvePrices(db, workspaceId, k.id, ids, date));
  return {
    total: Number(n),
    rows: list.map(r => ({
      productId: r.id,
      sku: r.sku,
      name: r.name,
      unit: symbols.get(r.unit_code) ?? '',
      categoryId: r.category_id,
      categoryName: r.category_name,
      prices: Object.fromEntries(kinds.map(k => [k.id, perKind.get(k.id)!.get(r.id)?.price ?? null])),
      stockQty: r.qty,
    })),
  };
}

/** Виды для прайс-листа: выбранные и видимые; пустой выбор — «Розничная» */
export async function priceListKinds(db: Db, workspaceId: string, kindIds: string[] | undefined, canSeeCost: boolean): Promise<PriceKindRow[]> {
  const visible = await listPriceKinds(db, workspaceId, { canSeeCost });
  if (!kindIds?.length) return visible.filter(k => k.systemKey === 'retail');
  return visible.filter(k => kindIds.includes(k.id));
}

/* ---------------- загрузка цен из таблицы ---------------- */

export interface ImportRowIn {
  rowNo: number;
  sku: string;
  name: string;
  prices: { priceKindId: string; price: string }[];
}
export interface ImportRowOut extends ImportRowIn {
  productId: string | null;
  productName: string | null;
  matchedBy: 'sku' | 'name' | null;
  lines: { priceKindId: string; price: string; current: string | null }[];
}

/** Сопоставление строк файла с товарами: по артикулу (без учёта регистра), затем по точному названию. Неоднозначное название — без совпадения */
export async function matchImportRows(db: Db, workspaceId: string, rows: ImportRowIn[], date: string): Promise<ImportRowOut[]> {
  const all = await db.select({ id: products.id, sku: products.sku, name: products.name }).from(products).where(and(eq(products.workspaceId, workspaceId), isNull(products.archivedAt)));
  const bySku = new Map<string, { id: string; name: string }>();
  const byName = new Map<string, { id: string; name: string }[]>();
  for (const p of all) {
    if (p.sku) bySku.set(p.sku.trim().toLowerCase(), p);
    const key = p.name.trim().toLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), p]);
  }
  const out: ImportRowOut[] = [];
  for (const r of rows) {
    let hit: { id: string; name: string } | undefined;
    let by: 'sku' | 'name' | null = null;
    if (r.sku) {
      hit = bySku.get(r.sku.trim().toLowerCase());
      if (hit) by = 'sku';
    }
    if (!hit && r.name) {
      const list = byName.get(r.name.trim().toLowerCase());
      if (list?.length === 1) (hit = list[0]), (by = 'name');
    }
    out.push({ ...r, productId: hit?.id ?? null, productName: hit?.name ?? null, matchedBy: by, lines: [] });
  }
  const kindIds = [...new Set(rows.flatMap(r => r.prices.map(p => p.priceKindId)))];
  const productIds = [...new Set(out.map(o => o.productId).filter((x): x is string => !!x))];
  for (const kid of kindIds) {
    const cur = await resolvePrices(db, workspaceId, kid, productIds, date);
    for (const o of out) {
      if (!o.productId) continue;
      const p = o.prices.find(x => x.priceKindId === kid);
      if (p) o.lines.push({ priceKindId: kid, price: p.price, current: cur.get(o.productId)?.price ?? null });
    }
  }
  return out;
}

/* ---------------- публичная ссылка на прайс-лист ---------------- */

const hashSecret = (secret: string) => createHash('sha256').update(secret).digest('hex');
const publishable = (k: PriceKindRow) => !k.archivedAt && !isCostKind(k);

export interface PriceLinkInput {
  name: string;
  priceKindIds: string[];
  categoryIds: string[];
  inStockOnly: boolean;
  expiresAt?: string | null | undefined;
}

async function assertLinkInput(db: Db, workspaceId: string, input: Pick<PriceLinkInput, 'priceKindIds' | 'categoryIds'>): Promise<void> {
  const kinds = await db.select().from(priceKinds).where(and(eq(priceKinds.workspaceId, workspaceId), inArray(priceKinds.id, input.priceKindIds)));
  if (kinds.length !== new Set(input.priceKindIds).size) throw new DomainError(422, 'invalid_reference', 'The price kind does not exist');
  const bad = kinds.find(k => !publishable(k));
  if (bad) throw new DomainError(422, 'price_kind_not_public', `The price kind “${bad.name}” cannot be published: purchase prices and costs stay private`);
  if (input.categoryIds.length) {
    const cats = await db.select({ id: productCategories.id }).from(productCategories).where(inArray(productCategories.id, input.categoryIds));
    if (cats.length !== new Set(input.categoryIds).size) throw new DomainError(422, 'invalid_reference', 'The category does not exist');
  }
}

/** Создаёт ссылку. Секрет виден один раз (в базе — только хэш): токен `<workspace_id>.<секрет>` */
export async function createPriceLink(db: Db, ctx: DocCtx, input: PriceLinkInput): Promise<{ id: string; token: string }> {
  await assertLinkInput(db, ctx.workspaceId, input);
  const secret = randomBytes(24).toString('base64url');
  const [row] = await db
    .insert(priceListLinks)
    .values({ workspaceId: ctx.workspaceId, name: input.name.trim(), tokenHash: hashSecret(secret), priceKindIds: input.priceKindIds, categoryIds: input.categoryIds, inStockOnly: input.inStockOnly, expiresAt: input.expiresAt ?? null, createdBy: ctx.memberId })
    .returning({ id: priceListLinks.id });
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'price_list_link.created', entity: 'price_list_link', recordId: row!.id, actorId: ctx.memberId, payload: { name: input.name } });
  return { id: row!.id, token: `${ctx.workspaceId}.${secret}` };
}

export async function listPriceLinks(db: Db, workspaceId: string) {
  const rows = await db.select().from(priceListLinks).where(eq(priceListLinks.workspaceId, workspaceId)).orderBy(desc(priceListLinks.createdAt));
  return rows.map(({ tokenHash: _h, ...r }) => r);
}

export async function updatePriceLink(db: Db, ctx: DocCtx, id: string, patch: Partial<PriceLinkInput>): Promise<void> {
  const [cur] = await db.select().from(priceListLinks).where(eq(priceListLinks.id, id)).limit(1);
  if (!cur) throw new DomainError(404, 'not_found', 'link not found');
  const kindIds = patch.priceKindIds ?? cur.priceKindIds;
  const categoryIds = patch.categoryIds ?? cur.categoryIds;
  await assertLinkInput(db, ctx.workspaceId, { priceKindIds: kindIds, categoryIds });
  await db
    .update(priceListLinks)
    .set({ ...(patch.name !== undefined ? { name: patch.name.trim() } : {}), priceKindIds: kindIds, categoryIds, ...(patch.inStockOnly !== undefined ? { inStockOnly: patch.inStockOnly } : {}), ...(patch.expiresAt !== undefined ? { expiresAt: patch.expiresAt } : {}), updatedAt: new Date() })
    .where(eq(priceListLinks.id, id));
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'price_list_link.updated', entity: 'price_list_link', recordId: id, actorId: ctx.memberId, payload: {} });
}

/** Отзыв ссылки: страница сразу перестаёт открываться */
export async function revokePriceLink(db: Db, ctx: DocCtx, id: string): Promise<void> {
  const rows = await db.update(priceListLinks).set({ revokedAt: new Date(), updatedAt: new Date() }).where(and(eq(priceListLinks.id, id), isNull(priceListLinks.revokedAt))).returning({ id: priceListLinks.id });
  if (!rows.length) throw new DomainError(404, 'not_found', 'link not found');
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'price_list_link.revoked', entity: 'price_list_link', recordId: id, actorId: ctx.memberId, payload: {} });
}

export function parsePriceToken(token: string): { workspaceId: string; secret: string } | null {
  const m = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([A-Za-z0-9_-]{16,64})$/i.exec(token);
  return m ? { workspaceId: m[1]!.toLowerCase(), secret: m[2]! } : null;
}

/** Публичные данные прайс-листа по секрету: только разрешённое — название организации, публикуемые виды, товары, цены и признак наличия.
    Закупочные, расчётные от себестоимости и цены поставщиков отсеиваются и здесь (вид мог быть изменён после создания ссылки). Любая причина отказа — null */
export async function publicPriceList(db: Db, workspaceId: string, secret: string, q: { q?: string | undefined; limit: number; offset: number }) {
  const [link] = await db.select().from(priceListLinks).where(and(eq(priceListLinks.workspaceId, workspaceId), eq(priceListLinks.tokenHash, hashSecret(secret)))).limit(1);
  if (!link || link.revokedAt) return null;
  if (link.expiresAt && link.expiresAt < today()) return null;
  const kinds = (await db.select().from(priceKinds).where(and(eq(priceKinds.workspaceId, workspaceId), inArray(priceKinds.id, link.priceKindIds.length ? link.priceKindIds : ['00000000-0000-0000-0000-000000000000'])))).filter(publishable);
  const [ws] = await db.select({ name: workspaces.name }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  const [org] = await db.select({ name: organizations.name }).from(organizations).where(and(eq(organizations.workspaceId, workspaceId), isNull(organizations.archivedAt))).orderBy(desc(organizations.isDefault), asc(organizations.createdAt)).limit(1);
  const list = await priceListRows(db, workspaceId, kinds, { categoryIds: link.categoryIds, inStock: link.inStockOnly, q: q.q, limit: q.limit, offset: q.offset, date: today() });
  await db.update(priceListLinks).set({ viewCount: sql`${priceListLinks.viewCount} + 1`, lastViewedAt: new Date() }).where(eq(priceListLinks.id, link.id));
  return {
    title: link.name,
    company: org?.name ?? ws?.name ?? '',
    date: today(),
    kinds: kinds.map(k => ({ id: k.id, name: k.name })),
    total: list.total,
    // остатки не раскрываются: только «есть / нет»
    items: list.rows.map(r => ({ sku: r.sku, name: r.name, unit: r.unit, category: r.categoryName, prices: r.prices, inStock: dec(r.stockQty) > 0n })),
  };
}
