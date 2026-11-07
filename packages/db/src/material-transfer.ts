/* Передача материалов под заказ на производство: строка перемещения ссылается на строку состава заказа
   (document_lines.production_component_id), «передано» = сумма проведённых перемещений по ссылке, лимит — норма × (1 + допуск, %).
   Правила — docs/architecture/production-materials.md, «Передача материалов». Перемещения без ссылки работают как раньше. */
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import { dec, fmt, overTransferLimit, type Dec } from '@gr8r/shared';
import type { Db } from './client';
import { DomainError } from './errors';
import { documentLines, documents, productionComponents, productionHeaders, workCenters, workspaces } from './schema';

/** Операции перемещения, которые считаются передачей материалов (передача в эксплуатацию склад-цех не наполняет) */
const TRANSFER_OPERATIONS = ['transfer', 'in_transit'];

/** Ссылки строк на состав заказа: строка существует, это материал или полуфабрикат того же товара, заказ — не отменён */
export async function assertTransferComponents(db: Db, lines: { productId: string; productionComponentId?: string | null }[]): Promise<void> {
  const ids = [...new Set(lines.map(l => l.productionComponentId).filter((x): x is string => !!x))];
  if (!ids.length) return;
  const comps = await db
    .select({ id: productionComponents.id, productId: productionComponents.productId, kind: productionComponents.kind, docType: documents.type, docStatus: documents.status })
    .from(productionComponents)
    .innerJoin(documents, eq(documents.id, productionComponents.documentId))
    .where(inArray(productionComponents.id, ids));
  const by = new Map(comps.map(c => [c.id, c]));
  for (const l of lines) {
    if (!l.productionComponentId) continue;
    const c = by.get(l.productionComponentId);
    if (!c || c.docType !== 'production_order' || c.docStatus === 'cancelled') throw new DomainError(422, 'invalid_reference', 'The line refers to a material of a production order that does not exist');
    if ((c.kind !== 'material' && c.kind !== 'semi') || c.productId !== l.productId) throw new DomainError(422, 'transfer_component_mismatch', 'The line does not match the material of the production order');
  }
}

/** Допуск передачи, % для заказа: у участка заказа, иначе настройка воркспейса (по умолчанию 0) */
export async function overtransferPct(db: Db, workspaceId: string, orderId: string): Promise<Dec> {
  const [row] = await db
    .select({ pct: workCenters.materialOvertransferPct })
    .from(productionHeaders)
    .innerJoin(workCenters, eq(workCenters.id, productionHeaders.workCenterId))
    .where(eq(productionHeaders.documentId, orderId))
    .limit(1);
  if (row?.pct !== null && row?.pct !== undefined) return dec(row.pct);
  const [ws] = await db.select({ settings: workspaces.settings }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  return pctFromSettings(ws?.settings);
}

/** Допуск из настроек воркспейса: число ≥ 0, иначе 0 */
export function pctFromSettings(settings: Record<string, unknown> | null | undefined): Dec {
  const v = settings?.materialOvertransferPct;
  if (typeof v !== 'number' && typeof v !== 'string') return 0n;
  const d = dec(v);
  return d > 0n ? d : 0n;
}

/** Передано по строкам состава: сумма проведённых перемещений со ссылкой на строку (кроме документа exceptDocId) */
export async function transferredByComponent(db: Db, componentIds: string[], exceptDocId?: string): Promise<Map<string, Dec>> {
  if (!componentIds.length) return new Map();
  const rows = await db
    .select({ id: documentLines.productionComponentId, qty: sql<string>`sum(${documentLines.qty})` })
    .from(documentLines)
    .innerJoin(documents, eq(documents.id, documentLines.documentId))
    .where(
      and(
        inArray(documentLines.productionComponentId, componentIds),
        eq(documents.type, 'stock_transfer'),
        eq(documents.status, 'posted'),
        inArray(documents.operation, TRANSFER_OPERATIONS),
        exceptDocId ? ne(documents.id, exceptDocId) : undefined,
      ),
    )
    .groupBy(documentLines.productionComponentId);
  return new Map(rows.map(r => [r.id!, dec(r.qty)]));
}

/** Проверка при проведении перемещения: по каждой строке состава «уже передано + это перемещение» не больше нормы × (1 + допуск).
    Строки состава блокируются (advisory-lock по id) — два перемещения под одну строку не обойдут лимит, выполняясь параллельно */
export async function assertTransferWithinNorm(db: Db, ctx: { workspaceId: string }, doc: { id: string; operation: string | null }, lines: { productId: string; qty: string; name: string; productionComponentId?: string | null }[]): Promise<void> {
  const linked = lines.filter(l => l.productionComponentId);
  if (!linked.length) return;
  if (!doc.operation || !TRANSFER_OPERATIONS.includes(doc.operation)) throw new DomainError(422, 'transfer_component_operation', 'Only a transfer between warehouses can be linked to a production order');
  await assertTransferComponents(db, linked);
  const ids = [...new Set(linked.map(l => l.productionComponentId!))].sort();
  for (const id of ids) await db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${'material-transfer:' + id}, 0))`);
  const comps = await db.select().from(productionComponents).where(inArray(productionComponents.id, ids)).orderBy(asc(productionComponents.id));
  const done = await transferredByComponent(db, ids, doc.id);
  const pcts = new Map<string, Dec>();
  for (const c of comps) {
    if (!pcts.has(c.documentId)) pcts.set(c.documentId, await overtransferPct(db, ctx.workspaceId, c.documentId));
  }
  for (const c of comps) {
    const mine = linked.filter(l => l.productionComponentId === c.id).reduce((s, l) => s + dec(l.qty), 0n);
    const pct = pcts.get(c.documentId) ?? 0n;
    const limit = overTransferLimit(dec(c.qty), pct);
    const after = (done.get(c.id) ?? 0n) + mine;
    if (after > limit) {
      const left = limit > (done.get(c.id) ?? 0n) ? limit - (done.get(c.id) ?? 0n) : 0n;
      throw new DomainError(422, 'transfer_exceeds_norm', `"${linked.find(l => l.productionComponentId === c.id)!.name}": the transfer exceeds the norm of the production order — at most ${fmt(left, 3)} more can be transferred`, {
        need: fmt(dec(c.qty), 3),
        pct: fmt(pct, 2),
        limit: fmt(limit, 3),
        transferred: fmt(done.get(c.id) ?? 0n, 3),
        available: fmt(left, 3),
        componentId: c.id,
      });
    }
  }
}

/** Недостающие материалы заказа для кнопки «Создать перемещение»: норма − передано проведёнными перемещениями (черновики не считаем) */
export async function missingTransferLines(db: Db, orderId: string): Promise<{ componentId: string; productId: string; qty: Dec }[]> {
  const comps = await db
    .select()
    .from(productionComponents)
    .where(and(eq(productionComponents.documentId, orderId), inArray(productionComponents.kind, ['material', 'semi'])))
    .orderBy(asc(productionComponents.sortOrder));
  const withProduct = comps.filter(c => c.productId && c.ownerKind !== 'customer');
  const done = await transferredByComponent(db, withProduct.map(c => c.id));
  const out: { componentId: string; productId: string; qty: Dec }[] = [];
  for (const c of withProduct) {
    const left = dec(c.qty) - (done.get(c.id) ?? 0n);
    if (left > 0n) out.push({ componentId: c.id, productId: c.productId!, qty: left });
  }
  return out;
}
