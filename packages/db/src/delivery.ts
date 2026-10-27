/* Доставка без внешних служб (задача 1100, часть 1; docs/architecture/delivery.md): способы доставки, доставка документа
   (заказ покупателя, реализация, заказ-наряд), статусы, назначение курьера, расход при «доставлена», «мои доставки», отчёт.
   Расчёт цены и себестоимости — чистая computeDeliveryCost из shared. */
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { computeDeliveryCost, DELIVERY_COST_ITEM_KEY, DELIVERY_DOC_TYPES, deliveryWeight, dec, div, fmt, mul, type DeliveryRateInput, type DeliveryStatus, type DocumentLineInput, type Role } from '@gr8r/shared';
import type { Db } from './client';
import { DomainError } from './errors';
import { recordEvent } from './events';
import { assertPeriodOpen } from './cost-closing';
import { updateDocument, type DocCtx } from './documents';
import { companies, contacts, costItems, deliveries, deliveryMethods, documentLines, documents, members, products } from './schema';

export type DeliveryRow = typeof deliveries.$inferSelect;
export type DeliveryMethodRow = typeof deliveryMethods.$inferSelect;

const today = () => new Date().toISOString().slice(0, 10);
const isAdmin = (role: Role | undefined) => role === 'owner' || role === 'admin';
const rate = (r: Partial<DeliveryRateInput> | null | undefined): DeliveryRateInput => ({ base: r?.base ?? '0', perKm: r?.perKm ?? '0', perKg: r?.perKg ?? '0', min: r?.min ?? '0' });

/* ---------------- способы доставки ---------------- */

export interface DeliveryMethodInput {
  name: string;
  kind?: 'own_courier' | 'courier_service' | 'third_party';
  productId?: string | null;
  carrierCompanyId?: string | null;
  clientRate?: Partial<DeliveryRateInput>;
  costRate?: Partial<DeliveryRateInput>;
  freeFrom?: string | null;
}

async function assertMethodRefs(db: Db, input: Partial<DeliveryMethodInput>): Promise<void> {
  if (input.productId) {
    const [p] = await db.select({ kind: products.kind }).from(products).where(eq(products.id, input.productId)).limit(1);
    if (!p) throw new DomainError(404, 'not_found', 'product not found');
    if (p.kind !== 'service') throw new DomainError(422, 'delivery_product_not_service', 'The delivery product must be a service');
  }
  if (input.carrierCompanyId) {
    const [c] = await db.select({ id: companies.id }).from(companies).where(eq(companies.id, input.carrierCompanyId)).limit(1);
    if (!c) throw new DomainError(404, 'not_found', 'carrier company not found');
  }
}

export async function listDeliveryMethods(db: Db, archived: 'exclude' | 'include' | 'only' = 'exclude') {
  const rows = await db
    .select({ m: deliveryMethods, productName: products.name, carrierName: companies.name })
    .from(deliveryMethods)
    .leftJoin(products, eq(products.id, deliveryMethods.productId))
    .leftJoin(companies, eq(companies.id, deliveryMethods.carrierCompanyId))
    .where(archived === 'only' ? sql`${deliveryMethods.archivedAt} is not null` : archived === 'exclude' ? isNull(deliveryMethods.archivedAt) : undefined)
    .orderBy(asc(deliveryMethods.name));
  return rows.map(r => ({ ...r.m, productName: r.productName ?? null, carrierName: r.carrierName ?? null }));
}

export async function createDeliveryMethod(db: Db, ctx: DocCtx, input: DeliveryMethodInput): Promise<DeliveryMethodRow> {
  await assertMethodRefs(db, input);
  const [row] = await db
    .insert(deliveryMethods)
    .values({ workspaceId: ctx.workspaceId, name: input.name, kind: input.kind ?? 'own_courier', productId: input.productId ?? null, carrierCompanyId: input.carrierCompanyId ?? null, clientRate: rate(input.clientRate), costRate: rate(input.costRate), freeFrom: input.freeFrom ?? null })
    .returning();
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'delivery_method.created', entity: 'delivery_method', recordId: row!.id, actorId: ctx.memberId, payload: { name: input.name } });
  return row!;
}

