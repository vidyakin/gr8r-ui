/* Субподряд на объекте (задача 1274, docs/architecture/construction.md).
   Заказ субподрядчику — существующий документ supplier_order с object_id (создаётся из сметы, задача 1269):
   отдельной таблицы у заказа нет. Акт субподрядчика — документ подрядчика с приёмкой: черновик → принят | отклонён.
   Только принятые количества идут дальше: при приёмке создаётся и проводится поступление услуг с объектом
   (контрагент — субподрядчик, служебная услуга «Субподрядные работы»), что даёт факт subcontract в бюджете (1270)
   и долг перед субподрядчиком во взаиморасчётах. Материалы акта списываются со склада объекта (факт material).
   Принять больше заказанного нельзя (сумма принятого по всем актам ≤ количества строки заказа).
   Отмена приёмки — admin+ и только если по поступлению нет оплат: документы распроводятся и отменяются.
   Деньги — decimal (dec/fmt/mul), без float. Всё в транзакции вызывающего; изменение + событие — вместе. */
import { and, asc, count, desc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import {
  dec,
  fmt,
  objectSubActNumber,
  subActLineAmount,
  subActRejectedAmount,
  type ObjectSubcontractAmounts,
  type ObjectSubcontractRejectReason,
  type Role,
  type VatRate,
} from '@gr8r/shared';import type { Db } from './client';
import { actMoneyByAct } from './act-money';
import { canSeeCost } from './cost';
import { cancelDocument, createDocument, postDocument, unpostDocument, type DocCtx } from './documents';
import { DomainError } from './errors';
import { recordEvent } from './events';
import { assertObjectRef } from './objects';
import {
  companies,
  costItems,
  defectReasons,
  documentLines,
  documents,
  members,
  objectEstimateItems,
  objectEstimates,
  objectSubActLines,
  objectSubActMaterials,
  objectSubActs,
  objects,
  products,
  units,
} from './schema';

export type ObjectSubActRow = typeof objectSubActs.$inferSelect;
export type ObjectSubActLineRow = typeof objectSubActLines.$inferSelect;

/** Контекст записи акта субподрядчика: чей воркспейс, кто автор и его роль (отмена приёмки — admin+) */
export interface SubActCtx extends DocCtx {
  role?: Role;
}

const today = () => new Date().toISOString().slice(0, 10);
const monthStart = (d: string) => `${d.slice(0, 7)}-01`;

/** Служебная услуга строк поступления: строка документа требует товар, позиций каталога у работ нет.
    Одна на воркспейс, создаётся при первой приёмке; наименование строки берётся из акта. */
const SUB_WORK_PRODUCT = 'Субподрядные работы';

/** Статья затрат списания материалов субподрядчику: системная, заводится при первом списании */
const SUB_MATERIAL_COST = { key: 'subcontract_materials', name: 'Материалы субподрядчику' } as const;

/* ---------------- чтение сметы ---------------- */

interface SubcontractItem {
  id: string;
  kind: string;
  name: string;
  unitCode: string;
  price: string;
  productId: string | null;
}

/** Позиции согласованной сметы объекта, которые могут быть строками акта: основная согласованная и допработы */
async function subcontractItems(db: Db, objectId: string): Promise<SubcontractItem[]> {
  return db
    .select({ id: objectEstimateItems.id, kind: objectEstimateItems.kind, name: objectEstimateItems.name, unitCode: objectEstimateItems.unitCode, price: objectEstimateItems.price, productId: objectEstimateItems.productId })
    .from(objectEstimateItems)
    .innerJoin(objectEstimates, and(eq(objectEstimates.workspaceId, objectEstimateItems.workspaceId), eq(objectEstimates.id, objectEstimateItems.estimateId)))
    .where(
      and(
        eq(objectEstimates.objectId, objectId),
        or(
          and(eq(objectEstimates.kind, 'main'), eq(objectEstimates.status, 'approved')),
          and(eq(objectEstimates.kind, 'change'), eq(objectEstimates.changeStatus, 'approved')),
        ),
      ),
    )
    .orderBy(asc(objectEstimates.kind), asc(objectEstimateItems.sortOrder));
}

/** Символы единиц ОКЕИ для строк акта */
async function unitSymbols(db: Db): Promise<Map<string, string>> {
  const rows = await db.select({ code: units.code, symbol: units.symbol }).from(units);
  return new Map(rows.map(u => [u.code, u.symbol]));
}

/* ---------------- заказ-основание ---------------- */

interface OrderLine {
  id: string;
  productId: string;
  name: string;
  unitCode: string;
  qty: string;
  price: string;
}

/** Заказ субподрядчику своего объекта: чужой, не заказ или без объекта — 422 invalid_reference */
async function loadOrder(db: Db, objectId: string, orderId: string) {
  const [row] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, orderId), eq(documents.type, 'supplier_order'), eq(documents.objectId, objectId)))
    .limit(1);
  if (!row) throw new DomainError(422, 'invalid_reference', 'The subcontract order of the object does not exist');
  return row;
}

/** Строки-услуги заказа: работы субподрядчика (товары заказа — материалы, в акт субподряда не входят) */
async function orderServiceLines(db: Db, orderId: string): Promise<OrderLine[]> {
  return db
    .select({ id: documentLines.id, productId: documentLines.productId, name: documentLines.name, unitCode: documentLines.unitCode, qty: documentLines.qty, price: documentLines.price })
    .from(documentLines)
    .innerJoin(products, and(eq(products.workspaceId, documentLines.workspaceId), eq(products.id, documentLines.productId)))
    .where(and(eq(documentLines.documentId, orderId), eq(products.kind, 'service')))
    .orderBy(asc(documentLines.sortOrder));
}

