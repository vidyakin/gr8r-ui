/* Документы продаж и закупок: создание и правка, «на основании», проведение и отмена проведения, нумерация, остаток к отгрузке.
   Все функции работают на переданной транзакции арендатора (Db под withContext): изоляцию дают политики RLS, поэтому в запросах нет ручных
   фильтров по workspace_id. Правила проведения и склада описаны в docs/architecture.md, разделы «Документы продаж и закупок» и «Склад». */
import { and, asc, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import {
  canChangeState,
  computeLine,
  computeTotals,
  DOCUMENT_META,
  dec,
  div,
  fmt,
  formatDocumentNumber,
  basedOnTargets,
  lineRole,
  stockPlan,
  FULFIL_TYPES,
  type DocumentLineInput,
  type DocumentType,
  type PrintBank,
  type PrintData,
  type PrintParty,
  type Role,
  type VatRate,
} from '@gr8r/shared';
import type { Db } from './client';
import { DomainError } from './errors';
import { recordEvent } from './events';
import { applyStockMoves, defaultPostingCost, documentCosts, loadInventorySettings, revertStockMoves, sourceMoveCosts, syncReservations, type MoveRequest } from './stock';
import { bankAccounts, companies, costItems, documentCounters, documentLines, documents, organizations, products, units, warehouses } from './schema';
import { uuidv7 } from './uuid';

export interface DocCtx {
  workspaceId: string;
  /** members.id автора действия */
  memberId: string | null;
  /** Роль автора: стоимость видят только admin и owner */
  role?: Role;
}

export type DocumentRow = typeof documents.$inferSelect;
export type DocumentLineRow = typeof documentLines.$inferSelect;

const today = () => new Date().toISOString().slice(0, 10);

/* ---------------- организация и склад по умолчанию ---------------- */

/** Новому воркспейсу — организация по умолчанию (по его названию) и основной склад, чтобы документы можно было создавать сразу */
export async function ensureDocumentDefaults(db: Db, workspaceId: string, name: string): Promise<void> {
  const [org] = await db.select({ id: organizations.id }).from(organizations).limit(1);
  if (!org) await db.insert(organizations).values({ workspaceId, name, fullName: name, isDefault: true });
  const [wh] = await db.select({ id: warehouses.id }).from(warehouses).limit(1);
  if (!wh) await db.insert(warehouses).values({ workspaceId, name: 'Основной склад', code: 'MAIN', isDefault: true });
}

/** Системные статьи затрат и доходов: без них не оформить списание и оприходование */
const SYSTEM_COST_ITEMS: { key: string; name: string; kind: 'expense' | 'income' }[] = [
  { key: 'brak', name: 'Брак', kind: 'expense' },
  { key: 'porcha', name: 'Порча', kind: 'expense' },
  { key: 'nedostacha', name: 'Недостача', kind: 'expense' },
  { key: 'othody', name: 'Отходы', kind: 'expense' },
  { key: 'v_expluaciatsiyu', name: 'Передача в эксплуатацию', kind: 'expense' },
  { key: 'izlishki', name: 'Излишки', kind: 'income' },
];

/** Статьи затрат и доходов по умолчанию: добавляются один раз, свои статьи воркспейс заводит сам */
export async function ensureCostItems(db: Db, workspaceId: string): Promise<void> {
  const have = new Set((await db.select({ systemKey: costItems.systemKey }).from(costItems).where(eq(costItems.workspaceId, workspaceId))).map(r => r.systemKey).filter((x): x is string => !!x));
  const missing = SYSTEM_COST_ITEMS.filter(i => !have.has(i.key));
  if (missing.length) await db.insert(costItems).values(missing.map(i => ({ workspaceId, name: i.name, kind: i.kind, systemKey: i.key }))).onConflictDoNothing();
}

/* ---------------- загрузка ---------------- */

async function loadDoc(db: Db, id: string, lock = false): Promise<DocumentRow> {
  const q = db.select().from(documents).where(eq(documents.id, id)).limit(1);
  const [row] = await (lock ? q.for('update') : q);
  if (!row) throw new DomainError(404, 'not_found', 'document not found');
  return row;
}

const linesOf = (db: Db, documentId: string) => db.select().from(documentLines).where(eq(documentLines.documentId, documentId)).orderBy(asc(documentLines.sortOrder), asc(documentLines.createdAt));

async function assertRefs(db: Db, h: { organizationId?: string | null; counterpartyId?: string | null; warehouseId?: string | null; targetWarehouseId?: string | null; costItemId?: string | null; responsibleId?: string | null }) {
  if (h.organizationId) {
    const [o] = await db.select({ id: organizations.id, archivedAt: organizations.archivedAt }).from(organizations).where(eq(organizations.id, h.organizationId)).limit(1);
    if (!o || o.archivedAt) throw new DomainError(422, 'invalid_reference', 'Organization does not exist or is archived');
  }
  if (h.counterpartyId) {
    const [c] = await db.select({ id: companies.id }).from(companies).where(eq(companies.id, h.counterpartyId)).limit(1);
    if (!c) throw new DomainError(422, 'invalid_reference', 'Counterparty does not exist');
  }
  if (h.warehouseId) {
    const [w] = await db.select({ id: warehouses.id, archivedAt: warehouses.archivedAt }).from(warehouses).where(eq(warehouses.id, h.warehouseId)).limit(1);
    if (!w || w.archivedAt) throw new DomainError(422, 'invalid_reference', 'Warehouse does not exist or is archived');
  }
  if (h.targetWarehouseId) {
    const [w] = await db.select({ id: warehouses.id, archivedAt: warehouses.archivedAt }).from(warehouses).where(eq(warehouses.id, h.targetWarehouseId)).limit(1);
    if (!w || w.archivedAt) throw new DomainError(422, 'invalid_reference', 'The target warehouse does not exist or is archived');
  }
  if (h.costItemId) {
    const [c] = await db.select({ id: costItems.id, kind: costItems.kind, archivedAt: costItems.archivedAt }).from(costItems).where(eq(costItems.id, h.costItemId)).limit(1);
    if (!c || c.archivedAt) throw new DomainError(422, 'invalid_reference', 'The cost item does not exist or is archived');
  }
}

/* ---------------- строки и суммы ---------------- */

interface ResolvedLine {
  id: string;
  productId: string;
  name: string;
  unitCode: string;
  qty: string;
  price: string;
  discountPct: string;
  vatRate: VatRate;
}

/** Подставляет из товара название, единицу и ставку НДС, которых нет в строке; новые строки — только по действующим товарам */
async function resolveLines(db: Db, inputs: DocumentLineInput[], existingIds: Set<string>): Promise<ResolvedLine[]> {
  const ids = [...new Set(inputs.map(l => l.productId))];
  const rows = ids.length ? await db.select().from(products).where(inArray(products.id, ids)) : [];
  const by = new Map(rows.map(p => [p.id, p]));
  return inputs.map(l => {
    const p = by.get(l.productId);
    if (!p) throw new DomainError(422, 'invalid_reference', 'A line refers to a product that does not exist');
    const id = l.id ?? uuidv7();
    if (p.archivedAt && !existingIds.has(id)) throw new DomainError(422, 'invalid_reference', `Product "${p.name}" is archived`);
    return { id, productId: p.id, name: l.name?.trim() || p.name, unitCode: l.unitCode ?? p.unitCode, qty: l.qty, price: l.price, discountPct: l.discountPct ?? '0', vatRate: (l.vatRate ?? p.vatRate) as VatRate };
  });
}

const amounts = (l: { qty: string; price: string; discountPct: string; vatRate: string }, includesVat: boolean) => computeLine(l, includesVat);

/** Итоги документа по его строкам в БД (суммы строк уже посчитаны) */
async function writeTotals(db: Db, docId: string): Promise<void> {
  const lines = await linesOf(db, docId);
  const t = computeTotals(lines.map(l => ({ net: l.net, vatAmount: l.vatAmount, total: l.total, vatRate: l.vatRate })));
  await db.update(documents).set({ amountNet: t.net, vatTotal: t.vat, total: t.total, updatedAt: new Date() }).where(eq(documents.id, docId));
}

/** Пересчёт сумм всех строк (смена способа указания НДС или перед проведением) */
async function recalcLines(db: Db, doc: DocumentRow): Promise<DocumentLineRow[]> {
  const lines = await linesOf(db, doc.id);
  const out: DocumentLineRow[] = [];
  for (const l of lines) {
    const a = amounts(l, doc.priceIncludesVat);
    if (a.net !== l.net || a.vatAmount !== l.vatAmount || a.total !== l.total) {
      await db.update(documentLines).set({ net: a.net, vatAmount: a.vatAmount, total: a.total }).where(eq(documentLines.id, l.id));
      out.push({ ...l, net: a.net, vatAmount: a.vatAmount, total: a.total });
    } else out.push(l);
  }
  await writeTotals(db, doc.id);
  return out;
}

/** Строки документа заменяются списком: существующие (по id) обновляются, новые добавляются, отсутствующие удаляются.
    Ссылки «на основании» у потомков остаются на сохранённых строках */
async function saveLines(db: Db, ctx: DocCtx, doc: DocumentRow, inputs: DocumentLineInput[], includesVat: boolean): Promise<void> {
  const type = doc.type as DocumentType;
  const meta = DOCUMENT_META[type];
  const existing = await db.select({ id: documentLines.id, price: documentLines.price }).from(documentLines).where(eq(documentLines.documentId, doc.id));
  const existingIds = new Set(existing.map(e => e.id));
  const prevPrice = new Map(existing.map(e => [e.id, e.price]));
  const resolved = await resolveLines(db, inputs, existingIds);
  const keep = new Set(resolved.map(l => l.id));
  const drop = [...existingIds].filter(id => !keep.has(id));
  if (drop.length) await db.delete(documentLines).where(inArray(documentLines.id, drop));
  for (const [i, l] of resolved.entries()) {
    const a = amounts(l, includesVat);
    const values = { name: l.name, unitCode: l.unitCode, qty: l.qty, price: l.price, discountPct: l.discountPct, vatRate: l.vatRate, net: a.net, vatAmount: a.vatAmount, total: a.total, sortOrder: i, productId: l.productId };
    if (meta.party === null) {
      // внутренний документ: без НДС и продажной цены, роль строки проставляет сервер
      const role = lineRole(type);
      const price = await internalPrice(db, ctx, doc, l, prevPrice.get(l.id));
      const b = amounts({ ...l, price, vatRate: 'none' }, includesVat);
      Object.assign(values, { price, vatRate: 'none', stockRole: role, net: b.net, vatAmount: b.vatAmount, total: b.total });
    }
    if (existingIds.has(l.id)) await db.update(documentLines).set(values).where(eq(documentLines.id, l.id));
    else await db.insert(documentLines).values({ ...values, id: l.id, workspaceId: ctx.workspaceId, documentId: doc.id });
  }
  await writeTotals(db, doc.id);
}

/** Цена строки внутреннего документа: у списания и перемещения — ноль, у оприходования — себестоимость прихода.
    Цену оприходования вправе задать admin и owner, остальным сервер подставляет текущую среднюю */
async function internalPrice(db: Db, ctx: DocCtx, doc: DocumentRow, l: ResolvedLine, prev?: string): Promise<string> {
  const type = doc.type as DocumentType;
  if (type !== 'stock_posting') return '0';
  const canSet = ctx.role === 'owner' || ctx.role === 'admin';
  if (canSet && dec(l.price) > 0n) return l.price;
  if (prev !== undefined) return prev;
  const cost = await defaultPostingCost(db, doc.warehouseId, l.productId);
  return cost.cost;
}

/* ---------------- создание, правка, удаление ---------------- */

export interface DocumentCreateInput {
  id?: string;
  type: DocumentType;
  organizationId?: string | null;
  counterpartyId?: string | null;
  warehouseId?: string | null;
  targetWarehouseId?: string | null;
  costItemId?: string | null;
  date?: string;
  dueDate?: string | null;
  priceIncludesVat?: boolean;
  comment?: string;
  responsibleId?: string | null;
  lines?: DocumentLineInput[];
  custom?: Record<string, unknown>;
}

export async function createDocument(db: Db, ctx: DocCtx, input: DocumentCreateInput): Promise<string> {
  const meta = DOCUMENT_META[input.type];
  let organizationId = input.organizationId ?? null;
  if (!organizationId) {
    const [o] = await db.select({ id: organizations.id }).from(organizations).where(isNull(organizations.archivedAt)).orderBy(desc(organizations.isDefault), asc(organizations.createdAt)).limit(1);
    if (!o) throw new DomainError(422, 'organization_required', 'Add an organization in Settings → Organizations first');
    organizationId = o.id;
  }
  let warehouseId = input.warehouseId ?? null;
  if (input.warehouseId === undefined && (meta.stock || meta.reserves || meta.stockRole)) {
    const [w] = await db.select({ id: warehouses.id }).from(warehouses).where(isNull(warehouses.archivedAt)).orderBy(desc(warehouses.isDefault), asc(warehouses.createdAt)).limit(1);
    warehouseId = w?.id ?? null;
  }
  // внутренний документ: контрагента нет, вид операции задаёт тип
  const counterpartyId = meta.party === null ? null : input.counterpartyId ?? null;
  const targetWarehouseId = meta.stockRole === 'transfer' ? input.targetWarehouseId ?? null : null;
  const costItemId = meta.costItemKind ? input.costItemId ?? null : null;
  await assertRefs(db, { organizationId, counterpartyId, warehouseId, targetWarehouseId, costItemId, responsibleId: input.responsibleId });
  if (meta.stockRole === 'transfer' && (!targetWarehouseId || targetWarehouseId === warehouseId)) throw new DomainError(422, 'target_warehouse_required', 'Select another warehouse to move the goods to');
  if (costItemId) await assertCostItemKind(db, input.type, costItemId);
  const [row] = await db
    .insert(documents)
    .values({
      ...(input.id ? { id: input.id } : {}),
      workspaceId: ctx.workspaceId,
      type: input.type,
      date: input.date ?? today(),
      dueDate: input.dueDate ?? null,
      state: null,
      operation: meta.operation ?? null,
      organizationId,
      counterpartyId,
      warehouseId,
      targetWarehouseId,
      costItemId,
      priceIncludesVat: input.priceIncludesVat ?? true,
      comment: input.comment ?? '',
      responsibleId: input.responsibleId ?? ctx.memberId,
      custom: input.custom ?? {},
      createdBy: ctx.memberId,
    })
    .returning();
  if (input.lines?.length) await saveLines(db, ctx, row!, input.lines, row!.priceIncludesVat);
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'document.created', entity: 'document', recordId: row!.id, actorId: ctx.memberId, payload: { documentType: input.type } });
  return row!.id;
}