export async function updateDeliveryMethod(db: Db, ctx: DocCtx, id: string, input: Partial<DeliveryMethodInput>): Promise<DeliveryMethodRow> {
  const [cur] = await db.select().from(deliveryMethods).where(eq(deliveryMethods.id, id)).limit(1);
  if (!cur) throw new DomainError(404, 'not_found', 'delivery method not found');
  await assertMethodRefs(db, input);
  const set: Partial<typeof deliveryMethods.$inferInsert> = { updatedAt: new Date() };
  if (input.name !== undefined) set.name = input.name;
  if (input.kind !== undefined) set.kind = input.kind;
  if (input.productId !== undefined) set.productId = input.productId;
  if (input.carrierCompanyId !== undefined) set.carrierCompanyId = input.carrierCompanyId;
  if (input.clientRate !== undefined) set.clientRate = rate({ ...cur.clientRate, ...input.clientRate });
  if (input.costRate !== undefined) set.costRate = rate({ ...cur.costRate, ...input.costRate });
  if (input.freeFrom !== undefined) set.freeFrom = input.freeFrom;
  const [row] = await db.update(deliveryMethods).set(set).where(eq(deliveryMethods.id, id)).returning();
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'delivery_method.updated', entity: 'delivery_method', recordId: id, actorId: ctx.memberId, payload: { changes: Object.keys(input) } });
  return row!;
}

export async function archiveDeliveryMethod(db: Db, ctx: DocCtx, id: string, archive: boolean): Promise<void> {
  const [cur] = await db.select({ id: deliveryMethods.id }).from(deliveryMethods).where(eq(deliveryMethods.id, id)).limit(1);
  if (!cur) throw new DomainError(404, 'not_found', 'delivery method not found');
  await db.update(deliveryMethods).set({ archivedAt: archive ? new Date() : null, updatedAt: new Date() }).where(eq(deliveryMethods.id, id));
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: archive ? 'delivery_method.archived' : 'delivery_method.restored', entity: 'delivery_method', recordId: id, actorId: ctx.memberId, payload: {} });
}

/* ---------------- курьер ---------------- */

/** Курьер, ограниченный своими доставками: отмеченный «курьер» участник без прав admin/owner */
export async function courierScope(db: Db, ctx: DocCtx): Promise<string | null> {
  if (isAdmin(ctx.role) || !ctx.memberId) return null;
  const [m] = await db.select({ isCourier: members.isCourier }).from(members).where(eq(members.id, ctx.memberId)).limit(1);
  return m?.isCourier ? ctx.memberId : null;
}

export async function setCourierFlag(db: Db, ctx: DocCtx, memberId: string, isCourier: boolean): Promise<void> {
  const [m] = await db.update(members).set({ isCourier, updatedAt: new Date() }).where(eq(members.id, memberId)).returning({ id: members.id });
  if (!m) throw new DomainError(404, 'not_found', 'member not found');
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'member.updated', entity: 'member', recordId: memberId, actorId: ctx.memberId, payload: { changes: ['isCourier'] } });
}

export async function listCouriers(db: Db) {
  return db.select({ id: members.id, name: members.name, isCourier: members.isCourier }).from(members).where(eq(members.status, 'active')).orderBy(desc(members.isCourier), asc(members.name));
}

/* ---------------- доставка документа ---------------- */

async function loadDocHead(db: Db, documentId: string) {
  const [d] = await db.select({ id: documents.id, type: documents.type, status: documents.status, counterpartyId: documents.counterpartyId, amountNet: documents.amountNet, date: documents.date, number: documents.number }).from(documents).where(eq(documents.id, documentId)).limit(1);
  if (!d) throw new DomainError(404, 'not_found', 'document not found');
  return d;
}

async function loadDelivery(db: Db, id: string, lock = false): Promise<DeliveryRow> {
  const q = db.select().from(deliveries).where(eq(deliveries.id, id)).limit(1);
  const [row] = await (lock ? q.for('update') : q);
  if (!row) throw new DomainError(404, 'not_found', 'delivery not found');
  return row;
}

/** Вес документа по строкам товаров */
export async function documentWeight(db: Db, documentId: string): Promise<string> {
  const rows = await db
    .select({ qty: documentLines.qty, weightKg: products.weightKg })
    .from(documentLines)
    .innerJoin(products, eq(products.id, documentLines.productId))
    .where(and(eq(documentLines.documentId, documentId), eq(products.kind, 'goods')));
  return deliveryWeight(rows);
}

/** Расчёт по тарифу способа: пусто без способа */
async function tariffCost(db: Db, methodId: string | null, input: { distanceKm: string; weightKg: string; orderTotal: string }) {
  if (!methodId) return null;
  const [m] = await db.select().from(deliveryMethods).where(eq(deliveryMethods.id, methodId)).limit(1);
  if (!m) throw new DomainError(404, 'not_found', 'delivery method not found');
  return computeDeliveryCost({ client: rate(m.clientRate), cost: rate(m.costRate), freeFrom: m.freeFrom }, input);
}

export interface DeliveryInput {
  methodId?: string | null;
  address?: string;
  contactName?: string;
  contactPhone?: string;
  deliveryDate?: string | null;
  windowFrom?: string | null;
  windowTo?: string | null;
  distanceKm?: string;
  weightKg?: string;
  price?: string;
  ourCost?: string;
  courierMemberId?: string | null;
  carrierCompanyId?: string | null;
  comment?: string;
  recalc?: boolean;
  recalcWeight?: boolean;
}