/** Уже принято по заказу: принятое количество по товару заказа (связь позиции сметы с товаром каталога) */
async function acceptedByOrderProduct(db: Db, orderId: string, excludeActId?: string): Promise<Map<string, bigint>> {
  const rows = await db
    .select({ productId: objectEstimateItems.productId, qty: sql<string>`coalesce(sum(${objectSubActLines.acceptedQty}), 0)::text` })
    .from(objectSubActLines)
    .innerJoin(objectSubActs, and(eq(objectSubActs.workspaceId, objectSubActLines.workspaceId), eq(objectSubActs.id, objectSubActLines.actId)))
    .innerJoin(objectEstimateItems, and(eq(objectEstimateItems.workspaceId, objectSubActLines.workspaceId), eq(objectEstimateItems.id, objectSubActLines.estimateItemId)))
    .where(
      and(
        eq(objectSubActs.orderId, orderId),
        eq(objectSubActs.status, 'accepted'),
        excludeActId ? ne(objectSubActs.id, excludeActId) : undefined,
      ),
    )
    .groupBy(objectEstimateItems.productId);
  const out = new Map<string, bigint>();
  for (const r of rows) if (r.productId) out.set(r.productId, dec(r.qty));
  return out;
}

/* ---------------- предложение строк ---------------- */

export interface SubActSuggestionLine {
  orderLineId: string;
  /** Позиция сметы вида subcontract с тем же товаром (если есть): по ней проверяется заказ и считается бюджет */
  estimateItemId: string | null;
  name: string;
  unitCode: string;
  unitSymbol: string;
  /** Остаток к приёмке: заказано − уже принято по актам этого заказа */
  qty: string;
  price: string;
  amount: string;
  orderedQty: string;
  acceptedQty: string;
}

export interface SubActSuggestion {
  objectId: string;
  orderId: string;
  counterpartyId: string;
  docNumber: string;
  docDate: string;
  lines: SubActSuggestionLine[];
}

/** Предложение строк акта из заказа: остаток к приёмке по строкам-услугам заказа */
export async function suggestSubActFromOrder(db: Db, objectId: string, orderId: string): Promise<SubActSuggestion> {
  await assertObjectRef(db, objectId);
  const order = await loadOrder(db, objectId, orderId);
  const [lines, accepted, items, symbols] = await Promise.all([orderServiceLines(db, orderId), acceptedByOrderProduct(db, orderId), subcontractItems(db, objectId), unitSymbols(db)]);
  const byProduct = new Map(items.filter(i => i.kind === 'subcontract' && i.productId).map(i => [i.productId!, i]));
  // заказано по товару и остаток к приёмке: заказано − уже принятое по актам этого заказа
  const ordered = new Map<string, bigint>();
  const remaining = new Map<string, bigint>();
  for (const l of lines) {
    ordered.set(l.productId, (ordered.get(l.productId) ?? 0n) + dec(l.qty));
    remaining.set(l.productId, (remaining.get(l.productId) ?? 0n) + dec(l.qty));
  }
  for (const [productId, qty] of accepted) {
    if (!remaining.has(productId)) continue;
    remaining.set(productId, remaining.get(productId)! - qty);
  }
  const out: SubActSuggestionLine[] = [];
  for (const l of lines) {
    const left = remaining.get(l.productId) ?? 0n;
    if (left <= 0n) continue;
    // остаток распределяется по строкам заказа по порядку
    const take = dec(l.qty) < left ? dec(l.qty) : left;
    remaining.set(l.productId, left - take);
    const qty = fmt(take, 3);
    const item = byProduct.get(l.productId);
    out.push({
      orderLineId: l.id,
      estimateItemId: item?.id ?? null,
      name: l.name,
      unitCode: l.unitCode,
      unitSymbol: symbols.get(l.unitCode) ?? l.unitCode,
      qty,
      price: l.price,
      amount: subActLineAmount({ qty, price: l.price }),
      orderedQty: fmt(ordered.get(l.productId) ?? dec(l.qty), 3),
      acceptedQty: fmt(accepted.get(l.productId) ?? 0n, 3),
    });
  }
  return { objectId, orderId, counterpartyId: order.counterpartyId ?? '', docNumber: '', docDate: today(), lines: out };
}

/* ---------------- номера и проверки ---------------- */

/** Номер акта субподрядчика: СА-<код объекта>-<порядковый>; порядковый растёт по числу актов объекта */
async function nextSubActNumber(db: Db, objectId: string, objectNumber: string): Promise<string> {
  const [{ n }] = await db.select({ n: count() }).from(objectSubActs).where(eq(objectSubActs.objectId, objectId));
  let seq = Number(n) + 1;
  for (let i = 0; i < 1000; i++) {
    const candidate = objectSubActNumber(objectNumber, seq);
    const [taken] = await db.select({ id: objectSubActs.id }).from(objectSubActs).where(eq(objectSubActs.number, candidate)).limit(1);
    if (!taken) return candidate;
    seq++;
  }
  throw new DomainError(409, 'conflict', 'Cannot allocate a subcontract act number for the object');
}

/** Строка акта субподрядчика в объёме, нужном для записи */
interface SubActLineValues {
  estimateItemId: string | null;
  name: string;
  unitCode: string;
  qty: string;
  price: string;
  acceptedQty: string;
  defectReasonId: string | null;
  note: string;
}

export interface SubActLineInput {
  estimateItemId?: string | null | undefined;
  name?: string | undefined;
  unitCode?: string | undefined;
  qty: string;
  price?: string | undefined;
  acceptedQty?: string | undefined;
  defectReasonId?: string | null | undefined;
  note?: string | undefined;
}

