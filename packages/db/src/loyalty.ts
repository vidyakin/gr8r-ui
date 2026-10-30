/* Скидки и лояльность (задача 1179): правила автоматических скидок, промокоды, карты лояльности и журнал баллов.
   Правила — docs/architecture/loyalty.md. Хуки интегрируются в общий postDocument/unpostDocument через applyLoyalty*
   (вызываются из documents.ts), а не через DOCUMENT_HOOKS — расчёт скидок и баллов общий для нескольких типов документов,
   как и повторные продажи (repeat-sales.ts). */
import { and, asc, desc, eq, inArray, isNull, lte, ne, sql } from 'drizzle-orm';
import {
  accrualPoints,
  dec,
  distributeRedemption,
  fifoExpiredPoints,
  fmt,
  redemptionLimit,
  resolveDiscountPct,
  reversalPointsForReturn,
  type DiscountCandidate,
} from '@gr8r/shared';
import type { Db } from './client';
import type { DocCtx, DocumentLineRow, DocumentRow } from './documents';
import { DomainError } from './errors';
import { recordEvent } from './events';
import {
  companies,
  discountRuleCategories,
  discountRuleCustomers,
  discountRulePriceKinds,
  discountRuleProducts,
  discountRules,
  documentLineDiscounts,
  documentLoyalty,
  documents,
  loyaltyCards,
  loyaltyPrograms,
  loyaltyTransactions,
  productCategories,
  products,
  promoCodes,
} from './schema';

/** Документы, на которых действуют автоскидки правил (план, п.2): все шесть документов продаж от КП до заказ-наряда. */
export const DISCOUNT_DOCUMENT_TYPES = ['quote', 'customer_order', 'invoice', 'realization', 'act', 'work_order'] as const;
/** Документы, на которых двигаются баллы: только продажи с окончательной суммой — отгрузка, акт, заказ-наряд.
    Счета и заказы баллы не двигают, чтобы не считать дважды при их последующей реализации. */
export const LOYALTY_SALE_TYPES = ['realization', 'act', 'work_order'] as const;
export const LOYALTY_RETURN_TYPES = ['customer_return'] as const;

/* ======================= Правила скидок ======================= */

export interface DiscountRuleInput {
  id?: string | undefined;
  name: string;
  discountPct: string;
  stackable?: boolean | undefined;
  promoOnly?: boolean | undefined;
  validFrom?: string | null | undefined;
  validTo?: string | null | undefined;
  weekdays?: number[] | undefined;
  timeFrom?: string | null | undefined;
  timeTo?: string | null | undefined;
  minDocumentAmount?: string | undefined;
  minLineQty?: string | undefined;
  customerIds?: string[] | undefined;
  priceKindIds?: string[] | undefined;
  productIds?: string[] | undefined;
  categoryIds?: string[] | undefined;
}

async function replaceRuleLinks(db: Db, workspaceId: string, ruleId: string, input: Partial<DiscountRuleInput>): Promise<void> {
  await db.delete(discountRuleCustomers).where(eq(discountRuleCustomers.ruleId, ruleId));
  await db.delete(discountRulePriceKinds).where(eq(discountRulePriceKinds.ruleId, ruleId));
  await db.delete(discountRuleProducts).where(eq(discountRuleProducts.ruleId, ruleId));
  await db.delete(discountRuleCategories).where(eq(discountRuleCategories.ruleId, ruleId));
  if (input.customerIds?.length) await db.insert(discountRuleCustomers).values(input.customerIds.map(customerId => ({ workspaceId, ruleId, customerId })));
  if (input.priceKindIds?.length) await db.insert(discountRulePriceKinds).values(input.priceKindIds.map(priceKindId => ({ workspaceId, ruleId, priceKindId })));
  if (input.productIds?.length) await db.insert(discountRuleProducts).values(input.productIds.map(productId => ({ workspaceId, ruleId, productId })));
  if (input.categoryIds?.length) await db.insert(discountRuleCategories).values(input.categoryIds.map(categoryId => ({ workspaceId, ruleId, categoryId })));
}

export async function createDiscountRule(db: Db, ctx: DocCtx, input: DiscountRuleInput): Promise<string> {
  const [row] = await db
    .insert(discountRules)
    .values({
      ...(input.id ? { id: input.id } : {}),
      workspaceId: ctx.workspaceId,
      name: input.name.trim(),
      discountPct: fmt(dec(input.discountPct), 2),
      stackable: input.stackable ?? false,
      promoOnly: input.promoOnly ?? false,
      validFrom: input.validFrom ?? null,
      validTo: input.validTo ?? null,
      weekdays: input.weekdays ?? [],
      timeFrom: input.timeFrom ?? null,
      timeTo: input.timeTo ?? null,
      minDocumentAmount: fmt(dec(input.minDocumentAmount ?? '0'), 2),
      minLineQty: input.minLineQty ?? '0',
    })
    .returning();
  await replaceRuleLinks(db, ctx.workspaceId, row!.id, input);
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'discount_rule.created', entity: 'discount_rule', recordId: row!.id, actorId: ctx.memberId, payload: { name: row!.name } });
  return row!.id;
}

