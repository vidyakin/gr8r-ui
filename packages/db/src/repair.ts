/* Ремонт и гарантия в заказ-наряде (задача 1099, docs/architecture/serials-repair.md): тип вида, изделие клиента,
   материалы заказчика, список изделий в ремонте, гарантийный вид без выручки. Изделие клиента склад не трогает:
   у него нет движений и строк документа, поэтому остатки при приёме в ремонт не меняются. */
import { and, asc, desc, eq, ilike, isNull, or, sql } from 'drizzle-orm';
import { addMonthsISO, isRepairKind, WARRANTY_COST_ITEM_KEY, type PrintRepair, type WorkOrderKindType } from '@gr8r/shared';
import type { Db } from './client';
import { DomainError } from './errors';
import { recordEvent } from './events';
import { resolveSerialRef } from './serials';
import { companies, costItems, documentLines, documents, documentStates, products, serialNumbers, workOrderCustomerMaterials, workOrderKinds, workOrderRepairItems } from './schema';
import type { DocCtx } from './documents';

/** Тип вида заказ-наряда (обычный, если вида нет) */
export async function workOrderKindType(db: Db, kindId: string | null | undefined): Promise<WorkOrderKindType> {
  if (!kindId) return 'regular';
  const [k] = await db.select({ t: workOrderKinds.kindType }).from(workOrderKinds).where(eq(workOrderKinds.id, kindId)).limit(1);
  return (k?.t ?? 'regular') as WorkOrderKindType;
}

/** Системная статья «Гарантийный ремонт»: создаётся при необходимости (воркспейс мог занять название своей статьёй) */
export async function warrantyCostItemId(db: Db, workspaceId: string): Promise<string> {
  const [c] = await db.select({ id: costItems.id }).from(costItems).where(and(eq(costItems.workspaceId, workspaceId), eq(costItems.systemKey, WARRANTY_COST_ITEM_KEY))).limit(1);
  if (c) return c.id;
  const taken = await db.select({ id: costItems.id }).from(costItems).where(and(eq(costItems.workspaceId, workspaceId), sql`lower(${costItems.name}) = 'гарантийный ремонт'`, isNull(costItems.archivedAt))).limit(1);
  const [made] = await db
    .insert(costItems)
    .values({ workspaceId, name: taken.length ? 'Гарантийный ремонт (системная)' : 'Гарантийный ремонт', kind: 'expense', systemKey: WARRANTY_COST_ITEM_KEY })
    .returning({ id: costItems.id });
  return made!.id;
}

/** Приводит заказ-наряд к его виду: у гарантийного цены строк нулевые (выручки нет), затраты уходят на статью
    «Гарантийный ремонт»; у остальных видов статья снимается. Вызывается при создании, смене вида и правке строк */
export async function syncWarrantyKind(db: Db, ctx: DocCtx, docId: string): Promise<void> {
  const [doc] = await db.select({ kindId: documents.workOrderKindId, costItemId: documents.costItemId }).from(documents).where(eq(documents.id, docId)).limit(1);
  if (!doc) return;
  const type = await workOrderKindType(db, doc.kindId);
  if (type !== 'warranty') {
    // статью снимаем только системную гарантийную
    if (doc.costItemId) {
      const [ci] = await db.select({ key: costItems.systemKey }).from(costItems).where(eq(costItems.id, doc.costItemId)).limit(1);
      if (ci?.key === WARRANTY_COST_ITEM_KEY) await db.update(documents).set({ costItemId: null, updatedAt: new Date() }).where(eq(documents.id, docId));
    }
    return;
  }
  const itemId = await warrantyCostItemId(db, ctx.workspaceId);
  await db.update(documents).set({ costItemId: itemId, amountNet: '0', vatTotal: '0', total: '0', updatedAt: new Date() }).where(eq(documents.id, docId));
  await db.update(documentLines).set({ price: '0', discountPct: '0', net: '0', vatAmount: '0', total: '0' }).where(eq(documentLines.documentId, docId));
}

/* ---------------- изделие в ремонте ---------------- */

export type RepairItemRow = typeof workOrderRepairItems.$inferSelect;

