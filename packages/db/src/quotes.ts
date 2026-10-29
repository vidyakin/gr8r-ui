/* Коммерческие предложения: варианты КП документа и шаблоны КП (docs/architecture/quotes.md).
   Строки документа — всегда основной вариант, поэтому резервы, исполнение, калькуляция и «на основании» о вариантах не знают.
   Остальные варианты — снимки строк в document_variants; «Сделать основным» меняет местами снимок и строки документа. */
import { and, asc, eq, inArray, isNull, max, ne, or } from 'drizzle-orm';
import { computeLine, computeTotals, hasQuoteVariants, renderQuote, type DocumentTotals, type PrintData, type PrintLine, type Role, type DocumentLineInput, type VariantLine, type VatRate } from '@gr8r/shared';
import type { Db } from './client';
import { DomainError } from './errors';
import { recordEvent } from './events';
import { saveDocumentLines, type DocCtx } from './documents';
import { deliveries, docTemplates, documentLines, documentVariants, documents, orderCalculationLines, productionItems, units } from './schema';
import { uuidv7 } from './uuid';

type DocRow = typeof documents.$inferSelect;
type TemplateRow = typeof docTemplates.$inferSelect;

/** Документ с вариантами, черновик, под блокировкой строки */
async function loadDraft(db: Db, id: string): Promise<DocRow> {
  const [doc] = await db.select().from(documents).where(eq(documents.id, id)).for('update').limit(1);
  if (!doc) throw new DomainError(404, 'not_found', 'document not found');
  if (!hasQuoteVariants(doc.type)) throw new DomainError(422, 'variants_not_available', 'Only quotes and customer orders have proposal variants');
  if (doc.status !== 'draft') throw new DomainError(409, 'not_draft', 'Variants can be changed only in a draft');
  return doc;
}

/** Снимок строк документа (основной вариант) */
async function snapshot(db: Db, documentId: string): Promise<VariantLine[]> {
  const rows = await db.select().from(documentLines).where(eq(documentLines.documentId, documentId)).orderBy(asc(documentLines.sortOrder), asc(documentLines.createdAt));
  return rows.map(l => ({ id: l.id, productId: l.productId, name: l.name, unitCode: l.unitCode, qty: l.qty, price: l.price, discountPct: l.discountPct, vatRate: l.vatRate, groupName: l.groupName, params: l.params, sourceLineId: l.sourceLineId, originLineId: l.originLineId }));
}

/** Суммы строк снимка и итоги — по текущему способу указания НДС документа */
export function variantAmounts(lines: VariantLine[], includesVat: boolean) {
  const withAmounts = lines.map(l => ({ ...l, ...computeLine(l, includesVat) }));
  return { lines: withAmounts, totals: computeTotals(withAmounts) };
}

const storedTotals = (lines: VariantLine[], includesVat: boolean) => {
  const t = variantAmounts(lines, includesVat).totals;
  return { amountNet: t.net, vatTotal: t.vat, total: t.total };
};

/** Строки снимка становятся строками документа: id строк и ссылки «на основании» сохраняются */
async function restore(db: Db, ctx: DocCtx, doc: DocRow, lines: VariantLine[]): Promise<void> {
  await saveDocumentLines(
    db,
    ctx,
    doc,
    lines.map(l => ({ id: l.id, productId: l.productId, name: l.name, unitCode: l.unitCode, qty: l.qty, price: l.price, discountPct: l.discountPct, vatRate: l.vatRate as VatRate, groupName: l.groupName, params: l.params as DocumentLineInput["params"] })),
    doc.priceIncludesVat,
  );
  for (const l of lines) if (l.sourceLineId || l.originLineId) await db.update(documentLines).set({ sourceLineId: l.sourceLineId, originLineId: l.originLineId }).where(eq(documentLines.id, l.id));
}

/** Строки основного варианта уходят в снимок (удаляются из документа) только когда на них никто не ссылается:
    документы «на основании», заказ на производство по строке, калькуляция строки, доставка. Иначе связь сломалась бы
    или потерялась молча — 422 variant_lines_in_use */
async function assertLinesFree(db: Db, documentId: string, ids: string[]): Promise<void> {
  if (!ids.length) return;
  const [child] = await db
    .select({ id: documentLines.id })
    .from(documentLines)
    .where(and(ne(documentLines.documentId, documentId), or(inArray(documentLines.sourceLineId, ids), inArray(documentLines.originLineId, ids))))
    .limit(1);
  const [prod] = child ? [] : await db.select({ id: productionItems.id }).from(productionItems).where(inArray(productionItems.customerOrderLineId, ids)).limit(1);
  const [calc] = child || prod ? [] : await db.select({ id: orderCalculationLines.id }).from(orderCalculationLines).where(inArray(orderCalculationLines.documentLineId, ids)).limit(1);
  const [dlv] = child || prod || calc ? [] : await db.select({ id: deliveries.id }).from(deliveries).where(inArray(deliveries.lineId, ids)).limit(1);
  if (child || prod || calc || dlv) throw new DomainError(422, 'variant_lines_in_use', 'Lines of the main variant are used by other documents, a calculation or a delivery: the main variant cannot be changed');
}