export async function updateDiscountRule(db: Db, ctx: DocCtx, id: string, patch: Partial<Omit<DiscountRuleInput, 'id'>>): Promise<void> {
  const [cur] = await db.select().from(discountRules).where(eq(discountRules.id, id)).limit(1).for('update');
  if (!cur) throw new DomainError(404, 'not_found', 'discount rule not found');
  await db
    .update(discountRules)
    .set({
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.discountPct !== undefined ? { discountPct: fmt(dec(patch.discountPct), 2) } : {}),
      ...(patch.stackable !== undefined ? { stackable: patch.stackable } : {}),
      ...(patch.promoOnly !== undefined ? { promoOnly: patch.promoOnly } : {}),
      ...(patch.validFrom !== undefined ? { validFrom: patch.validFrom } : {}),
      ...(patch.validTo !== undefined ? { validTo: patch.validTo } : {}),
      ...(patch.weekdays !== undefined ? { weekdays: patch.weekdays } : {}),
      ...(patch.timeFrom !== undefined ? { timeFrom: patch.timeFrom } : {}),
      ...(patch.timeTo !== undefined ? { timeTo: patch.timeTo } : {}),
      ...(patch.minDocumentAmount !== undefined ? { minDocumentAmount: fmt(dec(patch.minDocumentAmount), 2) } : {}),
      ...(patch.minLineQty !== undefined ? { minLineQty: patch.minLineQty } : {}),
      updatedAt: new Date(),
    })
    .where(eq(discountRules.id, id));
  if (patch.customerIds !== undefined || patch.priceKindIds !== undefined || patch.productIds !== undefined || patch.categoryIds !== undefined) {
    await replaceRuleLinks(db, ctx.workspaceId, id, patch);
  }
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'discount_rule.updated', entity: 'discount_rule', recordId: id, actorId: ctx.memberId, payload: {} });
}

export async function archiveDiscountRule(db: Db, ctx: DocCtx, id: string): Promise<void> {
  const rows = await db.update(discountRules).set({ archivedAt: new Date(), updatedAt: new Date() }).where(and(eq(discountRules.id, id), isNull(discountRules.archivedAt))).returning({ id: discountRules.id });
  if (!rows.length) throw new DomainError(404, 'not_found', 'discount rule not found');
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'discount_rule.archived', entity: 'discount_rule', recordId: id, actorId: ctx.memberId, payload: {} });
}

export async function restoreDiscountRule(db: Db, ctx: DocCtx, id: string): Promise<void> {
  const rows = await db.update(discountRules).set({ archivedAt: null, updatedAt: new Date() }).where(eq(discountRules.id, id)).returning({ id: discountRules.id });
  if (!rows.length) throw new DomainError(404, 'not_found', 'discount rule not found');
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'discount_rule.restored', entity: 'discount_rule', recordId: id, actorId: ctx.memberId, payload: {} });
}

export async function listDiscountRules(db: Db, workspaceId: string, opts: { archived?: boolean } = {}) {
  const rows = await db
    .select()
    .from(discountRules)
    .where(and(eq(discountRules.workspaceId, workspaceId), opts.archived ? undefined : isNull(discountRules.archivedAt)))
    .orderBy(asc(discountRules.sortOrder), asc(discountRules.createdAt));
  return rows;
}

export async function discountRuleDetail(db: Db, id: string) {
  const [rule] = await db.select().from(discountRules).where(eq(discountRules.id, id)).limit(1);
  if (!rule) throw new DomainError(404, 'not_found', 'discount rule not found');
  const [customerIds, priceKindIds, productIds, categoryIds] = await Promise.all([
    db.select({ id: discountRuleCustomers.customerId }).from(discountRuleCustomers).where(eq(discountRuleCustomers.ruleId, id)),
    db.select({ id: discountRulePriceKinds.priceKindId }).from(discountRulePriceKinds).where(eq(discountRulePriceKinds.ruleId, id)),
    db.select({ id: discountRuleProducts.productId }).from(discountRuleProducts).where(eq(discountRuleProducts.ruleId, id)),
    db.select({ id: discountRuleCategories.categoryId }).from(discountRuleCategories).where(eq(discountRuleCategories.ruleId, id)),
  ]);
  return {
    ...rule,
    customerIds: customerIds.map(r => r.id),
    priceKindIds: priceKindIds.map(r => r.id),
    productIds: productIds.map(r => r.id),
    categoryIds: categoryIds.map(r => r.id),
  };
}

/* ======================= Промокоды ======================= */

export interface PromoCodeInput {
  id?: string | undefined;
  code: string;
  ruleId: string;
  validFrom?: string | null | undefined;
  validTo?: string | null | undefined;
  usageLimit?: number | null | undefined;
}