/** Контакт по умолчанию: адрес и телефон из контрагента (фактический адрес, иначе юридический; первый контакт) */
async function counterpartyDefaults(db: Db, counterpartyId: string | null) {
  if (!counterpartyId) return { address: '', contactName: '', contactPhone: '' };
  const [c] = await db.select({ name: companies.name, actual: companies.actualAddress, legal: companies.legalAddress }).from(companies).where(eq(companies.id, counterpartyId)).limit(1);
  const [ct] = await db.select({ name: contacts.name, phone: contacts.phone }).from(contacts).where(and(eq(contacts.companyId, counterpartyId), isNull(contacts.archivedAt))).orderBy(asc(contacts.createdAt)).limit(1);
  return { address: c?.actual || c?.legal || '', contactName: ct?.name ?? c?.name ?? '', contactPhone: ct?.phone ?? '' };
}

async function assertAssignees(db: Db, input: DeliveryInput): Promise<void> {
  if (input.courierMemberId) {
    const [m] = await db.select({ id: members.id, status: members.status }).from(members).where(eq(members.id, input.courierMemberId)).limit(1);
    if (!m) throw new DomainError(404, 'not_found', 'courier not found');
    if (m.status === 'deactivated') throw new DomainError(422, 'courier_inactive', 'The courier is deactivated');
  }
  if (input.carrierCompanyId) {
    const [c] = await db.select({ id: companies.id }).from(companies).where(eq(companies.id, input.carrierCompanyId)).limit(1);
    if (!c) throw new DomainError(404, 'not_found', 'carrier company not found');
  }
  if (input.methodId) {
    const [m] = await db.select({ archivedAt: deliveryMethods.archivedAt }).from(deliveryMethods).where(eq(deliveryMethods.id, input.methodId)).limit(1);
    if (!m) throw new DomainError(404, 'not_found', 'delivery method not found');
  }
}

/** Создаёт или правит доставку документа. При создании подставляются контакт и вес; цена и себестоимость считаются по тарифу
    (при смене способа, расстояния или веса и по recalc), если не заданы явно */
export async function saveDelivery(db: Db, ctx: DocCtx, documentId: string, input: DeliveryInput): Promise<DeliveryRow> {
  const doc = await loadDocHead(db, documentId);
  if (!(DELIVERY_DOC_TYPES as readonly string[]).includes(doc.type)) throw new DomainError(422, 'delivery_not_supported', 'Delivery is available for customer orders, shipments and work orders only');
  if (doc.status === 'cancelled') throw new DomainError(409, 'invalid_status', 'A cancelled document has no delivery');
  await assertAssignees(db, input);
  const [cur] = await db.select().from(deliveries).where(eq(deliveries.documentId, documentId)).for('update').limit(1);
  const canCost = isAdmin(ctx.role);
  const base = cur ?? null;
  const def = base ? null : await counterpartyDefaults(db, doc.counterpartyId);
  const weight = input.weightKg ?? (base && !input.recalcWeight ? base.weightKg : await documentWeight(db, documentId));
  const v = {
    methodId: input.methodId !== undefined ? input.methodId : (base?.methodId ?? null),
    address: input.address ?? base?.address ?? def?.address ?? '',
    contactName: input.contactName ?? base?.contactName ?? def?.contactName ?? '',
    contactPhone: input.contactPhone ?? base?.contactPhone ?? def?.contactPhone ?? '',
    deliveryDate: input.deliveryDate !== undefined ? input.deliveryDate : (base?.deliveryDate ?? null),
    windowFrom: input.windowFrom !== undefined ? input.windowFrom : (base?.windowFrom ?? null),
    windowTo: input.windowTo !== undefined ? input.windowTo : (base?.windowTo ?? null),
    distanceKm: input.distanceKm ?? base?.distanceKm ?? '0',
    weightKg: weight,
    courierMemberId: input.courierMemberId !== undefined ? input.courierMemberId : (base?.courierMemberId ?? null),
    carrierCompanyId: input.carrierCompanyId !== undefined ? input.carrierCompanyId : (base?.carrierCompanyId ?? null),
    comment: input.comment ?? base?.comment ?? '',
  };
  if (v.windowFrom && v.windowTo && v.windowTo < v.windowFrom) throw new DomainError(422, 'delivery_window_invalid', 'The delivery window ends before it starts');
  // способ с перевозчиком подставляет его, если перевозчик не задан
  if (input.methodId && input.carrierCompanyId === undefined && !v.carrierCompanyId) {
    const [m] = await db.select({ carrier: deliveryMethods.carrierCompanyId }).from(deliveryMethods).where(eq(deliveryMethods.id, input.methodId)).limit(1);
    v.carrierCompanyId = m?.carrier ?? null;
  }
  const changed = !base || input.recalc || input.methodId !== undefined && input.methodId !== base.methodId || input.distanceKm !== undefined && dec(input.distanceKm) !== dec(base.distanceKm) || dec(weight) !== dec(base.weightKg);
  let price = input.price ?? base?.price ?? '0';
  let ourCost = (canCost ? input.ourCost : undefined) ?? base?.ourCost ?? '0';
  if (changed) {
    const calc = await tariffCost(db, v.methodId, { distanceKm: v.distanceKm, weightKg: v.weightKg, orderTotal: doc.amountNet });
    if (calc) {
      if (input.price === undefined) price = calc.price;
      if (!(canCost && input.ourCost !== undefined)) ourCost = calc.ourCost;
    }
  }
  // назначение курьера двигает статус new ↔ assigned
  let status: DeliveryStatus = (base?.status ?? 'new') as DeliveryStatus;
  if (v.courierMemberId && status === 'new') status = 'assigned';
  if (!v.courierMemberId && status === 'assigned') status = 'new';
  let row: DeliveryRow;
  if (base) {
    [row] = await db.update(deliveries).set({ ...v, price, ourCost, status, updatedAt: new Date() }).where(eq(deliveries.id, base.id)).returning() as [DeliveryRow];
  } else {
    [row] = await db.insert(deliveries).values({ workspaceId: ctx.workspaceId, documentId, ...v, price, ourCost, status }).returning() as [DeliveryRow];
  }
  await syncExpense(db, ctx, row);
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: base ? 'delivery.updated' : 'delivery.created', entity: 'delivery', recordId: row.id, actorId: ctx.memberId, payload: { documentId, changes: Object.keys(input) } });
  return (await loadDelivery(db, row.id)) as DeliveryRow;
}