export interface DocumentPatch {
  organizationId?: string | null;
  counterpartyId?: string | null;
  warehouseId?: string | null;
  targetWarehouseId?: string | null;
  costItemId?: string | null;
  date?: string;
  dueDate?: string | null;
  priceIncludesVat?: boolean;
  comment?: string;
  responsibleId?: string | null;
  lines?: DocumentLineInput[];
  custom?: Record<string, unknown>;
}

/** Статья затрат или доходов должна соответствовать виду документа: списание — расходная, оприходование — доходная */
async function assertCostItemKind(db: Db, type: DocumentType, costItemId: string): Promise<void> {
  const meta = DOCUMENT_META[type];
  if (!meta.costItemKind) return;
  const [c] = await db.select({ id: costItems.id, kind: costItems.kind }).from(costItems).where(eq(costItems.id, costItemId)).limit(1);
  if (!c) throw new DomainError(422, 'invalid_reference', 'The cost item does not exist');
  if (c.kind !== meta.costItemKind) throw new DomainError(422, 'cost_item_kind_mismatch', meta.costItemKind === 'expense' ? 'This document needs an expense cost item' : 'This document needs an income cost item');
}

export async function updateDocument(db: Db, ctx: DocCtx, id: string, patch: DocumentPatch): Promise<void> {
  const doc = await loadDoc(db, id, true);
  const type = doc.type as DocumentType;
  const meta = DOCUMENT_META[type];
  if (doc.status !== 'draft') throw new DomainError(409, 'not_draft', doc.status === 'posted' ? 'A posted document cannot be edited: unpost it first' : 'A cancelled document cannot be edited: restore it first');
  if (patch.organizationId !== undefined && patch.organizationId === null) throw new DomainError(422, 'organization_required', 'A document needs an organization');
  const orgChanged = patch.organizationId !== undefined && patch.organizationId !== doc.organizationId;
  if (doc.numberSeq !== null) {
    // номер принадлежит последовательности (организация, тип, год): сменой организации или года его не сломать
    if (orgChanged) throw new DomainError(422, 'number_locked', 'The document already has a number from this organization: it cannot move to another organization');
    if (patch.date && Number(patch.date.slice(0, 4)) !== doc.numberYear) throw new DomainError(422, 'number_locked', `The document is numbered in ${doc.numberYear}: its date must stay in that year`);
  }
  await assertRefs(db, { organizationId: orgChanged ? patch.organizationId : undefined, counterpartyId: patch.counterpartyId, warehouseId: patch.warehouseId, targetWarehouseId: patch.targetWarehouseId, costItemId: patch.costItemId, responsibleId: patch.responsibleId });
  if (patch.costItemId) await assertCostItemKind(db, type, patch.costItemId);
  const targetWarehouseId = meta.stockRole === 'transfer' ? patch.targetWarehouseId ?? doc.targetWarehouseId : doc.targetWarehouseId;
  if (meta.stockRole === 'transfer') {
    const wh = patch.warehouseId ?? doc.warehouseId;
    if (!targetWarehouseId || targetWarehouseId === wh) throw new DomainError(422, 'target_warehouse_required', 'Select another warehouse to move the goods to');
  }
  const set: Partial<typeof documents.$inferInsert> = { updatedAt: new Date() };
  if (patch.organizationId) set.organizationId = patch.organizationId;
  if (patch.counterpartyId !== undefined) set.counterpartyId = meta.party === null ? null : patch.counterpartyId;
  if (patch.warehouseId !== undefined) set.warehouseId = patch.warehouseId;
  if (patch.targetWarehouseId !== undefined && meta.stockRole === 'transfer') set.targetWarehouseId = patch.targetWarehouseId;
  if (patch.costItemId !== undefined && meta.costItemKind) set.costItemId = patch.costItemId;
  if (patch.date) set.date = patch.date;
  if (patch.dueDate !== undefined) set.dueDate = patch.dueDate;
  if (patch.priceIncludesVat !== undefined) set.priceIncludesVat = patch.priceIncludesVat;
  if (patch.comment !== undefined) set.comment = patch.comment;
  if (patch.responsibleId !== undefined) set.responsibleId = patch.responsibleId;
  if (patch.custom) set.custom = { ...doc.custom, ...patch.custom };
  const [after] = await db.update(documents).set(set).where(eq(documents.id, id)).returning();
  if (patch.lines) await saveLines(db, ctx, after!, patch.lines, after!.priceIncludesVat);
  else if (patch.priceIncludesVat !== undefined && patch.priceIncludesVat !== doc.priceIncludesVat) await recalcLines(db, after!);
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'document.updated', entity: 'document', recordId: id, actorId: ctx.memberId, payload: { changes: Object.keys(patch) } });
}