const changed = (db: Db, ctx: DocCtx, id: string) => recordEvent(db, { workspaceId: ctx.workspaceId, type: 'document.updated', entity: 'document', recordId: id, actorId: ctx.memberId, payload: { changes: ['variants'] } });

/** Варианты документа для карточки: основной (строки документа) не входит */
export async function variantsOf(db: Db, doc: Pick<DocRow, 'id' | 'priceIncludesVat'>) {
  const rows = await db.select().from(documentVariants).where(eq(documentVariants.documentId, doc.id)).orderBy(asc(documentVariants.sortOrder), asc(documentVariants.createdAt));
  return rows.map(r => {
    const lines = r.lines as unknown as VariantLine[];
    return { id: r.id, name: r.name, sortOrder: r.sortOrder, lineCount: lines.length, totals: variantAmounts(lines, doc.priceIncludesVat).totals };
  });
}

/** Новый вариант становится основным: прежний основной уходит в список вариантов. copy — новый вариант начинается с тех же строк, иначе пустой */
export async function createVariant(db: Db, ctx: DocCtx, id: string, input: { name?: string; copy: boolean }): Promise<void> {
  const doc = await loadDraft(db, id);
  const current = await snapshot(db, id);
  const [{ top } = { top: null }] = await db.select({ top: max(documentVariants.sortOrder) }).from(documentVariants).where(eq(documentVariants.documentId, id));
  const stored = (await db.select({ id: documentVariants.id }).from(documentVariants).where(eq(documentVariants.documentId, id))).length;
  // копия: строки документа остаются на месте (ссылки на них живы), в снимок уходит копия с новыми id.
  // Пустой вариант убирает строки из документа — сначала проверяем, что на них не ссылаются
  if (!input.copy) await assertLinesFree(db, id, current.map(l => l.id));
  const kept = input.copy ? current.map(l => ({ ...l, id: uuidv7() })) : current;
  await db.insert(documentVariants).values({ workspaceId: ctx.workspaceId, documentId: id, name: doc.variantName ?? 'Вариант 1', sortOrder: (top ?? 0) + 1, lines: kept as unknown as Record<string, unknown>[], ...storedTotals(kept, doc.priceIncludesVat) });
  if (!input.copy) await restore(db, ctx, doc, []);
  await db.update(documents).set({ variantName: input.name ?? `Вариант ${stored + 2}`, updatedAt: new Date() }).where(eq(documents.id, id));
  await changed(db, ctx, id);
}

/** «Сделать основным»: выбранный вариант и основной меняются местами */
export async function activateVariant(db: Db, ctx: DocCtx, id: string, variantId: string): Promise<void> {
  const doc = await loadDraft(db, id);
  const [v] = await db.select().from(documentVariants).where(and(eq(documentVariants.id, variantId), eq(documentVariants.documentId, id))).limit(1);
  if (!v) throw new DomainError(404, 'not_found', 'variant not found');
  const current = await snapshot(db, id);
  await assertLinesFree(db, id, current.map(l => l.id));
  await db
    .update(documentVariants)
    .set({ name: doc.variantName ?? 'Вариант 1', lines: current as unknown as Record<string, unknown>[], ...storedTotals(current, doc.priceIncludesVat), updatedAt: new Date() })
    .where(eq(documentVariants.id, v.id));
  await restore(db, ctx, doc, v.lines as unknown as VariantLine[]);
  await db.update(documents).set({ variantName: v.name, updatedAt: new Date() }).where(eq(documents.id, id));
  await changed(db, ctx, id);
}

export async function renameVariant(db: Db, ctx: DocCtx, id: string, variantId: string, name: string): Promise<void> {
  await loadDraft(db, id);
  const r = await db.update(documentVariants).set({ name, updatedAt: new Date() }).where(and(eq(documentVariants.id, variantId), eq(documentVariants.documentId, id))).returning({ id: documentVariants.id });
  if (!r.length) throw new DomainError(404, 'not_found', 'variant not found');
  await changed(db, ctx, id);
}

/** Удалить неосновной вариант; последний удалённый — у документа больше нет вариантов */
export async function deleteVariant(db: Db, ctx: DocCtx, id: string, variantId: string): Promise<void> {
  await loadDraft(db, id);
  const r = await db.delete(documentVariants).where(and(eq(documentVariants.id, variantId), eq(documentVariants.documentId, id))).returning({ id: documentVariants.id });
  if (!r.length) throw new DomainError(404, 'not_found', 'variant not found');
  const left = await db.select({ id: documentVariants.id }).from(documentVariants).where(eq(documentVariants.documentId, id)).limit(1);
  if (!left.length) await db.update(documents).set({ variantName: null, updatedAt: new Date() }).where(eq(documents.id, id));
  await changed(db, ctx, id);
}