/** Строки акта: наименование и цена из позиции сметы, цена заказа — если задан заказ; причина отклонения — из справочника брака */
async function normalizeLines(db: Db, objectId: string, input: SubActLineInput[] | undefined, orderId: string | null): Promise<SubActLineValues[]> {
  const items = await subcontractItems(db, objectId);
  const byId = new Map(items.map(i => [i.id, i]));
  // цена работ из заказа: субподрядчик предъявляет по цене закупки, а не по цене заказчику из сметы
  const orderPrice = new Map<string, string>();
  if (orderId) for (const l of await orderServiceLines(db, orderId)) if (!orderPrice.has(l.productId)) orderPrice.set(l.productId, l.price);
  let source = input;
  if (!source?.length) {
    // без строк — предложение из заказа (полностью принятое) либо ошибка
    if (!orderId) throw new DomainError(422, 'sub_act_empty', 'Add the subcontractor act lines');
    const suggested = await suggestSubActFromOrder(db, objectId, orderId);
    source = suggested.lines.map(l => ({ estimateItemId: l.estimateItemId, name: l.name, unitCode: l.unitCode, qty: l.qty, price: l.price }));
  }
  const out: SubActLineValues[] = [];
  for (const l of source) {
    const item = l.estimateItemId ? byId.get(l.estimateItemId) : undefined;
    if (l.estimateItemId && !item) throw new DomainError(422, 'invalid_reference', 'The estimate line of the object does not exist or its estimate is not approved');
    if (item && item.kind !== 'subcontract') throw new DomainError(422, 'invalid_reference', 'An act line can only reference a subcontract line of the estimate');
    const name = l.name?.trim() || item?.name;
    if (!name) throw new DomainError(422, 'invalid_value', 'A subcontract act line needs a name or an estimate line');
    const price = l.price ?? (item?.productId ? orderPrice.get(item.productId) : undefined) ?? item?.price ?? '0';
    const accepted = l.acceptedQty ?? l.qty;
    if (dec(l.qty) <= 0n) throw new DomainError(422, 'invalid_value', 'The presented quantity must be greater than zero');
    if (dec(accepted) < 0n || dec(accepted) > dec(l.qty))
      throw new DomainError(422, 'invalid_value', 'The accepted quantity must be between zero and the presented quantity', { name, qty: l.qty, acceptedQty: accepted });
    // отклонение возможно только с причиной из справочника причин брака (как в ОТК)
    if (dec(accepted) < dec(l.qty) && !l.defectReasonId) throw new DomainError(422, 'rejection_reason_required', 'Select a rejection reason for the rejected quantity', { name });
    if (l.defectReasonId) {
      const [reason] = await db.select({ id: defectReasons.id }).from(defectReasons).where(and(eq(defectReasons.id, l.defectReasonId), isNull(defectReasons.archivedAt))).limit(1);
      if (!reason) throw new DomainError(422, 'invalid_reference', 'The rejection reason does not exist or is archived');
    }
    out.push({ estimateItemId: item?.id ?? null, name, unitCode: l.unitCode ?? item?.unitCode ?? '796', qty: l.qty, price, acceptedQty: accepted, defectReasonId: l.defectReasonId ?? null, note: l.note ?? '' });
  }
  if (!out.length) throw new DomainError(422, 'sub_act_empty', 'Add the subcontractor act lines');
  return out;
}

export interface SubActMaterialInput {
  productId: string;
  qty: string;
  note?: string | undefined;
}

/* ---------------- запись ---------------- */

export interface SubActInput {
  id?: string | undefined;
  counterpartyId: string;
  orderId?: string | null | undefined;
  docNumber?: string | undefined;
  docDate?: string | undefined;
  periodFrom?: string | undefined;
  periodTo?: string | undefined;
  lines?: SubActLineInput[] | undefined;
  materials?: SubActMaterialInput[] | undefined;
  note?: string | undefined;
}

/** Строки материалов заменяются списком */
async function writeMaterials(db: Db, ctx: SubActCtx, actId: string, materials: SubActMaterialInput[]): Promise<void> {
  await db.delete(objectSubActMaterials).where(eq(objectSubActMaterials.actId, actId));
  if (!materials.length) return;
  await db.insert(objectSubActMaterials).values(materials.map(m => ({ workspaceId: ctx.workspaceId, actId, productId: m.productId, qty: m.qty, note: m.note ?? '' })));
}

/** Строки акта заменяются списком: старые удаляются, новые пишутся по порядку */
async function writeLines(db: Db, ctx: SubActCtx, actId: string, lines: SubActLineValues[]): Promise<void> {
  await db.delete(objectSubActLines).where(eq(objectSubActLines.actId, actId));
  await db.insert(objectSubActLines).values(
    lines.map((l, n) => ({
      workspaceId: ctx.workspaceId,
      actId,
      estimateItemId: l.estimateItemId,
      sortOrder: n,
      name: l.name,
      unitCode: l.unitCode,
      qty: l.qty,
      price: l.price,
      acceptedQty: l.acceptedQty,
      defectReasonId: l.defectReasonId,
      note: l.note,
    })),
  );
}

/** Создание акта субподрядчика: черновик с номером объекта, заказ-основание необязателен */
export async function createSubAct(db: Db, ctx: SubActCtx, objectId: string, input: SubActInput): Promise<ObjectSubActRow> {
  const object = await assertObjectRef(db, objectId);
  const docDate = input.docDate ?? today();
  const periodFrom = input.periodFrom ?? monthStart(docDate);
  const periodTo = input.periodTo ?? docDate;
  if (periodFrom > periodTo) throw new DomainError(422, 'invalid_value', 'The period start cannot be after its end');
  const orderId = input.orderId ?? null;
  if (orderId) await loadOrder(db, objectId, orderId);
  const lines = await normalizeLines(db, objectId, input.lines, orderId);
  const materials = input.materials ?? [];
  const [row] = await db
    .insert(objectSubActs)
    .values({
      ...(input.id ? { id: input.id } : {}),
      workspaceId: ctx.workspaceId,
      objectId,
      counterpartyId: input.counterpartyId,
      orderId,
      number: await nextSubActNumber(db, objectId, object.number),
      docNumber: input.docNumber?.trim() ?? '',
      docDate,
      periodFrom,
      periodTo,
      status: 'draft',
      note: input.note ?? '',
      createdBy: ctx.memberId,
    })
    .returning();
  await writeLines(db, ctx, row!.id, lines);
  await writeMaterials(db, ctx, row!.id, materials);
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'object_sub_act.created', entity: 'object_sub_act', recordId: row!.id, actorId: ctx.memberId, payload: { objectId, number: row!.number, counterpartyId: row!.counterpartyId } });
  return row!;
}

/** Акт своего воркспейса: чужой — 404 (RLS и фильтр воркспейса) */
async function loadSubAct(db: Db, id: string, lock = false): Promise<ObjectSubActRow> {
  const query = db.select().from(objectSubActs).where(eq(objectSubActs.id, id)).limit(1);
  const [row] = lock ? await query.for('update') : await query;
  if (!row) throw new DomainError(404, 'not_found', 'subcontract act not found');
  return row;
}