/** Удалить можно черновик, у которого никогда не было номера: иначе в нумерации образовалась бы дыра — такой документ отменяют */
export async function deleteDocument(db: Db, ctx: DocCtx, id: string): Promise<void> {
  const doc = await loadDoc(db, id, true);
  if (doc.status !== 'draft') throw new DomainError(409, 'not_draft', 'Only drafts can be deleted: unpost or cancel the document instead');
  if (doc.numberSeq !== null) throw new DomainError(409, 'numbered', 'The document has been posted before and keeps its number: cancel it instead of deleting');
  await db.delete(documents).where(eq(documents.id, id));
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'document.deleted', entity: 'document', recordId: id, actorId: ctx.memberId, payload: { documentType: doc.type } });
}

export async function cancelDocument(db: Db, ctx: DocCtx, id: string): Promise<void> {
  const doc = await loadDoc(db, id, true);
  if (doc.status !== 'draft') throw new DomainError(409, 'invalid_status', doc.status === 'posted' ? 'Unpost the document before cancelling it' : 'The document is already cancelled');
  await db.update(documents).set({ status: 'cancelled', updatedAt: new Date() }).where(eq(documents.id, id));
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'document.cancelled', entity: 'document', recordId: id, actorId: ctx.memberId, payload: { documentType: doc.type, number: doc.number } });
}