/** Варианты для печати: первым — основной; без сохранённых вариантов — пусто */
export async function printVariants(db: Db, doc: Pick<DocRow, 'id' | 'priceIncludesVat' | 'variantName'>, mainLines: PrintLine[], mainTotals: DocumentTotals): Promise<PrintData['variants']> {
  const rows = await db.select().from(documentVariants).where(eq(documentVariants.documentId, doc.id)).orderBy(asc(documentVariants.sortOrder), asc(documentVariants.createdAt));
  if (!rows.length) return [];
  const sym = new Map((await db.select({ code: units.code, symbol: units.symbol }).from(units)).map(u => [u.code, u.symbol]));
  const others = rows.map(r => {
    const a = variantAmounts(r.lines as unknown as VariantLine[], doc.priceIncludesVat);
    const lines: PrintLine[] = a.lines.map((l, i) => ({ n: i + 1, sku: '', name: l.name, unitCode: l.unitCode, unitSymbol: sym.get(l.unitCode) ?? l.unitCode, qty: l.qty, price: l.price, discountPct: l.discountPct, vatRate: l.vatRate, net: l.net, vatAmount: l.vatAmount, total: l.total, group: l.groupName }));
    return { name: r.name, main: false, lines, totals: a.totals };
  });
  return [{ name: doc.variantName ?? 'Вариант 1', main: true, lines: mainLines, totals: mainTotals }, ...others];
}

/* ---------------- шаблоны КП ---------------- */

const isAdmin = (role?: Role) => role === 'owner' || role === 'admin';
/** Шаблон «только автор» видит и печатает только автор */
const visible = (t: TemplateRow, memberId: string | null) => !t.onlyAuthor || t.authorId === memberId;

export async function listTemplates(db: Db, ctx: DocCtx, opts: { purpose?: string; usedOnly?: boolean; archived?: boolean } = {}) {
  const rows = await db
    .select()
    .from(docTemplates)
    .where(and(opts.purpose ? eq(docTemplates.purpose, opts.purpose as TemplateRow['purpose']) : undefined, opts.usedOnly ? eq(docTemplates.isUsed, true) : undefined, opts.archived ? undefined : isNull(docTemplates.archivedAt)))
    .orderBy(asc(docTemplates.name));
  return rows.filter(t => visible(t, ctx.memberId));
}

export async function getTemplate(db: Db, ctx: DocCtx, id: string): Promise<TemplateRow> {
  const [t] = await db.select().from(docTemplates).where(eq(docTemplates.id, id)).limit(1);
  if (!t || !visible(t, ctx.memberId)) throw new DomainError(404, 'not_found', 'template not found');
  return t;
}

export interface TemplateInput {
  name?: string;
  purpose?: 'quote';
  body?: string;
  isUsed?: boolean;
  onlyAuthor?: boolean;
}

export async function createTemplate(db: Db, ctx: DocCtx, input: TemplateInput & { id?: string; name: string }): Promise<TemplateRow> {
  const [t] = await db
    .insert(docTemplates)
    .values({ id: input.id, workspaceId: ctx.workspaceId, name: input.name, purpose: input.purpose ?? 'quote', body: input.body ?? '', isUsed: input.isUsed ?? true, onlyAuthor: input.onlyAuthor ?? false, authorId: ctx.memberId })
    .returning();
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'doc_template.created', entity: 'doc_template', recordId: t!.id, actorId: ctx.memberId });
  return t!;
}

/** Правит и удаляет автор или admin+ */
async function editable(db: Db, ctx: DocCtx, id: string): Promise<TemplateRow> {
  const t = await getTemplate(db, ctx, id);
  if (t.authorId !== ctx.memberId && !isAdmin(ctx.role)) throw new DomainError(403, 'forbidden', 'Only the author or an administrator can change this template');
  return t;
}

export async function updateTemplate(db: Db, ctx: DocCtx, id: string, patch: TemplateInput): Promise<TemplateRow> {
  await editable(db, ctx, id);
  const [t] = await db.update(docTemplates).set({ ...patch, updatedAt: new Date() }).where(eq(docTemplates.id, id)).returning();
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'doc_template.updated', entity: 'doc_template', recordId: id, actorId: ctx.memberId, payload: { changes: Object.keys(patch) } });
  return t!;
}

/** Удаление — в архив: PDF, заказанные по шаблону, ссылаются на него */
export async function archiveTemplate(db: Db, ctx: DocCtx, id: string): Promise<void> {
  await editable(db, ctx, id);
  await db.update(docTemplates).set({ archivedAt: new Date(), updatedAt: new Date() }).where(eq(docTemplates.id, id));
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'doc_template.deleted', entity: 'doc_template', recordId: id, actorId: ctx.memberId });
}

/** Страница КП по шаблону (форма quote); без шаблона — стандартная форма */
export async function renderQuoteHtml(db: Db, data: PrintData, templateId: string | null | undefined, memberId: string | null): Promise<string> {
  if (!templateId) return renderQuote(data);
  const t = await getTemplate(db, { workspaceId: '', memberId }, templateId);
  if (t.purpose !== 'quote' || t.archivedAt) throw new DomainError(404, 'not_found', 'template not found');
  return renderQuote(data, t.body);
}