export async function createPromoCode(db: Db, ctx: DocCtx, input: PromoCodeInput): Promise<string> {
  const [rule] = await db.select({ id: discountRules.id }).from(discountRules).where(eq(discountRules.id, input.ruleId)).limit(1);
  if (!rule) throw new DomainError(422, 'invalid_reference', 'The discount rule does not exist');
  const [row] = await db
    .insert(promoCodes)
    .values({ ...(input.id ? { id: input.id } : {}), workspaceId: ctx.workspaceId, code: input.code.trim(), ruleId: input.ruleId, validFrom: input.validFrom ?? null, validTo: input.validTo ?? null, usageLimit: input.usageLimit ?? null })
    .returning();
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'promo_code.created', entity: 'promo_code', recordId: row!.id, actorId: ctx.memberId, payload: { code: row!.code } });
  return row!.id;
}

export async function updatePromoCode(db: Db, ctx: DocCtx, id: string, patch: Partial<Omit<PromoCodeInput, 'id'>>): Promise<void> {
  const [cur] = await db.select().from(promoCodes).where(eq(promoCodes.id, id)).limit(1);
  if (!cur) throw new DomainError(404, 'not_found', 'promo code not found');
  if (patch.ruleId) {
    const [rule] = await db.select({ id: discountRules.id }).from(discountRules).where(eq(discountRules.id, patch.ruleId)).limit(1);
    if (!rule) throw new DomainError(422, 'invalid_reference', 'The discount rule does not exist');
  }
  await db
    .update(promoCodes)
    .set({
      ...(patch.code !== undefined ? { code: patch.code.trim() } : {}),
      ...(patch.ruleId !== undefined ? { ruleId: patch.ruleId } : {}),
      ...(patch.validFrom !== undefined ? { validFrom: patch.validFrom } : {}),
      ...(patch.validTo !== undefined ? { validTo: patch.validTo } : {}),
      ...(patch.usageLimit !== undefined ? { usageLimit: patch.usageLimit } : {}),
    })
    .where(eq(promoCodes.id, id));
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'promo_code.updated', entity: 'promo_code', recordId: id, actorId: ctx.memberId, payload: {} });
}

export async function archivePromoCode(db: Db, ctx: DocCtx, id: string): Promise<void> {
  const rows = await db.update(promoCodes).set({ archivedAt: new Date() }).where(and(eq(promoCodes.id, id), isNull(promoCodes.archivedAt))).returning({ id: promoCodes.id });
  if (!rows.length) throw new DomainError(404, 'not_found', 'promo code not found');
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'promo_code.archived', entity: 'promo_code', recordId: id, actorId: ctx.memberId, payload: {} });
}

export async function listPromoCodes(db: Db, workspaceId: string, opts: { archived?: boolean } = {}) {
  return db
    .select({ p: promoCodes, ruleName: discountRules.name })
    .from(promoCodes)
    .innerJoin(discountRules, eq(discountRules.id, promoCodes.ruleId))
    .where(and(eq(promoCodes.workspaceId, workspaceId), opts.archived ? undefined : isNull(promoCodes.archivedAt)))
    .orderBy(desc(promoCodes.createdAt))
    .then(rows => rows.map(r => ({ ...r.p, ruleName: r.ruleName })));
}

/** Проверка промокода на дату: активен, в периоде действия, лимит не выбран. Не инкрементирует счётчик — это делает проведение документа */
async function validPromoCode(db: Db, workspaceId: string, code: string, date: string): Promise<(typeof promoCodes.$inferSelect) | null> {
  const [row] = await db
    .select()
    .from(promoCodes)
    .where(and(eq(promoCodes.workspaceId, workspaceId), sql`lower(${promoCodes.code}) = lower(${code})`, isNull(promoCodes.archivedAt)))
    .limit(1);
  if (!row) return null;
  if (row.validFrom && date < row.validFrom) return null;
  if (row.validTo && date > row.validTo) return null;
  if (row.usageLimit !== null && row.usageCount >= row.usageLimit) return null;
  return row;
}

/** Атомарный инкремент счётчика использования промокода при проведении; бросает ошибку, если лимит уже выбран другим документом (гонка) */
async function incrementPromoUsage(db: Db, id: string): Promise<void> {
  const rows = await db
    .update(promoCodes)
    .set({ usageCount: sql`${promoCodes.usageCount} + 1` })
    .where(and(eq(promoCodes.id, id), sql`${promoCodes.usageLimit} is null or ${promoCodes.usageCount} < ${promoCodes.usageLimit}`))
    .returning({ id: promoCodes.id });
  if (!rows.length) throw new DomainError(422, 'promo_code_exhausted', 'The promo code usage limit has just been reached: remove it or retry');
}

async function decrementPromoUsage(db: Db, id: string): Promise<void> {
  await db.update(promoCodes).set({ usageCount: sql`greatest(${promoCodes.usageCount} - 1, 0)` }).where(eq(promoCodes.id, id));
}

/* ======================= Программа и карты лояльности ======================= */

export interface LoyaltyProgramInput {
  accrualPct?: string | undefined;
  redemptionLimitPct?: string | undefined;
  expirationDays?: number | null | undefined;
  cumulativeScale?: Array<{ fromAmount: string; pct: string }> | undefined;
}