export interface RepairItemInput {
  productId?: string | null;
  name?: string;
  serialText?: string;
  defect?: string;
  completeness?: string;
  appearance?: string;
  receivedAt?: string | null;
  returnedAt?: string | null;
  outsourceCompanyId?: string | null;
  outsourcedAt?: string | null;
  outsourceReturnedAt?: string | null;
}

async function assertRepairOrder(db: Db, documentId: string): Promise<{ kindType: WorkOrderKindType; status: string }> {
  const [doc] = await db.select({ type: documents.type, kindId: documents.workOrderKindId, status: documents.status }).from(documents).where(eq(documents.id, documentId)).limit(1);
  if (!doc || doc.type !== 'work_order') throw new DomainError(404, 'not_found', 'work order not found');
  const kindType = await workOrderKindType(db, doc.kindId);
  if (!isRepairKind(kindType)) throw new DomainError(422, 'not_repair_kind', 'The repair item is available for repair and warranty repair work orders only');
  return { kindType, status: doc.status };
}

/** Изделие в ремонте заказ-наряда (или null) */
export async function getRepairItem(db: Db, documentId: string) {
  const [row] = await db
    .select({ r: workOrderRepairItems, productName: products.name, outsourceName: companies.name, serial: serialNumbers.serial })
    .from(workOrderRepairItems)
    .leftJoin(products, eq(products.id, workOrderRepairItems.productId))
    .leftJoin(companies, eq(companies.id, workOrderRepairItems.outsourceCompanyId))
    .leftJoin(serialNumbers, eq(serialNumbers.id, workOrderRepairItems.serialId))
    .where(eq(workOrderRepairItems.documentId, documentId))
    .limit(1);
  return row ? { ...row.r, productName: row.productName, outsourceName: row.outsourceName, registrySerial: row.serial } : null;
}

/** Сохраняет изделие в ремонте: номер, найденный в реестре, связывается с ним; склад не затрагивается */
export async function saveRepairItem(db: Db, ctx: DocCtx, documentId: string, input: RepairItemInput): Promise<void> {
  await assertRepairOrder(db, documentId);
  if (input.productId) {
    const [p] = await db.select({ id: products.id }).from(products).where(eq(products.id, input.productId)).limit(1);
    if (!p) throw new DomainError(422, 'invalid_reference', 'The product does not exist');
  }
  if (input.outsourceCompanyId) {
    const [c] = await db.select({ id: companies.id }).from(companies).where(eq(companies.id, input.outsourceCompanyId)).limit(1);
    if (!c) throw new DomainError(422, 'invalid_reference', 'The company does not exist');
  }
  if (input.receivedAt && input.returnedAt && input.returnedAt < input.receivedAt) throw new DomainError(422, 'invalid_dates', 'The item cannot be returned before it is received');
  if (input.outsourcedAt && input.outsourceReturnedAt && input.outsourceReturnedAt < input.outsourcedAt) throw new DomainError(422, 'invalid_dates', 'The item cannot come back from the partner before it is sent');
  const serialText = (input.serialText ?? '').trim();
  const serialId = await resolveSerialRef(db, input.productId ?? null, serialText);
  const values = {
    productId: input.productId ?? null,
    name: (input.name ?? '').trim(),
    serialText,
    serialId,
    defect: input.defect ?? '',
    completeness: input.completeness ?? '',
    appearance: input.appearance ?? '',
    receivedAt: input.receivedAt ?? null,
    returnedAt: input.returnedAt ?? null,
    outsourceCompanyId: input.outsourceCompanyId ?? null,
    outsourcedAt: input.outsourcedAt ?? null,
    outsourceReturnedAt: input.outsourceReturnedAt ?? null,
    updatedAt: new Date(),
  };
  const [cur] = await db.select({ id: workOrderRepairItems.id }).from(workOrderRepairItems).where(eq(workOrderRepairItems.documentId, documentId)).limit(1);
  if (cur) await db.update(workOrderRepairItems).set(values).where(eq(workOrderRepairItems.id, cur.id));
  else await db.insert(workOrderRepairItems).values({ ...values, workspaceId: ctx.workspaceId, documentId, receivedAt: values.receivedAt ?? new Date().toISOString().slice(0, 10) });
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'document.updated', entity: 'document', recordId: documentId, actorId: ctx.memberId, payload: { changes: { repairItem: { from: null, to: serialText || values.name } } } });
}

