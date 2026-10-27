/* Серийные номера (задача 1099, docs/architecture/serials-repair.md): реестр, журнал событий, проведение и отмена проведения.
   Товар с флагом products.track_serials требует номера по количеству в каждом складском движении. Номера вводятся на строке
   документа (document_line_serials) или на материале заказ-наряда; при проведении они связываются с реестром, а движение
   дописывает событие в serial_events. Состояние номера — результат прогона журнала (replaySerialEvents из shared), поэтому
   отмена проведения просто удаляет события документа и пересчитывает номер; если позднейшие события перестают сходиться —
   отмена запрещена (422 serial_conflict). Изделия клиентов в ремонте склад и реестр не меняют. */
import { and, asc, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { addMonthsISO, applySerialEvent, checkSerialTransition, dec, normalizeSerial, replaySerialEvents, serialStatusAfter, type SerialStatus } from '@gr8r/shared';
import type { Db } from './client';
import { DomainError } from './errors';
import { companies, documentLineSerials, documentLines, documents, products, serialEvents, serialNumbers, warehouses, workOrderMaterials, workOrderRepairItems } from './schema';
import type { MoveRequest } from './stock';

export type SerialRow = typeof serialNumbers.$inferSelect;

/** Товары с учётом по серийным номерам среди переданных */
export async function trackedProducts(db: Db, productIds: string[]): Promise<Map<string, { name: string; warrantyMonths: number | null }>> {
  const ids = [...new Set(productIds)];
  if (!ids.length) return new Map();
  const rows = await db.select({ id: products.id, name: products.name, warrantyMonths: products.warrantyMonths }).from(products).where(and(inArray(products.id, ids), eq(products.trackSerials, true)));
  return new Map(rows.map(r => [r.id, { name: r.name, warrantyMonths: r.warrantyMonths }]));
}

const ERROR_TEXT: Record<string, string> = {
  serial_not_in_stock: 'is not in stock',
  serial_wrong_warehouse: 'is in another warehouse',
  serial_in_stock: 'is already in stock',
  serial_in_transit: 'is in transit between warehouses',
  serial_not_in_transit: 'is not in transit',
  serial_not_sold: 'was not sold',
  serial_unknown: 'is not registered',
};

/** Пересчитывает номер по журналу: состояние, данные последней продажи и гарантия. Возвращает false, если событий не осталось */
async function refreshSerial(db: Db, serialId: string): Promise<boolean> {
  const evs = await db.select().from(serialEvents).where(eq(serialEvents.serialId, serialId)).orderBy(asc(serialEvents.seq));
  if (!evs.length) return false;
  const r = replaySerialEvents(evs.map(e => ({ docType: e.docType, direction: e.direction, warehouseId: e.warehouseId })));
  const state = r.state ?? applySerialEvent(evs[evs.length - 1]!);
  const sold = state.status === 'sold' ? [...evs].reverse().find(e => e.statusAfter === 'sold') : undefined;
  await db
    .update(serialNumbers)
    .set({
      status: state.status,
      warehouseId: state.warehouseId,
      soldAt: sold?.movedAt ?? null,
      soldDocumentId: sold?.documentId ?? null,
      soldLineId: sold?.documentLineId ?? null,
      ownerCompanyId: sold?.counterpartyId ?? null,
      warrantyMonths: sold?.warrantyMonths ?? null,
      warrantyUntil: sold?.warrantyUntil ?? null,
      updatedAt: new Date(),
    })
    .where(eq(serialNumbers.id, serialId));
  return true;
}

/** Номера, введённые на строке документа или материале (порядок ввода) */
export async function loadDocumentSerials(db: Db, documentId: string) {
  return db.select().from(documentLineSerials).where(eq(documentLineSerials.documentId, documentId)).orderBy(asc(documentLineSerials.sortOrder), asc(documentLineSerials.createdAt));
}

/** Проведение движений: для товаров с номерами проверяет и записывает события номеров. Вызывается из applyStockMoves
    после проверки остатков; расходы идут раньше приходов, как и сами движения. Строки без слота (отходы разборки) не
    отслеживаются — номеров для них негде ввести */
export async function applySerialMoves(db: Db, workspaceId: string, doc: { id: string; date: string }, reqs: MoveRequest[], phaseDefault = 1): Promise<void> {
  const tracked = await trackedProducts(db, reqs.map(r => r.productId));
  if (!tracked.size) return;
  const [head] = await db.select({ type: documents.type, counterpartyId: documents.counterpartyId }).from(documents).where(eq(documents.id, doc.id)).limit(1);
  if (!head) return;
  const assigned = await loadDocumentSerials(db, doc.id);
  const ordered = [...reqs.filter(r => r.direction === 'out'), ...reqs.filter(r => r.direction === 'in')];
  for (const r of ordered) {
    const info = tracked.get(r.productId);
    if (!info || (!r.lineId && !r.materialId)) continue;
    const phase = r.phase ?? phaseDefault;
    if (r.qty % 1_000_000n !== 0n) throw new DomainError(422, 'serial_qty_not_integer', `"${info.name}": the quantity of a serial-tracked product must be a whole number`, { productId: r.productId });
    const need = Number(r.qty / 1_000_000n);
    const rows = assigned.filter(a => (r.lineId ? a.documentLineId === r.lineId : a.materialId === r.materialId));
    // приёмка перемещения «в пути» может быть частичной: берём первые номера строки
    if (rows.length !== need && !(phase === 2 && rows.length > need)) {
      throw new DomainError(422, 'serials_required', `"${info.name}": enter ${need} serial number(s), ${rows.length} entered`, { productId: r.productId, needed: need, entered: rows.length });
    }
    const taken = rows.slice(0, need);
    const seen = new Set<string>();
    for (const a of taken) {
      const text = normalizeSerial(a.serial);
      if (seen.has(text.toLowerCase())) throw new DomainError(422, 'serial_duplicate', `"${info.name}": serial number ${text} is entered twice`, { productId: r.productId, serial: text });
      seen.add(text.toLowerCase());
      const [found] = await db
        .select()
        .from(serialNumbers)
        .where(and(eq(serialNumbers.productId, r.productId), sql`lower(${serialNumbers.serial}) = ${text.toLowerCase()}`))
        .for('update')
        .limit(1);
      const prev = found ? { status: found.status as SerialStatus, warehouseId: found.warehouseId } : null;
      // материал заказ-наряда расходуется, а не продаётся: отдельный тип события
      const evType = r.materialId ? 'work_order_material' : head.type;
      const ev = { docType: evType, direction: r.direction, warehouseId: r.warehouseId };
      const code = checkSerialTransition(prev, ev);
      if (code) throw new DomainError(422, code, `"${info.name}": serial number ${text} ${ERROR_TEXT[code] ?? 'cannot be used here'}`, { productId: r.productId, serial: text });
      const status = serialStatusAfter(evType, r.direction);
      let serialId = found?.id;
      if (!serialId) {
        const [created] = await db.insert(serialNumbers).values({ workspaceId, productId: r.productId, serial: text, status, warehouseId: status === 'in_stock' ? r.warehouseId : null }).returning({ id: serialNumbers.id });
        serialId = created!.id;
      }
      const months = status === 'sold' ? info.warrantyMonths : null;
      await db.insert(serialEvents).values({
        workspaceId,
        serialId,
        documentId: doc.id,
        documentLineId: r.lineId,
        phase,
        docType: evType,
        direction: r.direction,
        warehouseId: r.warehouseId,
        counterpartyId: head.counterpartyId,
        statusAfter: status,
        movedAt: doc.date,
        warrantyMonths: months && months > 0 ? months : null,
        warrantyUntil: months && months > 0 ? addMonthsISO(doc.date, months) : null,
      });
      await refreshSerial(db, serialId);
      await db.update(documentLineSerials).set({ serialId }).where(eq(documentLineSerials.id, a.id));
    }
  }
}

/** Отмена проведения: события документа (или одной фазы) удаляются, номера пересчитываются; если позднейшие события
    не сходятся — отмена запрещена */
export async function revertSerialEvents(db: Db, _workspaceId: string, documentId: string, phase?: number): Promise<void> {
  const scope = phase ? and(eq(serialEvents.documentId, documentId), eq(serialEvents.phase, phase)) : eq(serialEvents.documentId, documentId);
  const own = await db.select({ serialId: serialEvents.serialId }).from(serialEvents).where(scope);
  if (!own.length) return;
  const ids = [...new Set(own.map(o => o.serialId))].sort();
  await db.select({ id: serialNumbers.id }).from(serialNumbers).where(inArray(serialNumbers.id, ids)).orderBy(asc(serialNumbers.id)).for('update');
  await db.delete(serialEvents).where(scope);
  const bad: string[] = [];
  for (const id of ids) {
    const evs = await db.select().from(serialEvents).where(eq(serialEvents.serialId, id)).orderBy(asc(serialEvents.seq));
    if (!evs.length) {
      await db.delete(serialNumbers).where(eq(serialNumbers.id, id));
      continue;
    }
    const r = replaySerialEvents(evs.map(e => ({ docType: e.docType, direction: e.direction, warehouseId: e.warehouseId })));
    if (r.badIndex !== null) {
      const [s] = await db.select({ serial: serialNumbers.serial }).from(serialNumbers).where(eq(serialNumbers.id, id)).limit(1);
      bad.push(s?.serial ?? id);
      continue;
    }
    await refreshSerial(db, id);
  }
  if (bad.length) throw new DomainError(422, 'serial_conflict', `Cannot unpost: later documents use these serial numbers (${bad.join(', ')}). Unpost the dependent documents first.`, { serials: bad });
  if (!phase) await db.update(documentLineSerials).set({ serialId: null }).where(eq(documentLineSerials.documentId, documentId));
}

/* ---------------- ввод номеров на строке ---------------- */

/** Заменяет номера строки документа или материала заказ-наряда (только у черновика, только у товаров с учётом по номерам) */
export async function saveSerials(db: Db, workspaceId: string, documentId: string, slot: { lineId?: string; materialId?: string }, serials: string[]): Promise<string[]> {
  if (!!slot.lineId === !!slot.materialId) throw new DomainError(422, 'invalid_reference', 'Specify either a line or a material');
  const [doc] = await db.select({ status: documents.status }).from(documents).where(eq(documents.id, documentId)).limit(1);
  if (!doc) throw new DomainError(404, 'not_found', 'document not found');
  if (doc.status !== 'draft') throw new DomainError(409, 'not_draft', 'Serial numbers of a posted document cannot be changed: unpost it first');
  let productId: string | undefined;
  if (slot.lineId) {
    const [l] = await db.select({ documentId: documentLines.documentId, productId: documentLines.productId }).from(documentLines).where(eq(documentLines.id, slot.lineId)).limit(1);
    if (!l || l.documentId !== documentId) throw new DomainError(422, 'invalid_reference', 'The line does not belong to this document');
    productId = l.productId;
  } else {
    const [m] = await db.select({ documentId: workOrderMaterials.documentId, productId: workOrderMaterials.productId }).from(workOrderMaterials).where(eq(workOrderMaterials.id, slot.materialId!)).limit(1);
    if (!m || m.documentId !== documentId) throw new DomainError(422, 'invalid_reference', 'The material does not belong to this document');
    productId = m.productId;
  }
  const clean = serials.map(normalizeSerial).filter(Boolean);
  if (clean.length && !(await trackedProducts(db, [productId])).size) throw new DomainError(422, 'serials_not_tracked', 'This product is not tracked by serial numbers: enable it in the product card first');
  const lower = clean.map(s => s.toLowerCase());
  if (new Set(lower).size !== lower.length) throw new DomainError(422, 'serial_duplicate', 'Serial numbers of a line must be different');
  const where = slot.lineId ? eq(documentLineSerials.documentLineId, slot.lineId) : eq(documentLineSerials.materialId, slot.materialId!);
  await db.delete(documentLineSerials).where(where);
  if (clean.length) await db.insert(documentLineSerials).values(clean.map((serial, i) => ({ workspaceId, documentId, documentLineId: slot.lineId ?? null, materialId: slot.materialId ?? null, serial, sortOrder: i })));
  return clean;
}

/** Номера строк документа: строка → список (после проведения — с гарантией) */
export async function lineSerialsView(db: Db, documentId: string) {
  const rows = await db
    .select({ a: documentLineSerials, status: serialNumbers.status, warrantyUntil: serialNumbers.warrantyUntil })
    .from(documentLineSerials)
    .leftJoin(serialNumbers, eq(serialNumbers.id, documentLineSerials.serialId))
    .where(eq(documentLineSerials.documentId, documentId))
    .orderBy(asc(documentLineSerials.sortOrder), asc(documentLineSerials.createdAt));
  return rows.map(r => ({ lineId: r.a.documentLineId, materialId: r.a.materialId, serial: r.a.serial, serialId: r.a.serialId, status: r.status ?? null, warrantyUntil: r.warrantyUntil ?? null }));
}

/** Инвентаризация: номера строки — фактически найденные; они должны быть в реестре на этом складе (или быть новыми) */
export async function checkInventorySerials(db: Db, doc: { id: string; warehouseId: string | null }, lines: { id: string; productId: string; qty: string; name: string }[]): Promise<void> {
  const tracked = await trackedProducts(db, lines.map(l => l.productId));
  if (!tracked.size) return;
  const assigned = await loadDocumentSerials(db, doc.id);
  for (const l of lines) {
    if (!tracked.has(l.productId)) continue;
    const qty = dec(l.qty);
    if (qty % 1_000_000n !== 0n) throw new DomainError(422, 'serial_qty_not_integer', `"${l.name}": the quantity of a serial-tracked product must be a whole number`, { productId: l.productId });
    const rows = assigned.filter(a => a.documentLineId === l.id);
    const need = Number(qty / 1_000_000n);
    if (rows.length !== need) throw new DomainError(422, 'serials_required', `"${l.name}": enter ${need} serial number(s), ${rows.length} entered`, { productId: l.productId, needed: need, entered: rows.length });
    for (const a of rows) {
      const [s] = await db.select({ status: serialNumbers.status, warehouseId: serialNumbers.warehouseId }).from(serialNumbers).where(and(eq(serialNumbers.productId, l.productId), sql`lower(${serialNumbers.serial}) = ${a.serial.toLowerCase()}`)).limit(1);
      if (s && (s.status !== 'in_stock' || s.warehouseId !== doc.warehouseId)) throw new DomainError(422, s.status === 'in_stock' ? 'serial_wrong_warehouse' : 'serial_not_in_stock', `"${l.name}": serial number ${a.serial} ${s.status === 'in_stock' ? 'is in another warehouse' : 'is not in stock'}`, { productId: l.productId, serial: a.serial });
    }
  }
}

/** Номера для документов на основании инвентаризации: недостача — номера склада, которые не найдены; излишек — найденные, которых нет в реестре */
export async function inventoryDiffSerials(db: Db, inventoryId: string, warehouseId: string, line: { id: string; productId: string }, shortage: boolean, count: number): Promise<string[]> {
  const found = (await db.select({ serial: documentLineSerials.serial }).from(documentLineSerials).where(eq(documentLineSerials.documentLineId, line.id)).orderBy(asc(documentLineSerials.sortOrder))).map(r => r.serial);
  const lower = new Set(found.map(s => s.toLowerCase()));
  if (shortage) {
    const inStock = await db
      .select({ serial: serialNumbers.serial })
      .from(serialNumbers)
      .where(and(eq(serialNumbers.productId, line.productId), eq(serialNumbers.status, 'in_stock'), eq(serialNumbers.warehouseId, warehouseId)))
      .orderBy(asc(serialNumbers.serial));
    return inStock.filter(s => !lower.has(s.serial.toLowerCase())).slice(0, count).map(s => s.serial);
  }
  const known = new Set((await db.select({ serial: serialNumbers.serial }).from(serialNumbers).where(and(eq(serialNumbers.productId, line.productId), inArray(sql`lower(${serialNumbers.serial})`, [...lower])))).map(s => s.serial.toLowerCase()));
  void inventoryId;
  return found.filter(s => !known.has(s.toLowerCase())).slice(0, count);
}

/* ---------------- реестр, карточка, поиск гарантии ---------------- */

export interface SerialListQuery {
  q?: string;
  productId?: string;
  warehouseId?: string;
  status?: SerialStatus;
  limit: number;
  offset: number;
}

/** Реестр номеров: поиск по номеру и товару */
export async function listSerials(db: Db, q: SerialListQuery) {
  const like = q.q ? `%${q.q.replace(/[\\%_]/g, m => '\\' + m)}%` : null;
  const where = and(
    q.productId ? eq(serialNumbers.productId, q.productId) : undefined,
    q.warehouseId ? eq(serialNumbers.warehouseId, q.warehouseId) : undefined,
    q.status ? eq(serialNumbers.status, q.status) : undefined,
    like ? or(ilike(serialNumbers.serial, like), ilike(products.name, like)) : undefined,
  );
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(serialNumbers).innerJoin(products, eq(products.id, serialNumbers.productId)).where(where);
  const rows = await db
    .select({ s: serialNumbers, productName: products.name, sku: products.sku, warehouseName: warehouses.name, ownerName: companies.name })
    .from(serialNumbers)
    .innerJoin(products, eq(products.id, serialNumbers.productId))
    .leftJoin(warehouses, eq(warehouses.id, serialNumbers.warehouseId))
    .leftJoin(companies, eq(companies.id, serialNumbers.ownerCompanyId))
    .where(where)
    .orderBy(desc(serialNumbers.updatedAt), asc(serialNumbers.serial))
    .limit(q.limit)
    .offset(q.offset);
  return { items: rows.map(r => ({ ...r.s, productName: r.productName, sku: r.sku, warehouseName: r.warehouseName, ownerName: r.ownerName })), total: n, limit: q.limit, offset: q.offset };
}

/** Проверка гарантии по номеру: продан когда, кому, документ, гарантия до, действует ли */
export async function lookupSerial(db: Db, serial: string, today: string) {
  const text = normalizeSerial(serial).toLowerCase();
  const rows = await db
    .select({ s: serialNumbers, productName: products.name, ownerName: companies.name, documentNumber: documents.number, warehouseName: warehouses.name })
    .from(serialNumbers)
    .innerJoin(products, eq(products.id, serialNumbers.productId))
    .leftJoin(companies, eq(companies.id, serialNumbers.ownerCompanyId))
    .leftJoin(documents, eq(documents.id, serialNumbers.soldDocumentId))
    .leftJoin(warehouses, eq(warehouses.id, serialNumbers.warehouseId))
    .where(sql`lower(${serialNumbers.serial}) = ${text}`)
    .orderBy(asc(products.name));
  return rows.map(r => ({
    serialId: r.s.id,
    productId: r.s.productId,
    productName: r.productName,
    serial: r.s.serial,
    status: r.s.status,
    warehouseName: r.warehouseName,
    soldAt: r.s.soldAt,
    ownerCompanyId: r.s.ownerCompanyId,
    ownerName: r.ownerName,
    soldDocumentId: r.s.soldDocumentId,
    soldDocumentNumber: r.documentNumber,
    warrantyUntil: r.s.warrantyUntil,
    warrantyActive: r.s.status === 'sold' && !!r.s.warrantyUntil && r.s.warrantyUntil >= today,
  }));
}

/** Карточка номера: данные, история событий и все ремонты */
export async function serialCard(db: Db, id: string, today: string) {
  const [row] = await db
    .select({ s: serialNumbers, productName: products.name, sku: products.sku, ownerName: companies.name, documentNumber: documents.number, warehouseName: warehouses.name })
    .from(serialNumbers)
    .innerJoin(products, eq(products.id, serialNumbers.productId))
    .leftJoin(companies, eq(companies.id, serialNumbers.ownerCompanyId))
    .leftJoin(documents, eq(documents.id, serialNumbers.soldDocumentId))
    .leftJoin(warehouses, eq(warehouses.id, serialNumbers.warehouseId))
    .where(eq(serialNumbers.id, id))
    .limit(1);
  if (!row) throw new DomainError(404, 'not_found', 'serial number not found');
  const events = await db
    .select({ e: serialEvents, number: documents.number, status: documents.status, warehouseName: warehouses.name, counterpartyName: companies.name })
    .from(serialEvents)
    .innerJoin(documents, eq(documents.id, serialEvents.documentId))
    .leftJoin(warehouses, eq(warehouses.id, serialEvents.warehouseId))
    .leftJoin(companies, eq(companies.id, serialEvents.counterpartyId))
    .where(eq(serialEvents.serialId, id))
    .orderBy(asc(serialEvents.seq));
  const repairs = await db
    .select({ r: workOrderRepairItems, number: documents.number, date: documents.date, state: documents.state, docStatus: documents.status, kindId: documents.workOrderKindId })
    .from(workOrderRepairItems)
    .innerJoin(documents, eq(documents.id, workOrderRepairItems.documentId))
    .where(eq(workOrderRepairItems.serialId, id))
    .orderBy(desc(documents.date));
  return {
    ...row.s,
    productName: row.productName,
    sku: row.sku,
    ownerName: row.ownerName,
    soldDocumentNumber: row.documentNumber,
    warehouseName: row.warehouseName,
    warrantyActive: row.s.status === 'sold' && !!row.s.warrantyUntil && row.s.warrantyUntil >= today,
    events: events.map(x => ({ id: x.e.id, documentId: x.e.documentId, documentNumber: x.number, documentType: x.e.docType, direction: x.e.direction, movedAt: x.e.movedAt, warehouseName: x.warehouseName, counterpartyName: x.counterpartyName, statusAfter: x.e.statusAfter, warrantyUntil: x.e.warrantyUntil })),
    repairs: repairs.map(x => ({ id: x.r.id, documentId: x.r.documentId, documentNumber: x.number, date: x.date, state: x.state, defect: x.r.defect, receivedAt: x.r.receivedAt, returnedAt: x.r.returnedAt })),
  };
}

/** Правка карточки номера: «гарантия до» (правит и последнее событие продажи, чтобы пересчёт не сбросил дату) и примечание */
export async function updateSerial(db: Db, id: string, patch: { warrantyUntil?: string | null; note?: string }): Promise<void> {
  const [s] = await db.select().from(serialNumbers).where(eq(serialNumbers.id, id)).for('update').limit(1);
  if (!s) throw new DomainError(404, 'not_found', 'serial number not found');
  if (patch.warrantyUntil !== undefined) {
    if (s.status !== 'sold') throw new DomainError(422, 'serial_not_sold', 'The warranty is set for a sold serial number');
    const [last] = await db.select({ id: serialEvents.id }).from(serialEvents).where(and(eq(serialEvents.serialId, id), eq(serialEvents.statusAfter, 'sold'))).orderBy(desc(serialEvents.seq)).limit(1);
    if (last) await db.update(serialEvents).set({ warrantyUntil: patch.warrantyUntil }).where(eq(serialEvents.id, last.id));
    await db.update(serialNumbers).set({ warrantyUntil: patch.warrantyUntil, updatedAt: new Date() }).where(eq(serialNumbers.id, id));
  }
  if (patch.note !== undefined) await db.update(serialNumbers).set({ note: patch.note, updatedAt: new Date() }).where(eq(serialNumbers.id, id));
}

/** Номер по тексту для изделия в ремонте: ровно одно совпадение (с товаром, если задан) */
export async function resolveSerialRef(db: Db, productId: string | null, text: string): Promise<string | null> {
  const t = normalizeSerial(text).toLowerCase();
  if (!t) return null;
  const rows = await db.select({ id: serialNumbers.id }).from(serialNumbers).where(and(sql`lower(${serialNumbers.serial}) = ${t}`, productId ? eq(serialNumbers.productId, productId) : undefined)).limit(2);
  return rows.length === 1 ? rows[0]!.id : null;
}