/** Настройка программы: одна строка на арендатора, создаётся при первом обращении (как ensurePriceKinds) */
export async function ensureLoyaltyProgram(db: Db, workspaceId: string) {
  const [row] = await db.select().from(loyaltyPrograms).where(eq(loyaltyPrograms.workspaceId, workspaceId)).limit(1);
  if (row) return row;
  const [created] = await db.insert(loyaltyPrograms).values({ workspaceId }).onConflictDoNothing().returning();
  if (created) return created;
  const [again] = await db.select().from(loyaltyPrograms).where(eq(loyaltyPrograms.workspaceId, workspaceId)).limit(1);
  return again!;
}

export async function updateLoyaltyProgram(db: Db, ctx: DocCtx, patch: LoyaltyProgramInput): Promise<void> {
  await ensureLoyaltyProgram(db, ctx.workspaceId);
  await db
    .update(loyaltyPrograms)
    .set({
      ...(patch.accrualPct !== undefined ? { accrualPct: fmt(dec(patch.accrualPct), 2) } : {}),
      ...(patch.redemptionLimitPct !== undefined ? { redemptionLimitPct: fmt(dec(patch.redemptionLimitPct), 2) } : {}),
      ...(patch.expirationDays !== undefined ? { expirationDays: patch.expirationDays } : {}),
      ...(patch.cumulativeScale !== undefined ? { cumulativeScale: patch.cumulativeScale } : {}),
      updatedAt: new Date(),
    })
    .where(eq(loyaltyPrograms.workspaceId, ctx.workspaceId));
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'loyalty_program.updated', entity: 'loyalty_program', recordId: ctx.workspaceId, actorId: ctx.memberId, payload: {} });
}

export interface LoyaltyCardInput {
  id?: string | undefined;
  number: string;
  customerId: string;
  kind: 'discount' | 'bonus' | 'cumulative';
  discountPct?: string | null | undefined;
  isActive?: boolean | undefined;
}

export async function createLoyaltyCard(db: Db, ctx: DocCtx, input: LoyaltyCardInput): Promise<string> {
  const [customer] = await db.select({ id: companies.id }).from(companies).where(eq(companies.id, input.customerId)).limit(1);
  if (!customer) throw new DomainError(422, 'invalid_reference', 'The customer does not exist');
  if (input.kind === 'discount' && !input.discountPct) throw new DomainError(422, 'discount_pct_required', 'Enter the discount card percent');
  const [row] = await db
    .insert(loyaltyCards)
    .values({
      ...(input.id ? { id: input.id } : {}),
      workspaceId: ctx.workspaceId,
      number: input.number.trim(),
      customerId: input.customerId,
      kind: input.kind,
      discountPct: input.kind === 'discount' ? fmt(dec(input.discountPct!), 2) : null,
      isActive: input.isActive ?? true,
    })
    .returning();
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'loyalty_card.created', entity: 'loyalty_card', recordId: row!.id, actorId: ctx.memberId, payload: { number: row!.number } });
  return row!.id;
}

export async function updateLoyaltyCard(db: Db, ctx: DocCtx, id: string, patch: Partial<Omit<LoyaltyCardInput, 'id' | 'kind' | 'customerId'>>): Promise<void> {
  const [cur] = await db.select().from(loyaltyCards).where(eq(loyaltyCards.id, id)).limit(1);
  if (!cur) throw new DomainError(404, 'not_found', 'loyalty card not found');
  await db
    .update(loyaltyCards)
    .set({
      ...(patch.number !== undefined ? { number: patch.number.trim() } : {}),
      ...(patch.discountPct !== undefined && cur.kind === 'discount' ? { discountPct: fmt(dec(patch.discountPct!), 2) } : {}),
      ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
      updatedAt: new Date(),
    })
    .where(eq(loyaltyCards.id, id));
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'loyalty_card.updated', entity: 'loyalty_card', recordId: id, actorId: ctx.memberId, payload: {} });
}

export async function archiveLoyaltyCard(db: Db, ctx: DocCtx, id: string): Promise<void> {
  const rows = await db.update(loyaltyCards).set({ archivedAt: new Date(), isActive: false, updatedAt: new Date() }).where(and(eq(loyaltyCards.id, id), isNull(loyaltyCards.archivedAt))).returning({ id: loyaltyCards.id });
  if (!rows.length) throw new DomainError(404, 'not_found', 'loyalty card not found');
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'loyalty_card.archived', entity: 'loyalty_card', recordId: id, actorId: ctx.memberId, payload: {} });
}

export async function listLoyaltyCards(db: Db, workspaceId: string, p: { customerId?: string | undefined; archived?: boolean | undefined }) {
  const conds = [eq(loyaltyCards.workspaceId, workspaceId), p.archived ? undefined : isNull(loyaltyCards.archivedAt), p.customerId ? eq(loyaltyCards.customerId, p.customerId) : undefined];
  const rows = await db
    .select({ c: loyaltyCards, customerName: companies.name })
    .from(loyaltyCards)
    .innerJoin(companies, eq(companies.id, loyaltyCards.customerId))
    .where(and(...conds))
    .orderBy(desc(loyaltyCards.createdAt));
  return rows.map(r => ({ ...r.c, customerName: r.customerName }));
}