/** Правится и удаляется только черновик: принятый сначала отменяют (422 sub_act_not_draft) */
function assertDraft(row: ObjectSubActRow): void {
  if (row.status !== 'draft') throw new DomainError(422, 'sub_act_not_draft', 'Only a draft subcontract act can be changed: unaccept it first');
}

/** Правка черновика: undefined — не трогать, null — очистить. Строки и материалы заменяются списком */
export async function updateSubAct(db: Db, ctx: SubActCtx, id: string, input: Partial<SubActInput>): Promise<ObjectSubActRow> {
  const row = await loadSubAct(db, id, true);
  assertDraft(row);
  const docDate = input.docDate ?? row.docDate;
  const periodFrom = input.periodFrom ?? row.periodFrom;
  const periodTo = input.periodTo ?? row.periodTo;
  if (periodFrom > periodTo) throw new DomainError(422, 'invalid_value', 'The period start cannot be after its end');
  const set: Partial<typeof objectSubActs.$inferInsert> = { docDate, periodFrom, periodTo, updatedAt: new Date() };
  if (input.counterpartyId !== undefined) set.counterpartyId = input.counterpartyId;
  if (input.docNumber !== undefined) set.docNumber = input.docNumber.trim();
  if (input.note !== undefined) set.note = input.note;
  const [updated] = await db.update(objectSubActs).set(set).where(eq(objectSubActs.id, id)).returning();
  if (input.lines !== undefined) await writeLines(db, ctx, id, await normalizeLines(db, row.objectId, input.lines, row.orderId));
  if (input.materials !== undefined) await writeMaterials(db, ctx, id, input.materials);
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'object_sub_act.updated', entity: 'object_sub_act', recordId: id, actorId: ctx.memberId, payload: { objectId: row.objectId, fields: Object.keys(input) } });
  return updated!;
}

/** Удаление черновика: принятый и отклонённый акты остаются в истории */
export async function deleteSubAct(db: Db, ctx: SubActCtx, id: string): Promise<void> {
  const row = await loadSubAct(db, id, true);
  assertDraft(row);
  await db.delete(objectSubActs).where(eq(objectSubActs.id, id));
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'object_sub_act.deleted', entity: 'object_sub_act', recordId: id, actorId: ctx.memberId, payload: { objectId: row.objectId, number: row.number } });
}

/* ---------------- приёмка ---------------- */

/** Вложенная «транзакция» через savepoint: сбой проведения оставляет документ черновиком (как в актах заказчику) */
async function savepoint<T>(db: Db, fn: () => Promise<T>): Promise<T> {
  const name = `object_sub_act_${Math.random().toString(36).slice(2, 10)}`;
  await db.execute(sql.raw(`savepoint ${name}`));
  try {
    const out = await fn();
    await db.execute(sql.raw(`release savepoint ${name}`));
    return out;
  } catch (e) {
    await db.execute(sql.raw(`rollback to savepoint ${name}`));
    throw e;
  }
}

/** Проведение документа приёмки: закрытый период оставляет документ черновиком (предупреждение),
    превышение бюджета при политике block откатывает приёмку целиком (422 budget_exceeded) */
async function postForAccept(db: Db, ctx: SubActCtx, docId: string): Promise<string[]> {
  const docCtx = { workspaceId: ctx.workspaceId, memberId: ctx.memberId, ...(ctx.role ? { role: ctx.role } : {}) };
  try {
    const warnings = await savepoint(db, () => postDocument(db, docCtx, docId));
    return warnings ?? [];
  } catch (e) {
    if (e instanceof DomainError && e.code === 'period_closed') return ['period_closed'];
    throw e;
  }
}

/** Служебная услуга «Субподрядные работы»: строки поступления требуют товар, работ в каталоге нет.
    Одна на воркспейс, создаётся при первой приёмке. */
async function subWorkProduct(db: Db, ctx: SubActCtx): Promise<{ id: string; vatRate: VatRate }> {
  const [existing] = await db
    .select({ id: products.id, vatRate: products.vatRate })
    .from(products)
    .where(and(eq(products.kind, 'service'), eq(products.name, SUB_WORK_PRODUCT), isNull(products.archivedAt)))
    .limit(1);
  if (existing) return { id: existing.id, vatRate: existing.vatRate as VatRate };
  const [created] = await db
    .insert(products)
    .values({
      workspaceId: ctx.workspaceId,
      kind: 'service',
      sku: '',
      name: SUB_WORK_PRODUCT,
      description: 'Служебная позиция для актов субподрядчика: наименование строки берётся из акта',
      unitCode: '796',
      vatRate: '20',
      price: '0',
      purchasePrice: '0',
    })
    .returning({ id: products.id, vatRate: products.vatRate });
  return { id: created!.id, vatRate: created!.vatRate as VatRate };
}

/** Системная статья затрат «Материалы субподрядчику»: списание материалов со склада объекта */
async function subMaterialCostItem(db: Db, ctx: SubActCtx): Promise<string> {
  const [existing] = await db.select({ id: costItems.id }).from(costItems).where(and(eq(costItems.systemKey, SUB_MATERIAL_COST.key), isNull(costItems.archivedAt))).limit(1);
  if (existing) return existing.id;
  const [created] = await db.insert(costItems).values({ workspaceId: ctx.workspaceId, name: SUB_MATERIAL_COST.name, kind: 'expense', systemKey: SUB_MATERIAL_COST.key }).returning({ id: costItems.id });
  return created!.id;
}