export async function restoreDocument(db: Db, ctx: DocCtx, id: string): Promise<void> {
  const doc = await loadDoc(db, id, true);
  if (doc.status !== 'cancelled') throw new DomainError(409, 'invalid_status', 'Only a cancelled document can be restored');
  await db.update(documents).set({ status: 'draft', updatedAt: new Date() }).where(eq(documents.id, id));
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'document.restored', entity: 'document', recordId: id, actorId: ctx.memberId, payload: { documentType: doc.type } });
}

/* ---------------- состояние документа ---------------- */

/** Хуки смены состояния по типу документа: перемещение «в пути» (этап 0б), заказ на производство (этап 2), заказ-наряд (план услуг) */
const STATE_HOOKS: Partial<Record<DocumentType, (doc: DocumentRow, from: string | null, to: string, db: Db) => Promise<void>>> = {};

/** Смена состояния документа (отдельно от проведения). Переход проверяется по метаданным типа; событие пишется как
    document.updated с changes.state — автоматизация «поле изменилось» срабатывает без нового триггера */
export async function changeDocumentState(db: Db, ctx: DocCtx, id: string, state: string): Promise<void> {
  const doc = await loadDoc(db, id, true);
  const type = doc.type as DocumentType;
  const meta = DOCUMENT_META[type];
  if (!meta.states?.length) throw new DomainError(422, 'state_not_allowed', `A ${meta.label.toLowerCase()} has no states`);
  if (!canChangeState(meta, doc.state, state)) throw new DomainError(422, 'invalid_state', `Cannot change the state from "${doc.state ?? 'none'}" to "${state}"`);
  const from = doc.state;
  await db.update(documents).set({ state, updatedAt: new Date() }).where(eq(documents.id, id));
  await STATE_HOOKS[type]?.(doc, from, state, db);
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'document.updated', entity: 'document', recordId: id, actorId: ctx.memberId, payload: { changes: { state: { from, to: state } } } });
}