export async function deleteDelivery(db: Db, ctx: DocCtx, id: string): Promise<void> {
  const d = await loadDelivery(db, id, true);
  if (d.status === 'delivered') throw new DomainError(409, 'delivery_delivered', 'A delivered delivery cannot be deleted: return it to another status first');
  await db.delete(deliveries).where(eq(deliveries.id, id));
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'delivery.deleted', entity: 'delivery', recordId: id, actorId: ctx.memberId, payload: { documentId: d.documentId } });
}

/* ---------------- расход «Доставка» ---------------- */

async function deliveryCostItemId(db: Db, workspaceId: string): Promise<string> {
  const [c] = await db.select({ id: costItems.id }).from(costItems).where(and(eq(costItems.workspaceId, workspaceId), eq(costItems.systemKey, DELIVERY_COST_ITEM_KEY))).limit(1);
  if (c) return c.id;
  const taken = await db.select({ id: costItems.id }).from(costItems).where(and(eq(costItems.workspaceId, workspaceId), sql`lower(${costItems.name}) = 'доставка'`, isNull(costItems.archivedAt))).limit(1);
  const [made] = await db
    .insert(costItems)
    .values({ workspaceId, name: taken.length ? 'Доставка (системная)' : 'Доставка', kind: 'expense', systemKey: DELIVERY_COST_ITEM_KEY })
    .returning({ id: costItems.id });
  return made!.id;
}

/** Приводит расход в финансовый результат к статусу: «доставлена» пишет себестоимость на статью «Доставка» (у заказ-наряда — нет,
    она входит в его себестоимость как прочие затраты), любой другой статус снимает расход. Закрытый период не меняется */
async function syncExpense(db: Db, ctx: DocCtx, d: DeliveryRow): Promise<void> {
  const [doc] = await db.select({ type: documents.type }).from(documents).where(eq(documents.id, d.documentId)).limit(1);
  const delivered = d.status === 'delivered';
  const wanted = delivered && doc?.type !== 'work_order' && dec(d.ourCost) > 0n;
  const day = delivered ? (d.deliveredAt ?? today()) : null;
  if (!wanted) {
    if (d.expensedAt) await assertPeriodOpen(db, ctx.workspaceId, d.expensedAt);
    if (d.expensedAt || d.expenseCostItemId || d.deliveredAt !== day) await db.update(deliveries).set({ expenseCostItemId: null, expenseAmount: null, expensedAt: null, deliveredAt: day }).where(eq(deliveries.id, d.id));
    return;
  }
  if (d.expensedAt === day && d.expenseAmount !== null && dec(d.expenseAmount) === dec(d.ourCost)) return;
  await assertPeriodOpen(db, ctx.workspaceId, day!);
  if (d.expensedAt && d.expensedAt !== day) await assertPeriodOpen(db, ctx.workspaceId, d.expensedAt);
  const itemId = await deliveryCostItemId(db, ctx.workspaceId);
  await db.update(deliveries).set({ expenseCostItemId: itemId, expenseAmount: d.ourCost, expensedAt: day, deliveredAt: day }).where(eq(deliveries.id, d.id));
}