/** Принято по заказу не может быть больше заказанного: сумма принятого по всем актам ≤ количества строки заказа */
async function assertOrderLimits(db: Db, orderId: string, actId: string, lines: ObjectSubActLineRow[]): Promise<void> {
  const [ordered, accepted, items] = await Promise.all([orderServiceLines(db, orderId), acceptedByOrderProduct(db, orderId, actId), subcontractItemsForAct(db, lines)]);
  const orderedByProduct = new Map<string, bigint>();
  for (const l of ordered) orderedByProduct.set(l.productId, (orderedByProduct.get(l.productId) ?? 0n) + dec(l.qty));
  const wanted = new Map<string, bigint>();
  for (const l of lines) {
    const productId = l.estimateItemId ? items.get(l.estimateItemId) : null;
    if (!productId || dec(l.acceptedQty) <= 0n) continue;
    wanted.set(productId, (wanted.get(productId) ?? 0n) + dec(l.acceptedQty));
  }
  for (const [productId, qty] of wanted) {
    const total = orderedByProduct.get(productId);
    // строки заказа с таким товаром нет — свободная строка акта, ограничение не действует
    if (total === undefined) continue;
    const already = accepted.get(productId) ?? 0n;
    if (already + qty > total) {
      const name = ordered.find(l => l.productId === productId)?.name ?? '';
      throw new DomainError(422, 'sub_act_exceeds_order', 'The accepted quantity cannot exceed the ordered quantity', {
        name,
        orderedQty: fmt(total, 3),
        acceptedQty: fmt(already, 3),
        qty: fmt(qty, 3),
      });
    }
  }
}

/** Товар позиции сметы для строк акта: по нему сопоставляются строки заказа */
async function subcontractItemsForAct(db: Db, lines: ObjectSubActLineRow[]): Promise<Map<string, string | null>> {
  const itemIds = [...new Set(lines.map(l => l.estimateItemId).filter((x): x is string => !!x))];
  const out = new Map<string, string | null>();
  if (!itemIds.length) return out;
  const rows = await db.select({ id: objectEstimateItems.id, productId: objectEstimateItems.productId }).from(objectEstimateItems).where(inArray(objectEstimateItems.id, itemIds));
  for (const r of rows) out.set(r.id, r.productId);
  return out;
}

export interface AcceptedSubAct {
  act: ObjectSubActRow;
  receiptDocumentId: string | null;
  writeOffDocumentId: string | null;
  /** Коды предупреждений: период закрыт (документ остался черновиком), превышение бюджета (warn) */
  warnings: string[];
}

/** Приёмка: только принятые количества идут в поступление услуг, материалы — в списание со склада объекта */
export async function acceptSubAct(db: Db, ctx: SubActCtx, id: string): Promise<AcceptedSubAct> {
  const row = await loadSubAct(db, id, true);
  assertDraft(row);
  const lines = await db.select().from(objectSubActLines).where(eq(objectSubActLines.actId, id)).orderBy(asc(objectSubActLines.sortOrder));
  if (!lines.length) throw new DomainError(422, 'sub_act_empty', 'An empty subcontract act cannot be accepted');
  for (const l of lines) {
    if (dec(l.acceptedQty) < 0n || dec(l.acceptedQty) > dec(l.qty))
      throw new DomainError(422, 'invalid_value', 'The accepted quantity must be between zero and the presented quantity', { name: l.name, qty: l.qty, acceptedQty: l.acceptedQty });
    if (dec(l.acceptedQty) < dec(l.qty) && !l.defectReasonId) throw new DomainError(422, 'rejection_reason_required', 'Select a rejection reason for the rejected quantity', { name: l.name });
  }
  if (row.orderId) await assertOrderLimits(db, row.orderId, id, lines);
  const accepted = lines.filter(l => dec(l.acceptedQty) > 0n);
  const materials = await db.select().from(objectSubActMaterials).where(eq(objectSubActMaterials.actId, id));
  // принимать нечего: ни принятого количества, ни материалов
  if (!accepted.length && !materials.length) throw new DomainError(422, 'sub_act_empty', 'Nothing is accepted: there is no accepted quantity or materials');
  const object = await assertObjectRef(db, row.objectId);
  const docCtx = { workspaceId: ctx.workspaceId, memberId: ctx.memberId, ...(ctx.role ? { role: ctx.role } : {}) };
  const warnings: string[] = [];
  const label = `Акт субподрядчика ${row.number}${row.docNumber ? ` № ${row.docNumber}` : ''} — ${object.name}`;

  let receiptDocumentId: string | null = null;
  if (accepted.length) {
    const product = await subWorkProduct(db, ctx);
    receiptDocumentId = await createDocument(db, docCtx, {
      type: 'receipt',
      counterpartyId: row.counterpartyId,
      objectId: object.id,
      date: row.docDate,
      priceIncludesVat: false,
      comment: `${label}: принятые работы`,
      lines: accepted.map(l => ({ productId: product.id, name: l.name, unitCode: l.unitCode, qty: l.acceptedQty, price: l.price, vatRate: product.vatRate, discountPct: '0' })),
    });
    warnings.push(...(await postForAccept(db, ctx, receiptDocumentId)));
  }

  let writeOffDocumentId: string | null = null;
  if (materials.length) {
    if (!object.warehouseId) throw new DomainError(422, 'object_warehouse_required', 'Select the object warehouse to write off the subcontractor materials');
    writeOffDocumentId = await createDocument(db, docCtx, {
      type: 'write_off',
      warehouseId: object.warehouseId,
      objectId: object.id,
      costItemId: await subMaterialCostItem(db, ctx),
      date: row.docDate,
      comment: `${label}: материалы субподрядчику`,
      lines: materials.map(m => ({ productId: m.productId, qty: m.qty, price: '0', discountPct: '0' })),
    });
    warnings.push(...(await postForAccept(db, ctx, writeOffDocumentId)));
  }

  const [updated] = await db
    .update(objectSubActs)
    .set({ status: 'accepted', acceptedAt: new Date(), acceptedBy: ctx.memberId, receiptDocumentId, writeOffDocumentId, updatedAt: new Date() })
    .where(eq(objectSubActs.id, id))
    .returning();
  await db.update(objects).set({ updatedAt: new Date() }).where(eq(objects.id, object.id));
  await recordEvent(db, {
    workspaceId: ctx.workspaceId,
    type: 'object_sub_act.accepted',
    entity: 'object_sub_act',
    recordId: id,
    actorId: ctx.memberId,
    payload: { objectId: object.id, number: row.number, receiptDocumentId, writeOffDocumentId, warnings },
  });
  return { act: updated!, receiptDocumentId, writeOffDocumentId, warnings };
}