/* ---------------- нумерация ---------------- */

/** Следующий номер по (организация, тип, год). Строка счётчика блокируется до конца транзакции, откат отменяет и приращение:
    номера идут подряд, без дыр и без повторов даже при параллельном проведении */
async function nextNumber(db: Db, doc: DocumentRow): Promise<{ number: string; year: number; seq: number }> {
  const year = Number(doc.date.slice(0, 4));
  const [c] = await db
    .insert(documentCounters)
    .values({ workspaceId: doc.workspaceId, organizationId: doc.organizationId, type: doc.type, year, lastNumber: 1 })
    .onConflictDoUpdate({ target: [documentCounters.organizationId, documentCounters.type, documentCounters.year], set: { lastNumber: sql`${documentCounters.lastNumber} + 1` } })
    .returning({ n: documentCounters.lastNumber });
  return { number: formatDocumentNumber(doc.type as DocumentType, year, c!.n), year, seq: c!.n };
}

/* ---------------- проведение ---------------- */

/** Не больше, чем заказано (исполнение заказа) и не больше, чем отгружено (возврат): суммы проведённых документов цепочки + этот */
async function checkLimits(db: Db, doc: DocumentRow, lines: DocumentLineRow[]): Promise<void> {
  const type = doc.type as DocumentType;
  const isReturn = type === 'customer_return' || type === 'supplier_return';
  if (!DOCUMENT_META[type].fulfils && !isReturn) return;
  const key = (l: DocumentLineRow) => (isReturn ? l.sourceLineId : l.originLineId);
  const refs = [...new Set(lines.map(key).filter((x): x is string => !!x))];
  if (!refs.length) return;
  const limits = await db.select({ id: documentLines.id, qty: documentLines.qty, name: documentLines.name }).from(documentLines).where(inArray(documentLines.id, refs));
  const col = isReturn ? documentLines.sourceLineId : documentLines.originLineId;
  const doneRows = await db
    .select({ ref: col, qty: sql<string>`sum(${documentLines.qty})` })
    .from(documentLines)
    .innerJoin(documents, eq(documents.id, documentLines.documentId))
    .where(and(inArray(col, refs), eq(documents.status, 'posted'), isReturn ? eq(documents.type, type) : inArray(documents.type, FULFIL_TYPES), ne(documents.id, doc.id)))
    .groupBy(col);
  const done = new Map(doneRows.map(r => [r.ref!, dec(r.qty)]));
  const mine = new Map<string, bigint>();
  for (const l of lines) {
    const k = key(l);
    if (k) mine.set(k, (mine.get(k) ?? 0n) + dec(l.qty));
  }
  for (const lim of limits) {
    const total = (done.get(lim.id) ?? 0n) + (mine.get(lim.id) ?? 0n);
    if (total > dec(lim.qty)) {
      const msg = isReturn ? `"${lim.name}": more is returned (${fmt(total, 3)}) than was ${type === 'customer_return' ? 'shipped' : 'received'} (${fmt(dec(lim.qty), 3)})` : `"${lim.name}": ${fmt(total, 3)} would be fulfilled, but only ${fmt(dec(lim.qty), 3)} was ordered`;
      throw new DomainError(422, isReturn ? 'over_return' : 'over_fulfilment', msg);
    }
  }
}