/* ---------------- статус и назначение ---------------- */

const COURIER_STATUSES: DeliveryStatus[] = ['in_transit', 'delivered', 'failed'];

/** Смена статуса. Курьер-участник меняет только свои доставки и только на «в пути / доставлена / не доставлена».
    «Доставлена» пишет расход, возврат из «доставлена» снимает его; доставка без курьера не может уйти «в пути» у своего курьера */
export async function changeDeliveryStatus(db: Db, ctx: DocCtx, id: string, status: DeliveryStatus, comment?: string): Promise<DeliveryRow> {
  const d = await loadDelivery(db, id, true);
  const scope = await courierScope(db, ctx);
  if (scope) {
    if (d.courierMemberId !== scope) throw new DomainError(403, 'delivery_not_yours', 'This delivery is assigned to another courier');
    if (!COURIER_STATUSES.includes(status)) throw new DomainError(403, 'delivery_status_forbidden', 'A courier can mark a delivery as in transit, delivered or failed only');
  }
  if (status === d.status && comment === undefined) return d;
  const [meth] = d.methodId ? await db.select({ kind: deliveryMethods.kind }).from(deliveryMethods).where(eq(deliveryMethods.id, d.methodId)).limit(1) : [];
  if ((status === 'assigned' || (meth?.kind === 'own_courier' && ['in_transit', 'delivered'].includes(status))) && !d.courierMemberId) throw new DomainError(422, 'courier_required', 'Assign a courier first');
  const set: Partial<typeof deliveries.$inferInsert> = { status, updatedAt: new Date() };
  if (comment !== undefined) set.comment = comment;
  if (status === 'new') set.courierMemberId = null;
  const [row] = await db.update(deliveries).set(set).where(eq(deliveries.id, id)).returning();
  await syncExpense(db, ctx, row!);
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'delivery.status_changed', entity: 'delivery', recordId: id, actorId: ctx.memberId, payload: { documentId: d.documentId, from: d.status, to: status } });
  return loadDelivery(db, id);
}

export async function assignCourier(db: Db, ctx: DocCtx, id: string, courierMemberId: string | null): Promise<DeliveryRow> {
  const d = await loadDelivery(db, id, true);
  if (d.status === 'delivered' || d.status === 'failed') throw new DomainError(409, 'delivery_closed', 'The delivery is already finished');
  await assertAssignees(db, { courierMemberId });
  const status: DeliveryStatus = courierMemberId ? (d.status === 'new' ? 'assigned' : (d.status as DeliveryStatus)) : d.status === 'assigned' ? 'new' : (d.status as DeliveryStatus);
  await db.update(deliveries).set({ courierMemberId, status, updatedAt: new Date() }).where(eq(deliveries.id, id));
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'delivery.updated', entity: 'delivery', recordId: id, actorId: ctx.memberId, payload: { documentId: d.documentId, changes: ['courierMemberId'] } });
  return loadDelivery(db, id);
}

/* ---------------- строка-услуга в документе ---------------- */

/** «Добавить в документ»: добавляет или обновляет строку-услугу «Доставка» с ценой доставки. Проведённый документ не меняется */
export async function addDeliveryToDocument(db: Db, ctx: DocCtx, deliveryId: string): Promise<DeliveryRow> {
  const d = await loadDelivery(db, deliveryId, true);
  if (!d.methodId) throw new DomainError(422, 'delivery_method_required', 'Select a delivery method first');
  const [m] = await db.select({ productId: deliveryMethods.productId }).from(deliveryMethods).where(eq(deliveryMethods.id, d.methodId)).limit(1);
  if (!m?.productId) throw new DomainError(422, 'delivery_product_required', 'The delivery method has no service for the document line');
  const doc = await loadDocHead(db, d.documentId);
  if (doc.status !== 'draft') throw new DomainError(409, 'not_draft', 'The lines of a posted document do not change');
  const lines = await db.select().from(documentLines).where(eq(documentLines.documentId, d.documentId)).orderBy(asc(documentLines.sortOrder), asc(documentLines.createdAt));
  const inputs: DocumentLineInput[] = lines.map(l => ({
    id: l.id,
    productId: l.productId,
    name: l.name,
    unitCode: l.unitCode,
    qty: l.qty,
    price: l.price,
    discountPct: l.discountPct,
    vatRate: l.vatRate as DocumentLineInput['vatRate'],
    ...(l.costItemId ? { costItemId: l.costItemId } : {}),
    ...(l.workCenterId ? { workCenterId: l.workCenterId } : {}),
    ...(l.tollingRole ? { tollingRole: l.tollingRole as DocumentLineInput['tollingRole'] } : {}),
    ...(l.params && Object.keys(l.params).length ? { params: l.params as NonNullable<DocumentLineInput['params']> } : {}),
  }));
  const existing = d.lineId ? lines.find(l => l.id === d.lineId) : undefined;
  if (existing) {
    const i = inputs.findIndex(x => x.id === existing.id);
    inputs[i] = { ...inputs[i]!, productId: m.productId, price: d.price, qty: '1', discountPct: '0' };
    delete inputs[i]!.name;
  } else {
    inputs.push({ productId: m.productId, qty: '1', price: d.price, discountPct: '0' });
  }
  await updateDocument(db, ctx, d.documentId, { lines: inputs });
  const after = await db.select({ id: documentLines.id, productId: documentLines.productId, sortOrder: documentLines.sortOrder }).from(documentLines).where(eq(documentLines.documentId, d.documentId)).orderBy(asc(documentLines.sortOrder));
  const line = existing ? after.find(l => l.id === existing.id) : [...after].reverse().find(l => l.productId === m.productId);
  await db.update(deliveries).set({ lineId: line?.id ?? null, updatedAt: new Date() }).where(eq(deliveries.id, deliveryId));
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'delivery.updated', entity: 'delivery', recordId: deliveryId, actorId: ctx.memberId, payload: { documentId: d.documentId, changes: ['line'] } });
  return loadDelivery(db, deliveryId);
}