/** Отклонение акта целиком с причиной: строки сохраняются для истории, документов не создаётся */
export async function rejectSubAct(db: Db, ctx: SubActCtx, id: string, reason: string): Promise<ObjectSubActRow> {
  const row = await loadSubAct(db, id, true);
  assertDraft(row);
  const text = reason.trim();
  if (!text) throw new DomainError(422, 'rejection_reason_required', 'Select a rejection reason for the whole act');
  const [updated] = await db
    .update(objectSubActs)
    .set({ status: 'rejected', rejectedAt: new Date(), rejectedBy: ctx.memberId, rejectReason: text, updatedAt: new Date() })
    .where(eq(objectSubActs.id, id))
    .returning();
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'object_sub_act.rejected', entity: 'object_sub_act', recordId: id, actorId: ctx.memberId, payload: { objectId: row.objectId, number: row.number, reason: text } });
  return updated!;
}

/** Оплаты по документу приёмки: по ним запрещена отмена приёмки */
async function receiptPaid(db: Db, act: ObjectSubActRow): Promise<bigint> {
  if (!act.receiptDocumentId) return 0n;
  const money = await actMoneyByAct(db, [{ id: act.id, invoiceDocumentId: null, actDocumentId: act.receiptDocumentId }], act.counterpartyId);
  return money.get(act.id)?.paid ?? 0n;
}

/** Отмена приёмки: admin+ и только если по поступлению нет оплат. Документы распроводятся и отменяются, акт — снова черновик */
export async function unacceptSubAct(db: Db, ctx: SubActCtx, id: string): Promise<ObjectSubActRow> {
  if (!canSeeCost(ctx.role)) throw new DomainError(403, 'forbidden', 'Only the owner or an admin can unaccept a subcontract act');
  const row = await loadSubAct(db, id, true);
  if (row.status !== 'accepted') throw new DomainError(422, 'invalid_status', 'The subcontract act is not accepted');
  if ((await receiptPaid(db, row)) > 0n) throw new DomainError(422, 'sub_act_has_payments', 'The receipt has payments: refund them before unaccepting the act');
  const docCtx = { workspaceId: ctx.workspaceId, memberId: ctx.memberId, ...(ctx.role ? { role: ctx.role } : {}) };
  // документы приёмки снимаются с проведения и отменяются: номера остаются в журнале, факт бюджета уходит
  for (const docId of [row.writeOffDocumentId, row.receiptDocumentId].filter((x): x is string => !!x)) {
    const [doc] = await db.select({ id: documents.id, status: documents.status }).from(documents).where(eq(documents.id, docId)).limit(1);
    if (!doc) continue;
    if (doc.status === 'posted') await unpostDocument(db, docCtx, docId);
    await cancelDocument(db, docCtx, docId, 'Отмена приёмки акта субподрядчика');
  }
  const [updated] = await db
    .update(objectSubActs)
    .set({ status: 'draft', acceptedAt: null, acceptedBy: null, receiptDocumentId: null, writeOffDocumentId: null, updatedAt: new Date() })
    .where(eq(objectSubActs.id, id))
    .returning();
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'object_sub_act.unaccepted', entity: 'object_sub_act', recordId: id, actorId: ctx.memberId, payload: { objectId: row.objectId, number: row.number } });
  return updated!;
}

/* ---------------- чтение для интерфейса ---------------- */

export interface SubActLineView extends Omit<ObjectSubActLineRow, 'workspaceId'> {
  unitSymbol: string;
  /** Отклонено = предъявлено − принято */
  rejectedQty: string;
  /** Сумма предъявленного, принятого и отклонённого без НДС */
  amount: string;
  acceptedAmount: string;
  rejectedAmount: string;
  reasonName: string | null;
}

export interface SubActMaterialView {
  id: string;
  productId: string;
  name: string;
  unitCode: string;
  unitSymbol: string;
  qty: string;
  note: string;
}

export interface SubActDocumentRef {
  id: string;
  number: string | null;
  status: string;
}

export interface SubActView extends Omit<ObjectSubActRow, 'workspaceId'> {
  counterpartyName: string;
  orderNumber: string | null;
  createdByName: string | null;
  acceptedByName: string | null;
  receiptDocument: SubActDocumentRef | null;
  writeOffDocument: SubActDocumentRef | null;
  lines: SubActLineView[];
  materials: SubActMaterialView[];
  totals: { presented: string; accepted: string; rejected: string };
  /** Оплачено по поступлению услуг (взаиморасчёты с субподрядчиком) */
  paid: string;
}