export async function postDocument(db: Db, ctx: DocCtx, id: string): Promise<void> {
  const doc = await loadDoc(db, id, true);
  const type = doc.type as DocumentType;
  const meta = DOCUMENT_META[type];
  if (doc.status !== 'draft') throw new DomainError(409, 'invalid_status', doc.status === 'posted' ? 'The document is already posted' : 'A cancelled document cannot be posted: restore it first');
  if (meta.party && !doc.counterpartyId) throw new DomainError(422, 'counterparty_required', meta.party === 'customer' ? 'Select a customer before posting' : 'Select a supplier before posting');
  await assertRefs(db, { organizationId: doc.organizationId, warehouseId: doc.warehouseId, targetWarehouseId: doc.targetWarehouseId, costItemId: doc.costItemId });
  if (doc.basedOnId) {
    const [base] = await db.select({ status: documents.status, number: documents.number }).from(documents).where(eq(documents.id, doc.basedOnId)).limit(1);
    if (base && base.status !== 'posted') throw new DomainError(422, 'base_not_posted', `Post the basis document${base.number ? ` ${base.number}` : ''} first`);
  }
  const lines = await recalcLines(db, doc);
  if (!lines.length) throw new DomainError(422, 'no_lines', 'Add at least one line before posting');
  await checkLimits(db, doc, lines);

  const kinds = new Map((await db.select({ id: products.id, kind: products.kind }).from(products).where(inArray(products.id, [...new Set(lines.map(l => l.productId))]))).map(p => [p.id, p.kind]));
  const goods = lines.filter(l => kinds.get(l.productId) === 'goods');
  if (goods.length && (meta.stock || meta.stockRole) && !doc.warehouseId) throw new DomainError(422, 'warehouse_required', 'Select a warehouse before posting');
  if (meta.stockRole === 'transfer' && goods.length && (!doc.targetWarehouseId || doc.targetWarehouseId === doc.warehouseId)) throw new DomainError(422, 'target_warehouse_required', 'Select another warehouse to move the goods to');
  if (meta.costItemKind) {
    if (!doc.costItemId) throw new DomainError(422, 'cost_item_required', meta.costItemKind === 'expense' ? 'Select an expense cost item before posting' : 'Select an income cost item before posting');
    await assertCostItemKind(db, type, doc.costItemId);
  }
  if (goods.length) {
    const plan = stockPlan({ type, warehouseId: doc.warehouseId, targetWarehouseId: doc.targetWarehouseId }, goods.map(l => ({ id: l.id, productId: l.productId, qty: l.qty, stockRole: l.stockRole })));
    if (plan.length) {
      const [org] = await db.select({ taxSystem: organizations.taxSystem }).from(organizations).where(eq(organizations.id, doc.organizationId)).limit(1);
      const returnCosts = type === 'customer_return' ? await sourceMoveCosts(db, goods.map(l => l.sourceLineId).filter((x): x is string => !!x)) : new Map<string, bigint>();
      const byLine = new Map(lines.map(l => [l.id, l]));
      const reqs: MoveRequest[] = plan.map(m => {
        const l = byLine.get(m.lineId)!;
        const req: MoveRequest = { warehouseId: m.warehouseId, productId: m.productId, lineId: m.lineId, qty: dec(m.qty), direction: m.direction };
        if (type === 'receipt') req.cost = div(dec(org?.taxSystem === 'usn' ? l.total : l.net), dec(l.qty)); // при УСН входной НДС входит в себестоимость
        if (type === 'customer_return' && l.sourceLineId && returnCosts.has(l.sourceLineId)) req.cost = returnCosts.get(l.sourceLineId);
        if (type === 'stock_posting') req.cost = dec(l.price); // цена оприходования — себестоимость прихода
        if (type === 'stock_transfer' && m.direction === 'in') req.costFromLine = true; // приход по фактической цене расхода
        return req;
      });
      await applyStockMoves(db, ctx.workspaceId, { id: doc.id, date: doc.date }, reqs, await loadInventorySettings(db, ctx.workspaceId));
    }
  }

  const num = doc.numberSeq === null ? await nextNumber(db, doc) : null;
  await db
    .update(documents)
    .set({ status: 'posted', postedAt: new Date(), postedBy: ctx.memberId, updatedAt: new Date(), ...(num ? { number: num.number, numberYear: num.year, numberSeq: num.seq } : {}) })
    .where(eq(documents.id, id));

  await syncAfterChange(db, ctx, doc, lines);
  const [after] = await db.select({ number: documents.number, total: documents.total }).from(documents).where(eq(documents.id, id)).limit(1);
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'document.posted', entity: 'document', recordId: id, actorId: ctx.memberId, payload: { documentType: type, number: after!.number, total: after!.total } });
}

export async function unpostDocument(db: Db, ctx: DocCtx, id: string): Promise<void> {
  const doc = await loadDoc(db, id, true);
  const type = doc.type as DocumentType;
  if (doc.status !== 'posted') throw new DomainError(409, 'invalid_status', 'Only a posted document can be unposted');
  const kids = await db.select({ id: documents.id, type: documents.type, number: documents.number }).from(documents).where(and(eq(documents.basedOnId, id), eq(documents.status, 'posted')));
  if (kids.length)
    throw new DomainError(409, 'has_posted_children', `Unpost the documents created from this one first: ${kids.map(k => k.number ?? DOCUMENT_META[k.type as DocumentType].label).join(', ')}`, { documents: kids });
  // отмена проведения возвращает движения склада (у внутренних документов — обе стороны перемещения)
  await revertStockMoves(db, ctx.workspaceId, id, await loadInventorySettings(db, ctx.workspaceId));
  await db.update(documents).set({ status: 'draft', postedAt: null, postedBy: null, updatedAt: new Date() }).where(eq(documents.id, id));
  await syncAfterChange(db, ctx, { ...doc, status: 'draft' }, await linesOf(db, id));
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'document.unposted', entity: 'document', recordId: id, actorId: ctx.memberId, payload: { documentType: type, number: doc.number } });
}

/** Резервы затронутых заказов: сам заказ (его строки) или заказы, которые исполняет документ (по originLineId) */
async function syncAfterChange(db: Db, ctx: DocCtx, doc: DocumentRow, lines: DocumentLineRow[]): Promise<void> {
  const reserves = DOCUMENT_META[doc.type as DocumentType].reserves;
  const ids = reserves ? lines.map(l => l.id) : lines.map(l => l.originLineId).filter((x): x is string => !!x);
  if (ids.length) await syncReservations(db, ctx.workspaceId, ids);
}

/* ---------------- на основании ---------------- */

/** Создаёт черновик указанного типа из документа: шапка и строки копируются, связь хранится в based_on_id и в строках (source / origin).
    Для документов, исполняющих заказ, количество строки = остаток к исполнению (заказано − уже в документах цепочки); для возвратов — остаток к возврату */