/* ---------------- «на основании»: доставка заказа переходит к реализации ---------------- */

/** Реализация на основании заказа наследует доставку: она переходит к реализации (document_id), у заказа остаётся ссылка
    (origin_document_id). Строка-услуга привязывается к строке реализации, скопированной с исходной */
export async function inheritDelivery(db: Db, ctx: DocCtx, orderId: string, realizationId: string): Promise<void> {
  const [d] = await db.select().from(deliveries).where(eq(deliveries.documentId, orderId)).for('update').limit(1);
  if (!d || d.status === 'delivered' || d.status === 'failed') return;
  const [already] = await db.select({ id: deliveries.id }).from(deliveries).where(eq(deliveries.documentId, realizationId)).limit(1);
  if (already) return;
  let lineId: string | null = null;
  if (d.lineId) {
    const [l] = await db.select({ id: documentLines.id }).from(documentLines).where(and(eq(documentLines.documentId, realizationId), eq(documentLines.sourceLineId, d.lineId))).limit(1);
    lineId = l?.id ?? null;
  }
  await db.update(deliveries).set({ documentId: realizationId, originDocumentId: orderId, lineId, updatedAt: new Date() }).where(eq(deliveries.id, d.id));
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'delivery.updated', entity: 'delivery', recordId: d.id, actorId: ctx.memberId, payload: { documentId: realizationId, changes: ['inherited'] } });
}

/* ---------------- карточка доставки документа ---------------- */

export interface DeliveryView extends Omit<DeliveryRow, 'ourCost' | 'expenseAmount'> {
  /** Себестоимость и расход видят admin и owner */
  ourCost: string | null;
  expenseAmount: string | null;
  methodName: string | null;
  courierName: string | null;
  carrierName: string | null;
  documentType: string;
  documentNumber: string | null;
  documentDate: string;
  documentTotal: string;
  counterpartyName: string | null;
}

const viewSelect = {
  d: deliveries,
  methodName: deliveryMethods.name,
  courierName: members.name,
  carrierName: companies.name,
  documentType: documents.type,
  documentNumber: documents.number,
  documentDate: documents.date,
  documentTotal: documents.total,
};

function toView(r: { d: DeliveryRow; methodName: string | null; courierName: string | null; carrierName: string | null; documentType: string; documentNumber: string | null; documentDate: string; documentTotal: string; counterpartyName?: string | null }, role: Role | undefined): DeliveryView {
  const cost = isAdmin(role);
  return { ...r.d, ourCost: cost ? r.d.ourCost : null, expenseAmount: cost ? r.d.expenseAmount : null, methodName: r.methodName ?? null, courierName: r.courierName ?? null, carrierName: r.carrierName ?? null, documentType: r.documentType, documentNumber: r.documentNumber, documentDate: r.documentDate, documentTotal: r.documentTotal, counterpartyName: r.counterpartyName ?? null };
}