/** При входе заказ-наряда в «выдан» изделию проставляется дата выдачи, если её не задали */
export async function markRepairReturned(db: Db, documentId: string): Promise<void> {
  await db
    .update(workOrderRepairItems)
    .set({ returnedAt: new Date().toISOString().slice(0, 10), updatedAt: new Date() })
    .where(and(eq(workOrderRepairItems.documentId, documentId), isNull(workOrderRepairItems.returnedAt)));
}

/* ---------------- материалы заказчика ---------------- */

export interface CustomerMaterialInput {
  id?: string;
  productId?: string | null;
  name?: string;
  qty?: string;
  comment?: string;
}

export async function listCustomerMaterials(db: Db, documentId: string) {
  const rows = await db
    .select({ m: workOrderCustomerMaterials, productName: products.name })
    .from(workOrderCustomerMaterials)
    .leftJoin(products, eq(products.id, workOrderCustomerMaterials.productId))
    .where(eq(workOrderCustomerMaterials.documentId, documentId))
    .orderBy(asc(workOrderCustomerMaterials.sortOrder), asc(workOrderCustomerMaterials.createdAt));
  return rows.map(r => ({ ...r.m, productName: r.productName }));
}

/** Материалы заказчика: список заменяется целиком; ни склад, ни себестоимость не затрагиваются */
export async function saveCustomerMaterials(db: Db, ctx: DocCtx, documentId: string, inputs: CustomerMaterialInput[]): Promise<void> {
  const [doc] = await db.select({ type: documents.type }).from(documents).where(eq(documents.id, documentId)).limit(1);
  if (!doc || doc.type !== 'work_order') throw new DomainError(404, 'not_found', 'work order not found');
  for (const [i, m] of inputs.entries()) {
    if (!m.productId && !(m.name ?? '').trim()) throw new DomainError(422, 'invalid_reference', `Row ${i + 1}: select a product or enter a name`);
    if (m.productId) {
      const [p] = await db.select({ id: products.id }).from(products).where(eq(products.id, m.productId)).limit(1);
      if (!p) throw new DomainError(422, 'invalid_reference', 'The product does not exist');
    }
  }
  await db.delete(workOrderCustomerMaterials).where(eq(workOrderCustomerMaterials.documentId, documentId));
  if (inputs.length) {
    await db.insert(workOrderCustomerMaterials).values(inputs.map((m, i) => ({ ...(m.id ? { id: m.id } : {}), workspaceId: ctx.workspaceId, documentId, productId: m.productId ?? null, name: (m.name ?? '').trim(), qty: m.qty ?? '1', comment: m.comment ?? '', sortOrder: i })));
  }
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'document.updated', entity: 'document', recordId: documentId, actorId: ctx.memberId, payload: { changes: { customerMaterials: { from: null, to: inputs.length } } } });
}

/* ---------------- список изделий в ремонте ---------------- */

export interface RepairItemsQuery {
  q?: string;
  /** '1' — принятые и не выданные (включая переданные сервис-партнёрам), '0' — выданные */
  open?: '1' | '0';
  kindType?: 'repair' | 'warranty';
  limit: number;
  offset: number;
}