export async function createBasedOn(db: Db, ctx: DocCtx, sourceId: string, target: DocumentType): Promise<string> {
  const src = await loadDoc(db, sourceId);
  const srcType = src.type as DocumentType;
  if (src.status === 'cancelled') throw new DomainError(422, 'invalid_based_on', 'A cancelled document cannot be a basis');
  if (!basedOnTargets(srcType).includes(target)) throw new DomainError(422, 'invalid_based_on', `${DOCUMENT_META[target].label} cannot be created from ${DOCUMENT_META[srcType].label.toLowerCase()}`);
  const srcLines = await linesOf(db, sourceId);
  const isOrder = DOCUMENT_META[srcType].isOrder === true;
  const isReturn = DOCUMENT_META[target].isReturn === true;
  const fulfils = DOCUMENT_META[target].fulfils;

  // уже запланированное: непроведённые и проведённые (но не отменённые) документы-исполнители / возвраты по тем же строкам
  const refCol = isReturn ? documentLines.sourceLineId : documentLines.originLineId;
  const refIds = srcLines.map(l => (isReturn ? l.id : (isOrder ? l.id : l.originLineId))).filter((x): x is string => !!x);
  const plannedRows = refIds.length && (fulfils || isReturn)
    ? await db
        .select({ ref: refCol, qty: sql<string>`sum(${documentLines.qty})` })
        .from(documentLines)
        .innerJoin(documents, eq(documents.id, documentLines.documentId))
        .where(and(inArray(refCol, refIds), ne(documents.status, 'cancelled'), isReturn ? eq(documents.type, target) : inArray(documents.type, FULFIL_TYPES)))
        .groupBy(refCol)
    : [];
  const planned = new Map(plannedRows.map(r => [r.ref!, dec(r.qty)]));
  const originQty = new Map<string, bigint>();
  if (fulfils && !isOrder) {
    const origins = [...new Set(srcLines.map(l => l.originLineId).filter((x): x is string => !!x))];
    if (origins.length) for (const o of await db.select({ id: documentLines.id, qty: documentLines.qty }).from(documentLines).where(inArray(documentLines.id, origins))) originQty.set(o.id, dec(o.qty));
  }

  const newLines: DocumentLineInput[] = [];
  const meta: { source: string; origin: string | null }[] = [];
  for (const l of srcLines) {
    let qty = dec(l.qty);
    if (isReturn) qty = dec(l.qty) - (planned.get(l.id) ?? 0n);
    else if (fulfils) {
      const origin = isOrder ? l.id : l.originLineId;
      if (origin) {
        const total = isOrder ? dec(l.qty) : (originQty.get(origin) ?? dec(l.qty));
        const left = total - (planned.get(origin) ?? 0n);
        qty = left < qty ? left : qty;
      }
    }
    if (qty <= 0n) continue;
    newLines.push({ productId: l.productId, name: l.name, unitCode: l.unitCode, qty: fmt(qty, 3), price: l.price, discountPct: l.discountPct, vatRate: l.vatRate as VatRate });
    meta.push({ source: l.id, origin: isOrder ? l.id : l.originLineId });
  }
  if (!newLines.length) throw new DomainError(422, 'nothing_to_create', isReturn ? 'Everything has already been returned' : 'Everything from this document is already covered by other documents');

  const id = await createDocument(db, ctx, {
    type: target,
    organizationId: src.organizationId,
    counterpartyId: src.counterpartyId,
    warehouseId: src.warehouseId ?? undefined,
    priceIncludesVat: src.priceIncludesVat,
    comment: src.comment,
    dueDate: target === 'invoice' ? src.dueDate : null,
    lines: newLines,
  });
  await db.update(documents).set({ basedOnId: sourceId }).where(eq(documents.id, id));
  const created = await linesOf(db, id);
  for (const [i, l] of created.entries()) await db.update(documentLines).set({ sourceLineId: meta[i]!.source, originLineId: meta[i]!.origin }).where(eq(documentLines.id, l.id));
  return id;
}

/* ---------------- карточка документа ---------------- */

export interface DocumentLineView extends DocumentLineRow {
  sku: string;
  kind: 'goods' | 'service';
  /** Для строк заказов: исполнено проведёнными документами (отгружено / получено) и запланировано (с черновиками) */
  shipped: string;
  planned: string;
  /** Для строк реализации и поступления: уже возвращено проведёнными возвратами */
  returned: string;
}