/** Остаток баллов карты: сумма движений журнала (accrual/reversal положительные, redemption/expiration отрицательные) */
export async function loyaltyCardBalance(db: Db, cardId: string): Promise<string> {
  const [row] = await db.select({ s: sql<string>`coalesce(sum(${loyaltyTransactions.points}), 0)::text` }).from(loyaltyTransactions).where(eq(loyaltyTransactions.cardId, cardId));
  return fmt(dec(row?.s ?? '0'), 2);
}

export async function loyaltyCardDetail(db: Db, id: string) {
  const [card] = await db.select().from(loyaltyCards).where(eq(loyaltyCards.id, id)).limit(1);
  if (!card) throw new DomainError(404, 'not_found', 'loyalty card not found');
  const balance = await loyaltyCardBalance(db, id);
  const history = await db
    .select({ t: loyaltyTransactions, docNumber: documents.number })
    .from(loyaltyTransactions)
    .leftJoin(documents, eq(documents.id, loyaltyTransactions.documentId))
    .where(eq(loyaltyTransactions.cardId, id))
    .orderBy(desc(loyaltyTransactions.createdAt))
    .limit(200);
  return { ...card, balance, history: history.map(r => ({ ...r.t, docNumber: r.docNumber })) };
}

/* ======================= Выбор карты/скидки для документа ======================= */

/** discountPct существующей строки и её источник — чтобы не перезаписывать ручную скидку при автопересчёте */
export interface LineForDiscount {
  id: string;
  productId: string;
  qty: string;
  priceKindId: string | null;
}

/** Правила-кандидаты для строки документа: действуют на дату документа, подходят по дню недели/времени, сумме/количеству
    и ограничениям (клиент/вид цен/товар/категория — пустой список ограничения значит «без ограничения»).
    promoOnly-правила включаются только если указан действующий промокод этого правила. */
export async function candidateRulesForLine(
  db: Db,
  workspaceId: string,
  p: { date: string; time: string; customerId: string | null; documentNetTotal: string; line: LineForDiscount; promoRuleId: string | null },
): Promise<DiscountCandidate[]> {
  const weekday = ((new Date(p.date + 'T00:00:00Z').getUTCDay() + 6) % 7) + 1; // 1=понедельник..7=воскресенье
  const rules = await db.select().from(discountRules).where(and(eq(discountRules.workspaceId, workspaceId), isNull(discountRules.archivedAt)));
  const qualifying = rules.filter(r => {
    if (r.validFrom && p.date < r.validFrom) return false;
    if (r.validTo && p.date > r.validTo) return false;
    if (r.weekdays.length && !r.weekdays.includes(weekday)) return false;
    if (r.timeFrom && r.timeTo && (p.time < r.timeFrom || p.time > r.timeTo)) return false;
    if (dec(p.documentNetTotal) < dec(r.minDocumentAmount)) return false;
    if (dec(p.line.qty) < dec(r.minLineQty)) return false;
    if (r.promoOnly && r.id !== p.promoRuleId) return false;
    return true;
  });
  if (!qualifying.length) return [];
  const ids = qualifying.map(r => r.id);
  const [custLinks, kindLinks, prodLinks, catLinks] = await Promise.all([
    db.select().from(discountRuleCustomers).where(inArray(discountRuleCustomers.ruleId, ids)),
    db.select().from(discountRulePriceKinds).where(inArray(discountRulePriceKinds.ruleId, ids)),
    db.select().from(discountRuleProducts).where(inArray(discountRuleProducts.ruleId, ids)),
    db.select().from(discountRuleCategories).where(inArray(discountRuleCategories.ruleId, ids)),
  ]);
  const byRule = <T extends { ruleId: string }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) m.set(r.ruleId, [...(m.get(r.ruleId) ?? []), r]);
    return m;
  };
  const custByRule = byRule(custLinks);
  const kindByRule = byRule(kindLinks);
  const prodByRule = byRule(prodLinks);
  const catByRule = byRule(catLinks);
  let lineCategoryId: string | null = null;
  const needCategory = catLinks.length > 0;
  if (needCategory) {
    const [prod] = await db.select({ categoryId: products.categoryId }).from(products).where(eq(products.id, p.line.productId)).limit(1);
    lineCategoryId = prod?.categoryId ?? null;
  }
  let categoryPath: string | null = null;
  if (needCategory && lineCategoryId) {
    const [cat] = await db.select({ path: productCategories.path }).from(productCategories).where(eq(productCategories.id, lineCategoryId)).limit(1);
    categoryPath = cat?.path ?? null;
  }
  const catPaths = needCategory && catLinks.length ? new Map((await db.select({ id: productCategories.id, path: productCategories.path }).from(productCategories).where(inArray(productCategories.id, [...new Set(catLinks.map(c => c.categoryId))]))).map(c => [c.id, c.path])) : new Map<string, string>();
  const out: DiscountCandidate[] = [];
  for (const r of qualifying) {
    const custs = custByRule.get(r.id);
    if (custs?.length && (!p.customerId || !custs.some(c => c.customerId === p.customerId))) continue;
    const kinds = kindByRule.get(r.id);
    if (kinds?.length && (!p.line.priceKindId || !kinds.some(k => k.priceKindId === p.line.priceKindId))) continue;
    const prods = prodByRule.get(r.id);
    if (prods?.length && !prods.some(x => x.productId === p.line.productId)) continue;
    const cats = catByRule.get(r.id);
    if (cats?.length) {
      if (!categoryPath) continue;
      const matches = cats.some(c => {
        const path = catPaths.get(c.categoryId);
        return path && (categoryPath === path || categoryPath!.startsWith(path + '/'));
      });
      if (!matches) continue;
    }
    out.push({ ruleId: r.id, discountPct: r.discountPct, stackable: r.stackable });
  }
  return out;
}