/** Акты субподрядчика с строками, материалами, итогами и оплатой: один набор запросов на пачку актов */
async function subActViews(db: Db, rows: ObjectSubActRow[]): Promise<SubActView[]> {
  if (!rows.length) return [];
  const ids = rows.map(r => r.id);
  const [lines, materials, symbols, companiesById, orders, membersById] = await Promise.all([
    db.select().from(objectSubActLines).where(inArray(objectSubActLines.actId, ids)).orderBy(asc(objectSubActLines.sortOrder)),
    db.select().from(objectSubActMaterials).where(inArray(objectSubActMaterials.actId, ids)),
    unitSymbols(db),
    db.select({ id: companies.id, name: companies.name }).from(companies).where(inArray(companies.id, rows.map(r => r.counterpartyId))),
    db
      .select({ id: documents.id, number: documents.number })
      .from(documents)
      .where(inArray(documents.id, rows.map(r => r.orderId).filter((x): x is string => !!x).concat('00000000-0000-0000-0000-000000000000'))),
    db
      .select({ id: members.id, name: members.name })
      .from(members)
      .where(inArray(members.id, rows.flatMap(r => [r.acceptedBy, r.createdBy].filter((x): x is string => !!x)).concat('00000000-0000-0000-0000-000000000000'))),
  ]);
  const reasonIds = [...new Set(lines.map(l => l.defectReasonId).filter((x): x is string => !!x))];
  const reasons = await db
    .select({ id: defectReasons.id, name: defectReasons.name })
    .from(defectReasons)
    .where(inArray(defectReasons.id, reasonIds.concat('00000000-0000-0000-0000-000000000000')));
  const reasonName = new Map(reasons.map(r => [r.id, r.name]));
  const docIds = [...new Set(rows.flatMap(r => [r.receiptDocumentId, r.writeOffDocumentId].filter((x): x is string => !!x)))];
  const docRows = docIds.length ? await db.select({ id: documents.id, number: documents.number, status: documents.status }).from(documents).where(inArray(documents.id, docIds)) : [];
  const docById = new Map(docRows.map(d => [d.id, d]));
  const companyName = new Map(companiesById.map(c => [c.id, c.name]));
  const orderNumber = new Map(orders.map(o => [o.id, o.number]));
  const memberName = new Map(membersById.map(m => [m.id, m.name]));
  const productIds = [...new Set(materials.map(m => m.productId))];
  const productRows = productIds.length ? await db.select({ id: products.id, name: products.name, unitCode: products.unitCode }).from(products).where(inArray(products.id, productIds)) : [];
  const productById = new Map(productRows.map(p => [p.id, p]));

  // оплаты: документы приёмки могут быть у разных субподрядчиков — считаем группой по контрагенту
  const paid = new Map<string, bigint>();
  const byCompany = new Map<string, ObjectSubActRow[]>();
  for (const r of rows) byCompany.set(r.counterpartyId, [...(byCompany.get(r.counterpartyId) ?? []), r]);
  for (const [companyId, group] of byCompany) {
    const money = await actMoneyByAct(db, group.map(r => ({ id: r.id, invoiceDocumentId: null, actDocumentId: r.receiptDocumentId })), companyId);
    for (const [k, v] of money) paid.set(k, v.paid);
  }

  return rows.map(r => {
    const own = lines.filter(l => l.actId === r.id);
    const { workspaceId, ...rest } = r;
    void workspaceId;
    let presented = 0n;
    let acceptedSum = 0n;
    for (const l of own) {
      presented += dec(subActLineAmount({ qty: l.qty, price: l.price }));
      acceptedSum += dec(subActLineAmount({ qty: l.acceptedQty, price: l.price }));
    }
    const receipt = r.receiptDocumentId ? docById.get(r.receiptDocumentId) : undefined;
    const writeOff = r.writeOffDocumentId ? docById.get(r.writeOffDocumentId) : undefined;
    return {
      ...rest,
      counterpartyName: companyName.get(r.counterpartyId) ?? '',
      orderNumber: r.orderId ? (orderNumber.get(r.orderId) ?? null) : null,
      createdByName: r.createdBy ? (memberName.get(r.createdBy) ?? null) : null,
      acceptedByName: r.acceptedBy ? (memberName.get(r.acceptedBy) ?? null) : null,
      receiptDocument: receipt ? { id: receipt.id, number: receipt.number, status: receipt.status } : null,
      writeOffDocument: writeOff ? { id: writeOff.id, number: writeOff.number, status: writeOff.status } : null,
      lines: own.map(({ workspaceId: _w, ...l }) => ({
        ...l,
        unitSymbol: symbols.get(l.unitCode) ?? l.unitCode,
        rejectedQty: fmt(dec(l.qty) - dec(l.acceptedQty), 3),
        amount: subActLineAmount({ qty: l.qty, price: l.price }),
        acceptedAmount: subActLineAmount({ qty: l.acceptedQty, price: l.price }),
        rejectedAmount: subActRejectedAmount(l),
        reasonName: l.defectReasonId ? (reasonName.get(l.defectReasonId) ?? null) : null,
      })),
      materials: materials
        .filter(m => m.actId === r.id)
        .map(m => {
          const p = productById.get(m.productId);
          return { id: m.id, productId: m.productId, name: p?.name ?? '', unitCode: p?.unitCode ?? '796', unitSymbol: symbols.get(p?.unitCode ?? '796') ?? p?.unitCode ?? '796', qty: m.qty, note: m.note };
        }),
      totals: { presented: fmt(presented, 2), accepted: fmt(acceptedSum, 2), rejected: fmt(presented - acceptedSum, 2) },
      paid: fmt(paid.get(r.id) ?? 0n, 2),
    };
  });
}

/** Акт субподрядчика по id для карточки */
export async function getSubAct(db: Db, id: string): Promise<SubActView> {
  const [row] = await subActViews(db, [await loadSubAct(db, id)]);
  return row!;
}

/* ---------------- сводка ---------------- */

export interface SubcontractOrderView {
  id: string;
  number: string | null;
  date: string;
  status: string;
  counterpartyId: string | null;
  counterpartyName: string;
  /** Заказано работ субподрядчика (строки-услуги заказа) без НДС */
  ordered: string;
  /** Принято по актам этого заказа без НДС */
  accepted: string;
}

export interface ObjectSubcontractView {
  objectId: string;
  amounts: ObjectSubcontractAmounts;
  /** Отклонено по причинам (справочник причин брака) */
  reasons: ObjectSubcontractReasonSummary[];
  /** Заказы субподрядчикам: документы supplier_order с объектом, у которых есть строки-услуги */
  orders: SubcontractOrderView[];
}

export type ObjectSubcontractReasonSummary = ObjectSubcontractRejectReason;