export async function documentDetail(db: Db, id: string) {
  const doc = await loadDoc(db, id);
  const type = doc.type as DocumentType;
  const [org] = await db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(eq(organizations.id, doc.organizationId)).limit(1);
  const [cp] = doc.counterpartyId ? await db.select({ id: companies.id, name: companies.name, inn: companies.inn }).from(companies).where(eq(companies.id, doc.counterpartyId)).limit(1) : [];
  const [wh] = doc.warehouseId ? await db.select({ id: warehouses.id, name: warehouses.name }).from(warehouses).where(eq(warehouses.id, doc.warehouseId)).limit(1) : [];
  const [base] = doc.basedOnId ? await db.select({ id: documents.id, type: documents.type, number: documents.number, status: documents.status, date: documents.date }).from(documents).where(eq(documents.id, doc.basedOnId)).limit(1) : [];
  const children = await db
    .select({ id: documents.id, type: documents.type, number: documents.number, status: documents.status, date: documents.date, total: documents.total })
    .from(documents)
    .where(eq(documents.basedOnId, id))
    .orderBy(asc(documents.createdAt));
  const rows = await db
    .select({ line: documentLines, sku: products.sku, kind: products.kind })
    .from(documentLines)
    .innerJoin(products, eq(products.id, documentLines.productId))
    .where(eq(documentLines.documentId, id))
    .orderBy(asc(documentLines.sortOrder), asc(documentLines.createdAt));
  const ids = rows.map(r => r.line.id);
  const isOrder = DOCUMENT_META[type].isOrder === true;
  const isReturnable = DOCUMENT_META[type].isReturn === true;
  const sums = async (col: typeof documentLines.originLineId | typeof documentLines.sourceLineId, types: string[], posted: boolean) => {
    if (!ids.length) return new Map<string, string>();
    const r = await db
      .select({ ref: col, qty: sql<string>`sum(${documentLines.qty})` })
      .from(documentLines)
      .innerJoin(documents, eq(documents.id, documentLines.documentId))
      .where(and(inArray(col, ids), inArray(documents.type, types), posted ? eq(documents.status, 'posted') : ne(documents.status, 'cancelled')))
      .groupBy(col);
    return new Map(r.map(x => [x.ref!, x.qty]));
  };
  const shipped = isOrder ? await sums(documentLines.originLineId, FULFIL_TYPES, true) : new Map<string, string>();
  const planned = isOrder ? await sums(documentLines.originLineId, FULFIL_TYPES, false) : new Map<string, string>();
  const returned = isReturnable ? await sums(documentLines.sourceLineId, [type === 'realization' ? 'customer_return' : 'supplier_return'], true) : new Map<string, string>();
  const lines: DocumentLineView[] = rows.map(r => ({ ...r.line, sku: r.sku, kind: r.kind, shipped: fmt(dec(shipped.get(r.line.id) ?? 0), 3), planned: fmt(dec(planned.get(r.line.id) ?? 0), 3), returned: fmt(dec(returned.get(r.line.id) ?? 0), 3) }));
  const totals = computeTotals(lines.map(l => ({ net: l.net, vatAmount: l.vatAmount, total: l.total, vatRate: l.vatRate })));
  const [targetWh] = doc.targetWarehouseId ? await db.select({ id: warehouses.id, name: warehouses.name, kind: warehouses.kind }).from(warehouses).where(eq(warehouses.id, doc.targetWarehouseId)).limit(1) : [];
  const [costItem] = doc.costItemId ? await db.select({ id: costItems.id, name: costItems.name, kind: costItems.kind }).from(costItems).where(eq(costItems.id, doc.costItemId)).limit(1) : [];
  // внутренний документ: стоимость по себестоимости (сумма qty × cost движений)
  const costs = DOCUMENT_META[type].party === null ? await documentCosts(db, [id]) : new Map<string, string>();
  return { ...doc, organization: org ?? null, counterparty: cp ?? null, warehouse: wh ?? null, targetWarehouse: targetWh ?? null, costItem: costItem ?? null, costTotal: costs.get(id) ?? '0.00', basedOn: base ?? null, children, lines, totals };
}

/* ---------------- данные для печатной формы ---------------- */

async function defaultBank(db: Db, owner: { companyId?: string; organizationId?: string }): Promise<PrintBank | null> {
  const where = owner.companyId ? eq(bankAccounts.companyId, owner.companyId) : eq(bankAccounts.organizationId, owner.organizationId!);
  const [b] = await db.select().from(bankAccounts).where(where).orderBy(desc(bankAccounts.isDefault), asc(bankAccounts.createdAt)).limit(1);
  return b ? { bik: b.bik, account: b.account, corrAccount: b.corrAccount, bankName: b.bankName } : null;
}

/** Всё, что нужно шаблону печатной формы (счёт, УПД, акт, ТОРГ-12): документ, обе стороны с реквизитами и банком, строки с единицами */
export async function buildPrintData(db: Db, id: string): Promise<PrintData> {
  const d = await documentDetail(db, id);
  const [org] = await db.select().from(organizations).where(eq(organizations.id, d.organizationId)).limit(1);
  if (!org) throw new DomainError(404, 'not_found', 'organization not found');
  const [co] = d.counterpartyId ? await db.select().from(companies).where(eq(companies.id, d.counterpartyId)).limit(1) : [];
  const unitRows = await db.select({ code: units.code, symbol: units.symbol }).from(units);
  const symbol = new Map(unitRows.map(u => [u.code, u.symbol]));
  const party: PrintParty = co
    ? { name: co.name, fullName: co.name, inn: co.inn, kpp: co.kpp, ogrn: co.ogrn, address: co.legalAddress || co.city, phone: '', bank: await defaultBank(db, { companyId: co.id }) }
    : { name: '', fullName: '', inn: '', kpp: '', ogrn: '', address: '', phone: '', bank: null };
  return {
    type: d.type as DocumentType,
    number: d.number,
    date: d.date,
    dueDate: d.dueDate,
    priceIncludesVat: d.priceIncludesVat,
    organization: {
      name: org.name,
      fullName: org.fullName || org.name,
      inn: org.inn,
      kpp: org.kpp,
      ogrn: org.ogrn,
      address: org.legalAddress,
      phone: org.phone,
      bank: await defaultBank(db, { organizationId: org.id }),
      kind: org.kind,
      directorName: org.directorName,
      directorTitle: org.directorTitle,
      accountantName: org.accountantName,
      taxSystem: org.taxSystem,
      stampFile: org.stampFile ?? null,
      directorSignatureFile: org.directorSignatureFile ?? null,
      accountantSignatureFile: org.accountantSignatureFile ?? null,
    },
    party,
    lines: d.lines.map((l, i) => ({ n: i + 1, sku: l.sku, name: l.name, unitCode: l.unitCode, unitSymbol: symbol.get(l.unitCode) ?? l.unitCode, qty: l.qty, price: l.price, discountPct: l.discountPct, vatRate: l.vatRate, net: l.net, vatAmount: l.vatAmount, total: l.total })),
    totals: d.totals,
    basedOn: d.basedOn ? { type: d.basedOn.type as DocumentType, number: d.basedOn.number, date: d.basedOn.date } : null,
    comment: d.comment,
  };
}