/** Применение автоматических скидок к строкам документа: для каждой строки считает процент из правил (+ промокод) и пишет его
    в document_lines.discount_pct и document_line_discounts (источник 'rule'). Строки с ручной скидкой (source='manual') не трогает —
    их должна отфильтровать вызывающая сторона до вызова (см. applyAutoDiscountsOnSave, которая это делает).
    Возвращает применённые проценты по строкам — вызывающая сторона (документ-сервис) должна пересчитать суммы через computeLine. */
export async function autoDiscountForLines(
  db: Db,
  workspaceId: string,
  p: { date: string; time?: string | undefined; customerId: string | null; documentNetTotal: string; promoCode?: string | null | undefined; lines: LineForDiscount[] },
): Promise<{ promoRuleId: string | null; byLine: Map<string, { pct: string; ruleId: string | null }> }> {
  const promoRule = p.promoCode ? await validPromoCode(db, workspaceId, p.promoCode, p.date) : null;
  if (p.promoCode && !promoRule) throw new DomainError(422, 'invalid_promo_code', 'The promo code is invalid, expired, or its usage limit is reached');
  const time = p.time ?? '12:00:00';
  const byLine = new Map<string, { pct: string; ruleId: string | null }>();
  for (const line of p.lines) {
    const candidates = await candidateRulesForLine(db, workspaceId, { date: p.date, time, customerId: p.customerId, documentNetTotal: p.documentNetTotal, line, promoRuleId: promoRule?.ruleId ?? null });
    const resolved = resolveDiscountPct(candidates);
    byLine.set(line.id, { pct: resolved.pct, ruleId: resolved.primaryRuleId });
  }
  return { promoRuleId: promoRule?.ruleId ?? null, byLine };
}

/** Записывает источник скидки строки (правило применилось) — используется после автоподстановки, когда шапка документа сохраняет строки */
export async function saveLineDiscountSources(db: Db, workspaceId: string, entries: { lineId: string; source: 'manual' | 'rule'; ruleId: string | null }[]): Promise<void> {
  if (!entries.length) return;
  await db.delete(documentLineDiscounts).where(inArray(documentLineDiscounts.lineId, entries.map(e => e.lineId)));
  await db.insert(documentLineDiscounts).values(entries.map(e => ({ workspaceId, lineId: e.lineId, source: e.source, ruleId: e.ruleId })));
}

/** Источники скидок строк документа (manual/rule) из document_line_discounts; строки без записи считаются 'manual'
    (скидка задана пользователем вручную при создании строки и ещё не пересчитывалась автоматикой). */
async function lineDiscountSources(db: Db, lineIds: string[]): Promise<Map<string, 'manual' | 'rule'>> {
  if (!lineIds.length) return new Map();
  const rows = await db.select({ lineId: documentLineDiscounts.lineId, source: documentLineDiscounts.source }).from(documentLineDiscounts).where(inArray(documentLineDiscounts.lineId, lineIds));
  return new Map(rows.map(r => [r.lineId, r.source]));
}

/** Автопересчёт скидок правил по строкам документа (план, п.2): применяется и при сохранении черновика, и по кнопке
    «Пересчитать скидки» (recalcDocumentDiscounts в documents.ts). Строки с ранее поставленной ручной скидкой
    (document_line_discounts.source = 'manual') не трогает — их процент и источник остаются как есть.
    Возвращает проценты только для строк, которые пересчитаны правилами, — чтобы вызывающая сторона обновила document_lines. */