/** Заказы субподрядчикам объекта: заказы поставщику с объектом, у которых есть строки-работы (услуги каталога) */
async function subcontractOrders(db: Db, objectId: string): Promise<SubcontractOrderView[]> {
  const rows = await db
    .select({ id: documents.id, number: documents.number, date: documents.date, status: documents.status, counterpartyId: documents.counterpartyId })
    .from(documents)
    .where(
      and(
        eq(documents.objectId, objectId),
        eq(documents.type, 'supplier_order'),
        sql`exists (select 1 from ${documentLines} l join ${products} p on p.workspace_id = l.workspace_id and p.id = l.product_id where l.document_id = ${documents.id} and p.kind = 'service')`,
      ),
    )
    .orderBy(desc(documents.date), desc(documents.createdAt));
  if (!rows.length) return [];
  const ids = rows.map(r => r.id);
  const [serviceLines, companyRows] = await Promise.all([
    db
      .select({ documentId: documentLines.documentId, qty: documentLines.qty, price: documentLines.price, productId: documentLines.productId })
      .from(documentLines)
      .innerJoin(products, and(eq(products.workspaceId, documentLines.workspaceId), eq(products.id, documentLines.productId)))
      .where(and(inArray(documentLines.documentId, ids), eq(products.kind, 'service'))),
    db.select({ id: companies.id, name: companies.name }).from(companies).where(inArray(companies.id, rows.map(r => r.counterpartyId).filter((x): x is string => !!x).concat('00000000-0000-0000-0000-000000000000'))),
  ]);
  const companyName = new Map(companyRows.map(c => [c.id, c.name]));
  // принято по актам заказа: принятое количество по товару заказа × цена строки заказа
  const acceptedRows = await db
    .select({
      orderId: objectSubActs.orderId,
      productId: objectEstimateItems.productId,
      qty: sql<string>`coalesce(sum(${objectSubActLines.acceptedQty}), 0)::text`,
    })
    .from(objectSubActLines)
    .innerJoin(objectSubActs, and(eq(objectSubActs.workspaceId, objectSubActLines.workspaceId), eq(objectSubActs.id, objectSubActLines.actId)))
    .innerJoin(objectEstimateItems, and(eq(objectEstimateItems.workspaceId, objectSubActLines.workspaceId), eq(objectEstimateItems.id, objectSubActLines.estimateItemId)))
    .where(and(inArray(objectSubActs.orderId, ids), eq(objectSubActs.status, 'accepted')))
    .groupBy(objectSubActs.orderId, objectEstimateItems.productId);
  const acceptedQty = new Map<string, Map<string, bigint>>();
  for (const r of acceptedRows) {
    if (!r.orderId || !r.productId) continue;
    const inner = acceptedQty.get(r.orderId) ?? new Map<string, bigint>();
    inner.set(r.productId, dec(r.qty));
    acceptedQty.set(r.orderId, inner);
  }
  return rows.map(r => {
    let ordered = 0n;
    let accepted = 0n;
    for (const l of serviceLines.filter(l => l.documentId === r.id)) {
      ordered += dec(subActLineAmount({ qty: l.qty, price: l.price }));
      const qty = acceptedQty.get(r.id)?.get(l.productId) ?? 0n;
      accepted += dec(subActLineAmount({ qty: fmt(qty, 3), price: l.price }));
    }
    return {
      id: r.id,
      number: r.number,
      date: r.date,
      status: r.status,
      counterpartyId: r.counterpartyId,
      counterpartyName: r.counterpartyId ? (companyName.get(r.counterpartyId) ?? '') : '',
      ordered: fmt(ordered, 2),
      accepted: fmt(accepted, 2),
    };
  });
}

/** Сводка субподряда по объекту: заказано, предъявлено, принято, отклонено (с причинами), оплачено */
export async function objectSubcontractSummary(db: Db, objectId: string): Promise<ObjectSubcontractView> {
  await assertObjectRef(db, objectId);
  const [orders, acts] = await Promise.all([subcontractOrders(db, objectId), db.select().from(objectSubActs).where(eq(objectSubActs.objectId, objectId))]);
  const views = await subActViews(db, acts);
  let presented = 0n;
  let accepted = 0n;
  let rejected = 0n;
  let paid = 0n;
  const reasons = new Map<string, { reasonId: string | null; reasonName: string; amount: bigint; qty: bigint }>();
  const addReason = (reasonId: string | null, reasonName: string, amount: string, qty: string) => {
    const key = reasonId ?? '';
    const row = reasons.get(key) ?? { reasonId, reasonName, amount: 0n, qty: 0n };
    row.amount += dec(amount);
    row.qty += dec(qty);
    reasons.set(key, row);
  };
  for (const v of views) {
    if (v.status === 'rejected') {
      // акт отклонён целиком: всё предъявленное — отклонено с причиной акта
      const amount = v.totals.presented;
      rejected += dec(amount);
      for (const l of v.lines) addReason(null, v.rejectReason || '—', subActLineAmount({ qty: l.qty, price: l.price }), l.qty);
      continue;
    }
    presented += dec(v.totals.presented);
    if (v.status === 'accepted') {
      accepted += dec(v.totals.accepted);
      rejected += dec(v.totals.rejected);
      paid += dec(v.paid);
      for (const l of v.lines) {
        if (dec(l.rejectedQty) <= 0n) continue;
        addReason(l.defectReasonId, l.reasonName ?? '—', l.rejectedAmount, l.rejectedQty);
      }
    }
  }
  const ordered = orders.length ? orders.reduce((sum, o) => sum + dec(o.ordered), 0n) : null;
  return {
    objectId,
    amounts: {
      ordered: ordered === null ? null : fmt(ordered, 2),
      presented: fmt(presented, 2),
      accepted: fmt(accepted, 2),
      rejected: fmt(rejected, 2),
      paid: fmt(paid, 2),
    },
    reasons: [...reasons.values()].map(r => ({ reasonId: r.reasonId, reasonName: r.reasonName, amount: fmt(r.amount, 2), qty: fmt(r.qty, 3) })).sort((a, b) => (dec(b.amount) > dec(a.amount) ? 1 : -1)),
    orders,
  };
}

/** Акты субподрядчика объекта за период (по дате документа подрядчика) и сводка субподряда */
export async function objectSubActsView(
  db: Db,
  objectId: string,
  q: { from?: string | undefined; to?: string | undefined } = {},
): Promise<{ objectId: string; items: SubActView[]; subcontract: ObjectSubcontractView }> {
  await assertObjectRef(db, objectId);
  const rows = await db
    .select()
    .from(objectSubActs)
    .where(
      and(
        eq(objectSubActs.objectId, objectId),
        q.from ? sql`${objectSubActs.docDate} >= ${q.from}` : undefined,
        q.to ? sql`${objectSubActs.docDate} <= ${q.to}` : undefined,
      ),
    )
    .orderBy(desc(objectSubActs.docDate), desc(objectSubActs.createdAt));
  return { objectId, items: await subActViews(db, rows), subcontract: await objectSubcontractSummary(db, objectId) };
}