export async function listRepairItems(db: Db, q: RepairItemsQuery) {
  const like = q.q ? `%${q.q.replace(/[\\%_]/g, m => '\\' + m)}%` : null;
  const where = and(
    q.open === '1' ? isNull(workOrderRepairItems.returnedAt) : q.open === '0' ? sql`${workOrderRepairItems.returnedAt} is not null` : undefined,
    q.kindType ? eq(workOrderKinds.kindType, q.kindType) : undefined,
    sql`${documents.status} <> 'cancelled'`,
    like ? or(ilike(workOrderRepairItems.serialText, like), ilike(workOrderRepairItems.name, like), ilike(products.name, like), ilike(documents.number, like), ilike(companies.name, like)) : undefined,
  );
  const base = db
    .select({
      r: workOrderRepairItems,
      productName: products.name,
      number: documents.number,
      date: documents.date,
      status: documents.status,
      stateLabel: documentStates.label,
      kindName: workOrderKinds.name,
      kindType: workOrderKinds.kindType,
      counterpartyId: documents.counterpartyId,
      counterpartyName: companies.name,
    })
    .from(workOrderRepairItems)
    .innerJoin(documents, eq(documents.id, workOrderRepairItems.documentId))
    .leftJoin(workOrderKinds, eq(workOrderKinds.id, documents.workOrderKindId))
    .leftJoin(documentStates, and(eq(documentStates.kindId, documents.workOrderKindId), eq(documentStates.key, documents.state)))
    .leftJoin(products, eq(products.id, workOrderRepairItems.productId))
    .leftJoin(companies, eq(companies.id, documents.counterpartyId));
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(workOrderRepairItems)
    .innerJoin(documents, eq(documents.id, workOrderRepairItems.documentId))
    .leftJoin(workOrderKinds, eq(workOrderKinds.id, documents.workOrderKindId))
    .leftJoin(products, eq(products.id, workOrderRepairItems.productId))
    .leftJoin(companies, eq(companies.id, documents.counterpartyId))
    .where(where);
  const rows = await base.where(where).orderBy(desc(workOrderRepairItems.receivedAt), desc(workOrderRepairItems.createdAt)).limit(q.limit).offset(q.offset);
  const partners = new Map<string, string>();
  const ids = [...new Set(rows.map(r => r.r.outsourceCompanyId).filter((x): x is string => !!x))];
  if (ids.length) for (const c of await db.select({ id: companies.id, name: companies.name }).from(companies)) if (ids.includes(c.id)) partners.set(c.id, c.name);
  return {
    items: rows.map(x => ({
      ...x.r,
      productName: x.productName,
      documentNumber: x.number,
      documentDate: x.date,
      documentStatus: x.status,
      stateLabel: x.stateLabel,
      kindName: x.kindName,
      kindType: x.kindType,
      counterpartyId: x.counterpartyId,
      counterpartyName: x.counterpartyName,
      outsourceName: x.r.outsourceCompanyId ? (partners.get(x.r.outsourceCompanyId) ?? null) : null,
      /** У сервис-партнёра: передано и ещё не возвращено */
      atPartner: !!x.r.outsourceCompanyId && !!x.r.outsourcedAt && !x.r.outsourceReturnedAt,
    })),
    total: n,
    limit: q.limit,
    offset: q.offset,
  };
}

/** Данные ремонта для актов приёма и выдачи: изделие, проверка гарантии по реестру, гарантия на ремонт, материалы заказчика */
export async function repairPrintData(db: Db, documentId: string, kindId: string | null, docDate: string, today: string): Promise<PrintRepair | undefined> {
  const kindType = await workOrderKindType(db, kindId);
  if (!isRepairKind(kindType)) return undefined;
  const item = await getRepairItem(db, documentId);
  let saleUntil: string | null = null;
  if (item?.serialId) {
    const [s] = await db.select({ until: serialNumbers.warrantyUntil, status: serialNumbers.status }).from(serialNumbers).where(eq(serialNumbers.id, item.serialId)).limit(1);
    if (s?.status === 'sold') saleUntil = s.until ?? null;
  }
  // гарантия на ремонт: наибольший срок среди товаров и работ документа
  const [w] = await db
    .select({ m: sql<number | null>`max(${products.warrantyMonths})` })
    .from(documentLines)
    .innerJoin(products, eq(products.id, documentLines.productId))
    .where(eq(documentLines.documentId, documentId));
  const months = w?.m ?? null;
  const mats = await listCustomerMaterials(db, documentId);
  return {
    kindType: kindType as 'repair' | 'warranty',
    itemName: item?.productName || item?.name || '',
    serial: item?.registrySerial || item?.serialText || '',
    defect: item?.defect ?? '',
    completeness: item?.completeness ?? '',
    appearance: item?.appearance ?? '',
    receivedAt: item?.receivedAt ?? null,
    returnedAt: item?.returnedAt ?? null,
    saleWarrantyUntil: saleUntil,
    saleWarrantyActive: saleUntil ? saleUntil >= today : null,
    repairWarrantyMonths: months && months > 0 ? months : null,
    repairWarrantyUntil: months && months > 0 ? addMonthsISO(item?.returnedAt ?? docDate, months) : null,
    customerMaterials: mats.map(m => ({ name: m.productName || m.name, qty: m.qty, comment: m.comment })),
  };
}