export async function applyAutoDiscountsOnSave(
  db: Db,
  workspaceId: string,
  p: { date: string; time?: string | undefined; customerId: string | null; documentNetTotal: string; promoCode?: string | null | undefined; lines: LineForDiscount[] },
): Promise<{ promoRuleId: string | null; byLine: Map<string, { pct: string; ruleId: string | null }> }> {
  const sources = await lineDiscountSources(db, p.lines.map(l => l.id));
  const autoLines = p.lines.filter(l => sources.get(l.id) !== 'manual');
  if (!autoLines.length) return { promoRuleId: null, byLine: new Map() };
  const r = await autoDiscountForLines(db, workspaceId, { ...p, lines: autoLines });
  for (const lineId of r.byLine.keys()) if (sources.get(lineId) === 'manual') r.byLine.delete(lineId);
  return r;
}

/* ======================= Лояльность документа: списание и начисление при проведении ======================= */

export interface DocumentLoyaltyInput {
  promoCodeId?: string | null | undefined;
  loyaltyCardId?: string | null | undefined;
  pointsRedeemed?: string | undefined;
}

/** Сохранение выбора карты/промокода на черновике документа (до проведения) — отдельная таблица 1:1 с documents */
export async function saveDocumentLoyalty(db: Db, workspaceId: string, documentId: string, input: DocumentLoyaltyInput): Promise<void> {
  const hasAny = input.promoCodeId !== undefined || input.loyaltyCardId !== undefined || input.pointsRedeemed !== undefined;
  if (!hasAny) return;
  const [cur] = await db.select().from(documentLoyalty).where(eq(documentLoyalty.documentId, documentId)).limit(1);
  const next = {
    promoCodeId: input.promoCodeId !== undefined ? input.promoCodeId : cur?.promoCodeId ?? null,
    loyaltyCardId: input.loyaltyCardId !== undefined ? input.loyaltyCardId : cur?.loyaltyCardId ?? null,
    pointsRedeemed: input.pointsRedeemed !== undefined ? fmt(dec(input.pointsRedeemed), 2) : cur?.pointsRedeemed ?? '0.00',
  };
  await db
    .insert(documentLoyalty)
    .values({ documentId, workspaceId, ...next })
    .onConflictDoUpdate({ target: documentLoyalty.documentId, set: next });
}

export async function documentLoyaltyOf(db: Db, documentId: string) {
  const [row] = await db.select().from(documentLoyalty).where(eq(documentLoyalty.documentId, documentId)).limit(1);
  return row ?? null;
}

/** Применяется из postDocument (documents.ts) после записи статуса 'posted', для типов LOYALTY_SALE_TYPES:
    списывает баллы карты (регистрирует движение redemption) и начисляет баллы по программе (движение accrual).
    Промокод — инкремент счётчика использования. Все суммы — в рублях документа (total c НДС), 1 балл = 1 ₽. */
export async function applyLoyaltyOnPost(db: Db, ctx: DocCtx, doc: DocumentRow, lines: DocumentLineRow[]): Promise<void> {
  const dl = await documentLoyaltyOf(db, doc.id);
  if (dl?.promoCodeId) await incrementPromoUsage(db, dl.promoCodeId);
  if (!dl?.loyaltyCardId) return;
  const [card] = await db.select().from(loyaltyCards).where(eq(loyaltyCards.id, dl.loyaltyCardId)).limit(1);
  if (!card || !card.isActive) throw new DomainError(422, 'loyalty_card_inactive', 'The loyalty card is not active');
  const program = await ensureLoyaltyProgram(db, ctx.workspaceId);
  const docTotal = doc.total ?? '0.00';
  let pointsToRedeem = dec(dl.pointsRedeemed) > 0n ? dl.pointsRedeemed : '0.00';
  if (card.kind === 'bonus' && dec(pointsToRedeem) > 0n) {
    const limit = redemptionLimit(docTotal, program.redemptionLimitPct);
    const balance = await loyaltyCardBalance(db, card.id);
    const capped = [dec(pointsToRedeem), dec(limit), dec(balance)].reduce((a, b) => (b < a ? b : a));
    pointsToRedeem = fmt(capped, 2);
    if (dec(pointsToRedeem) > 0n) {
      await db.insert(loyaltyTransactions).values({ workspaceId: ctx.workspaceId, cardId: card.id, documentId: doc.id, kind: 'redemption', points: fmt(-dec(pointsToRedeem), 2), comment: `Списание по документу ${doc.number ?? doc.id}` });
      if (pointsToRedeem !== dl.pointsRedeemed) await db.update(documentLoyalty).set({ pointsRedeemed: pointsToRedeem }).where(eq(documentLoyalty.documentId, doc.id));
      // распределение по строкам — для отчётности (не меняет суммы строк, скидка уже учтена в discount_pct)
      void distributeRedemption(lines.map(l => ({ id: l.id, total: l.total })), pointsToRedeem);
    }
  }
  if (card.kind === 'bonus') {
    const accrual = accrualPoints(docTotal, pointsToRedeem, program.accrualPct);
    if (dec(accrual) > 0n) {
      const expiresAt = program.expirationDays ? new Date(Date.now() + program.expirationDays * 86400000) : null;
      await db.insert(loyaltyTransactions).values({ workspaceId: ctx.workspaceId, cardId: card.id, documentId: doc.id, kind: 'accrual', points: accrual, expiresAt, comment: `Начисление по документу ${doc.number ?? doc.id}` });
    }
  }
}