/** Доставка документа; у заказа, чья доставка перешла к реализации, — ссылка на неё (movedTo) */
export async function deliveryOfDocument(db: Db, ctx: DocCtx, documentId: string) {
  const [r] = await db
    .select({ ...viewSelect, counterpartyName: sql<string | null>`(select name from companies where companies.id = ${documents.counterpartyId})` })
    .from(deliveries)
    .innerJoin(documents, eq(documents.id, deliveries.documentId))
    .leftJoin(deliveryMethods, eq(deliveryMethods.id, deliveries.methodId))
    .leftJoin(members, eq(members.id, deliveries.courierMemberId))
    .leftJoin(companies, eq(companies.id, deliveries.carrierCompanyId))
    .where(eq(deliveries.documentId, documentId))
    .limit(1);
  const scope = await courierScope(db, ctx);
  if (r && scope && r.d.courierMemberId !== scope) return { delivery: null, movedTo: null };
  if (r) return { delivery: toView(r, ctx.role), movedTo: null };
  const [moved] = await db
    .select({ id: deliveries.id, documentId: deliveries.documentId, type: documents.type, number: documents.number, status: deliveries.status })
    .from(deliveries)
    .innerJoin(documents, eq(documents.id, deliveries.documentId))
    .where(eq(deliveries.originDocumentId, documentId))
    .limit(1);
  return { delivery: null, movedTo: moved ?? null };
}

export async function getDeliveryView(db: Db, ctx: DocCtx, id: string): Promise<DeliveryView> {
  const d = await loadDelivery(db, id);
  const out = await deliveryOfDocument(db, ctx, d.documentId);
  if (!out.delivery) throw new DomainError(404, 'not_found', 'delivery not found');
  return out.delivery;
}

/* ---------------- список, «мои доставки» ---------------- */

export interface DeliveryListQuery {
  from?: string;
  to?: string;
  courierId?: string;
  methodId?: string;
  status?: DeliveryStatus;
  q?: string;
  limit?: number;
  offset?: number;
}

/** Список доставок: по дню доставки (без даты — день создания). Курьер-участник видит только свои */
export async function listDeliveries(db: Db, ctx: DocCtx, q: DeliveryListQuery) {
  const scope = await courierScope(db, ctx);
  const day = sql<string>`coalesce(${deliveries.deliveryDate}, (${deliveries.createdAt} at time zone 'utc')::date)`;
  const where = and(
    scope ? eq(deliveries.courierMemberId, scope) : q.courierId ? eq(deliveries.courierMemberId, q.courierId) : undefined,
    q.methodId ? eq(deliveries.methodId, q.methodId) : undefined,
    q.status ? eq(deliveries.status, q.status) : undefined,
    q.from ? gte(day, q.from) : undefined,
    q.to ? lte(day, q.to) : undefined,
    q.q ? sql`(${deliveries.address} ilike ${'%' + q.q + '%'} or ${deliveries.contactName} ilike ${'%' + q.q + '%'} or ${documents.number} ilike ${'%' + q.q + '%'})` : undefined,
  );
  const base = db
    .select({ ...viewSelect, counterpartyName: sql<string | null>`(select name from companies where companies.id = ${documents.counterpartyId})` })
    .from(deliveries)
    .innerJoin(documents, eq(documents.id, deliveries.documentId))
    .leftJoin(deliveryMethods, eq(deliveryMethods.id, deliveries.methodId))
    .leftJoin(members, eq(members.id, deliveries.courierMemberId))
    .leftJoin(companies, eq(companies.id, deliveries.carrierCompanyId))
    .where(where);
  const rows = await base.orderBy(asc(day), asc(deliveries.windowFrom), asc(deliveries.createdAt)).limit(q.limit ?? 200).offset(q.offset ?? 0);
  const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(deliveries).innerJoin(documents, eq(documents.id, deliveries.documentId)).where(where);
  return { items: rows.map(r => toView(r, ctx.role)), total: n };
}

/** «Мои доставки» курьера: назначенные ему на день (по умолчанию сегодня), без доставленных и не доставленных ранее */
export async function myDeliveries(db: Db, ctx: DocCtx, date: string) {
  if (!ctx.memberId) return { items: [], total: 0 };
  return listDeliveries(db, ctx, { courierId: ctx.memberId, from: date, to: date });
}

/* ---------------- отчёт ---------------- */

export interface DeliveryReportRow {
  key: string;
  label: string;
  count: number;
  delivered: number;
  failed: number;
  revenue: string;
  /** Себестоимость и маржа — только admin и owner */
  cost: string | null;
  margin: string | null;
  failedPct: string | null;
}

export interface DeliveryReport {
  from: string;
  to: string;
  by: 'method' | 'courier' | 'day' | 'month';
  rows: DeliveryReportRow[];
  totals: Omit<DeliveryReportRow, 'key' | 'label'>;
}