/** Применяется из unpostDocument: сторнирует движения по документу (новое движение reversal на ту же сумму с обратным знаком),
    возвращает счётчик промокода. История не удаляется — остаток возвращается встречным движением. */
export async function reverseLoyaltyOnUnpost(db: Db, ctx: DocCtx, doc: DocumentRow): Promise<void> {
  const dl = await documentLoyaltyOf(db, doc.id);
  if (dl?.promoCodeId) await decrementPromoUsage(db, dl.promoCodeId);
  if (!dl?.loyaltyCardId) return;
  const txs = await db.select().from(loyaltyTransactions).where(and(eq(loyaltyTransactions.documentId, doc.id), ne(loyaltyTransactions.kind, 'reversal')));
  for (const tx of txs) {
    await db.insert(loyaltyTransactions).values({ workspaceId: ctx.workspaceId, cardId: tx.cardId, documentId: doc.id, kind: 'reversal', points: fmt(-dec(tx.points), 2), reversesId: tx.id, comment: `Отмена проведения документа ${doc.number ?? doc.id}` });
  }
}

/** Возврат от покупателя (customer_return): частичное сторно баллов, начисленных по исходной отгрузке/акту, пропорционально
    возвращаемой сумме. Карта берётся с исходного документа (document_loyalty исходного документа). sourceDocId — basedOnId возврата. */
export async function applyLoyaltyOnReturn(db: Db, ctx: DocCtx, returnDoc: DocumentRow, sourceDocId: string): Promise<void> {
  const dl = await documentLoyaltyOf(db, sourceDocId);
  if (!dl?.loyaltyCardId) return;
  const [sourceDoc] = await db.select({ total: documents.total }).from(documents).where(eq(documents.id, sourceDocId)).limit(1);
  if (!sourceDoc?.total || dec(sourceDoc.total) <= 0n) return;
  const [accrualTx] = await db.select().from(loyaltyTransactions).where(and(eq(loyaltyTransactions.documentId, sourceDocId), eq(loyaltyTransactions.kind, 'accrual'))).orderBy(desc(loyaltyTransactions.createdAt)).limit(1);
  if (!accrualTx) return;
  const amount = reversalPointsForReturn(accrualTx.points, sourceDoc.total, returnDoc.total ?? '0.00');
  if (dec(amount) <= 0n) return;
  await db.insert(loyaltyTransactions).values({ workspaceId: ctx.workspaceId, cardId: accrualTx.cardId, documentId: returnDoc.id, kind: 'reversal', points: fmt(-dec(amount), 2), reversesId: accrualTx.id, comment: `Возврат по документу ${returnDoc.number ?? returnDoc.id}` });
}

/* ======================= Сгорание баллов (воркер) ======================= */

/** Сгорание истёкших баллов в порядке FIFO (план, «Сгорание через заданный срок»): для карт с начислениями (лотами),
    у которых истёк expires_at <= now, сабый старый лот расходуется первым (fifoExpiredPoints из @gr8r/shared);
    непогашенный остаток просроченных лотов сгорает одним движением 'expiration' на лот (идемпотентно: повторный
    запуск не создаст второй расход, потому что уже списанный лот учитывается в расходе следующего вызова).
    Читается весь журнал карты (не только истёкшие лоты) — расходные движения надвигают от самого раннего лота.
    Задача периодически загоняется воркером (apps/worker/src/loyalty-expiration.ts). Возвращает число созданных движений 'expiration'. */
export async function runLoyaltyExpiration(db: Db, workspaceId: string, now = new Date()): Promise<number> {
  const cardIds = await db
    .selectDistinct({ cardId: loyaltyTransactions.cardId })
    .from(loyaltyTransactions)
    .where(and(eq(loyaltyTransactions.workspaceId, workspaceId), eq(loyaltyTransactions.kind, 'accrual'), lte(loyaltyTransactions.expiresAt, now)));
  let count = 0;
  for (const { cardId } of cardIds) {
    const txs = await db.select().from(loyaltyTransactions).where(and(eq(loyaltyTransactions.cardId, cardId), ne(loyaltyTransactions.kind, 'expiration'))).orderBy(asc(loyaltyTransactions.createdAt));
    const lots = txs.filter(t => t.kind === 'accrual').map(t => ({ id: t.id, createdAt: t.createdAt, points: t.points, expiresAt: t.expiresAt }));
    if (!lots.length) continue;
    const spend = txs.filter(t => t.kind !== 'accrual').reduce((a, t) => a + (dec(t.points) < 0n ? -dec(t.points) : 0n), 0n);
    const burned = fifoExpiredPoints(lots, fmt(spend, 2), now);
    for (const lot of burned) {
      await db.insert(loyaltyTransactions).values({ workspaceId, cardId, kind: 'expiration', points: fmt(-dec(lot.points), 2), reversesId: lot.lotId, comment: 'Сгорание истёкших баллов' });
      count++;
    }
  }
  return count;
}