/** Отчёт по доставкам за период: число, выручка и себестоимость доставленных, маржа, доля недоставленных среди завершённых */
export async function deliveryReport(db: Db, ctx: DocCtx, q: { from: string; to: string; by: 'method' | 'courier' | 'day' | 'month' }): Promise<DeliveryReport> {
  const day = sql<string>`coalesce(${deliveries.deliveryDate}, (${deliveries.createdAt} at time zone 'utc')::date)`;
  const rows = await db
    .select({ d: deliveries, methodName: deliveryMethods.name, courierName: members.name, day: sql<string>`(${day})::text` })
    .from(deliveries)
    .leftJoin(deliveryMethods, eq(deliveryMethods.id, deliveries.methodId))
    .leftJoin(members, eq(members.id, deliveries.courierMemberId))
    .where(and(gte(day, q.from), lte(day, q.to)));
  const cost = isAdmin(ctx.role);
  const groups = new Map<string, { label: string; count: number; delivered: number; failed: number; revenue: bigint; cost: bigint }>();
  for (const r of rows) {
    const [key, label] = q.by === 'method' ? [r.d.methodId ?? '', r.methodName ?? ''] : q.by === 'courier' ? [r.d.courierMemberId ?? '', r.courierName ?? ''] : q.by === 'day' ? [r.day, r.day] : [r.day.slice(0, 7), r.day.slice(0, 7)];
    const g = groups.get(key) ?? { label, count: 0, delivered: 0, failed: 0, revenue: 0n, cost: 0n };
    g.count += 1;
    if (r.d.status === 'delivered') {
      g.delivered += 1;
      g.revenue += dec(r.d.price);
      g.cost += dec(r.d.ourCost);
    } else if (r.d.status === 'failed') g.failed += 1;
    groups.set(key, g);
  }
  const pct = (failed: number, delivered: number) => (failed + delivered > 0 ? fmt(mul(div(dec(failed), dec(failed + delivered)), dec(100)), 1) : null);
  const mk = (key: string, g: { label: string; count: number; delivered: number; failed: number; revenue: bigint; cost: bigint }): DeliveryReportRow => ({
    key,
    label: g.label,
    count: g.count,
    delivered: g.delivered,
    failed: g.failed,
    revenue: fmt(g.revenue, 2),
    cost: cost ? fmt(g.cost, 2) : null,
    margin: cost ? fmt(g.revenue - g.cost, 2) : null,
    failedPct: pct(g.failed, g.delivered),
  });
  const list = [...groups.entries()].map(([k, g]) => mk(k, g)).sort((a, b) => (q.by === 'day' || q.by === 'month' ? a.key.localeCompare(b.key) : b.count - a.count));
  const t = { label: '', count: 0, delivered: 0, failed: 0, revenue: 0n, cost: 0n };
  for (const g of groups.values()) {
    t.count += g.count;
    t.delivered += g.delivered;
    t.failed += g.failed;
    t.revenue += g.revenue;
    t.cost += g.cost;
  }
  const { key: _k, label: _l, ...totals } = mk('', t);
  return { from: q.from, to: q.to, by: q.by, rows: list, totals };
}

/* ---------------- себестоимость заказ-наряда и маршрутный лист ---------------- */

/** Себестоимость доставленных доставок заказ-нарядов: входит в «прочие затраты» их себестоимости */
export async function deliveredCostByWorkOrder(db: Db, workspaceId: string, ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const rows = await db
    .select({ documentId: deliveries.documentId, cost: sql<string>`coalesce(sum(${deliveries.ourCost}), 0)::text` })
    .from(deliveries)
    .where(and(eq(deliveries.workspaceId, workspaceId), inArray(deliveries.documentId, ids), eq(deliveries.status, 'delivered')))
    .groupBy(deliveries.documentId);
  return new Map(rows.map(r => [r.documentId, r.cost]));
}

export interface RouteSheetData {
  date: string;
  courierName: string;
  items: { time: string; address: string; contact: string; phone: string; document: string; total: string; comment: string }[];
  total: string;
}

/** Данные маршрутного листа курьера на день */
export async function routeSheet(db: Db, ctx: DocCtx, courierId: string, date: string): Promise<RouteSheetData> {
  const scope = await courierScope(db, ctx);
  if (scope && scope !== courierId) throw new DomainError(403, 'delivery_not_yours', 'The route sheet of another courier is not available');
  const [m] = await db.select({ name: members.name }).from(members).where(eq(members.id, courierId)).limit(1);
  if (!m) throw new DomainError(404, 'not_found', 'courier not found');
  const { items } = await listDeliveries(db, ctx, { courierId, from: date, to: date });
  const active = items.filter(i => i.status !== 'failed');
  return {
    date,
    courierName: m.name,
    items: active.map(i => ({
      time: [i.windowFrom?.slice(0, 5), i.windowTo?.slice(0, 5)].filter(Boolean).join('–'),
      address: i.address,
      contact: i.contactName,
      phone: i.contactPhone,
      document: [i.documentNumber, i.counterpartyName].filter(Boolean).join(' · '),
      total: i.documentTotal,
      comment: i.comment,
    })),
    total: fmt(active.reduce((s, i) => s + dec(i.documentTotal), 0n), 2),
  };
}
