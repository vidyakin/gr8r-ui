/* Остаток незавершённого производства (НЗП) по участкам — задача 1137, раздел docs/architecture/production-stages.md.

   НЗП промежуточного этапа числится на завершающем участке своего выпуска (`production_headers.final_work_center_id`),
   этапы при этом выполняют любые участки. Остаток на дату — выпуски до даты включительно:
   - количество в НЗП = выполнено на первом промежуточном этапе минус принято финальным этапом (годное и брак);
   - сумма НЗП = по каждому этапу средняя стоимость единицы (затраты этапа плюс косвенные закрытия месяца) × сколько единиц
     этого этапа ещё не принято финальным. Финальный этап забирает НЗП на любом участке; приём делится между
     завершающими участками по порядку выпуска промежуточных этапов.
   Суммы маскирует API (себестоимость видят admin и owner). Полное движение НЗП — этап 9 (1091). */
import { and, eq, inArray, lte, sql } from 'drizzle-orm';
import { dec, div, fmt, mul } from '@gr8r/shared';
import type { Db } from './client';
import { documentLines, documents, manufacturedItems, productionHeaders, productionItems, productionStages, workCenters } from './schema';

export interface WipStage {
  stageId: string | null;
  name: string;
  sortOrder: number;
  /** Выполнено на этапе (годное) */
  done: string;
}

export interface WipItem {
  /** Источник: позиция заказа на производство или строка заказа покупателя */
  key: string;
  itemName: string;
  stages: WipStage[];
  /** Количество в НЗП */
  qty: string;
  /** Сумма НЗП (null — нет доступа к себестоимости) */
  amount: string | null;
}

export interface WipOrder {
  /** Заказ на производство (или заказ покупателя, если выпуск шёл прямо по нему) */
  orderId: string | null;
  number: string | null;
  date: string | null;
  items: WipItem[];
  amount: string | null;
}

export interface WipCenter {
  workCenterId: string | null;
  workCenterName: string | null;
  orders: WipOrder[];
  amount: string | null;
}

export interface WipBalance {
  date: string;
  centers: WipCenter[];
  total: string | null;
}

/** Остаток НЗП на дату (выпуски по дату включительно), по завершающим участкам → заказам → изделиям */
export async function wipBalance(db: Db, workspaceId: string, params: { date?: string; workCenterId?: string }): Promise<WipBalance> {
  const date = params.date ?? new Date().toISOString().slice(0, 10);
  const rows = await db
    .select({
      source: productionItems.sourceItemId,
      customer: productionItems.customerOrderLineId,
      stageId: productionHeaders.stageId,
      stageName: productionStages.name,
      sortOrder: productionStages.sortOrder,
      isFinal: productionStages.isFinal,
      center: sql<string | null>`coalesce(${productionHeaders.finalWorkCenterId}, ${productionHeaders.workCenterId})`,
      qty: productionItems.qty,
      defectQty: productionItems.defectQty,
      cost: sql<string>`(coalesce(${productionItems.stageCost}, 0) + ${productionItems.closingCost})::text`,
      itemName: manufacturedItems.name,
      date: documents.date,
    })
    .from(productionItems)
    .innerJoin(documents, eq(documents.id, productionItems.documentId))
    .innerJoin(manufacturedItems, eq(manufacturedItems.id, productionItems.itemId))
    .leftJoin(productionHeaders, and(eq(productionHeaders.workspaceId, workspaceId), eq(productionHeaders.documentId, documents.id)))
    .leftJoin(productionStages, eq(productionStages.id, productionHeaders.stageId))
    .where(and(eq(productionItems.workspaceId, workspaceId), eq(documents.type, 'production'), eq(documents.status, 'posted'), lte(documents.date, date), sql`(${productionItems.sourceItemId} is not null or ${productionItems.customerOrderLineId} is not null)`));

  // источники: позиция заказа или строка заказа покупателя
  const srcKey = (r: { source: string | null; customer: string | null }) => (r.source ? `s:${r.source}` : `c:${r.customer}`);
  const bySource = new Map<string, typeof rows>();
  for (const r of rows) bySource.set(srcKey(r), [...(bySource.get(srcKey(r)) ?? []), r]);

  interface Group { source: string; center: string | null; itemName: string; stages: Map<string, { stageId: string | null; name: string; sortOrder: number; done: bigint; cost: bigint }>; first: string; consumed: bigint }
  const groups: Group[] = [];
  for (const [source, list] of bySource) {
    // принято финальным этапом: у выпуска без этапа этап «Завершение производства»
    const finalQty = list.filter(r => !r.stageId || r.isFinal).reduce((s, r) => s + dec(r.qty), 0n);
    const perCenter = new Map<string, Group>();
    for (const r of list) {
      if (!r.stageId || r.isFinal) continue;
      const ck = r.center ?? '';
      const g = perCenter.get(ck) ?? { source, center: r.center, itemName: r.itemName, stages: new Map(), first: r.date, consumed: 0n };
      if (r.date < g.first) g.first = r.date;
      const st = g.stages.get(r.stageId) ?? { stageId: r.stageId, name: r.stageName ?? '', sortOrder: r.sortOrder ?? 0, done: 0n, cost: 0n };
      st.done += dec(r.qty) - dec(r.defectQty);
      st.cost += dec(r.cost);
      g.stages.set(r.stageId, st);
      perCenter.set(ck, g);
    }
    // приём финального этапа забирает НЗП по порядку выпуска промежуточных этапов
    let left = finalQty;
    for (const g of [...perCenter.values()].sort((a, b) => (a.first < b.first ? -1 : a.first > b.first ? 1 : 0))) {
      const started = [...g.stages.values()].reduce((m, s) => (s.done > m ? s.done : m), 0n);
      g.consumed = left < started ? left : started;
      left -= g.consumed;
      groups.push(g);
    }
  }

  // названия участков, заказов и позиций
  const centers = new Map((await db.select({ id: workCenters.id, name: workCenters.name }).from(workCenters).where(eq(workCenters.workspaceId, workspaceId))).map(c => [c.id, c.name]));
  const itemIds = [...new Set(groups.filter(g => g.source.startsWith('s:')).map(g => g.source.slice(2)))];
  const lineIds = [...new Set(groups.filter(g => g.source.startsWith('c:')).map(g => g.source.slice(2)))];
  const orderOf = new Map<string, string>();
  if (itemIds.length) for (const r of await db.select({ id: productionItems.id, documentId: productionItems.documentId }).from(productionItems).where(inArray(productionItems.id, itemIds))) orderOf.set(`s:${r.id}`, r.documentId);
  if (lineIds.length) for (const r of await db.select({ id: documentLines.id, documentId: documentLines.documentId }).from(documentLines).where(inArray(documentLines.id, lineIds))) orderOf.set(`c:${r.id}`, r.documentId);
  const docIds = [...new Set(orderOf.values())];
  const docs = new Map((docIds.length ? await db.select({ id: documents.id, number: documents.number, date: documents.date }).from(documents).where(inArray(documents.id, docIds)) : []).map(d => [d.id, d]));

  const out = new Map<string, WipCenter>();
  let total = 0n;
  for (const g of groups) {
    if (params.workCenterId && g.center !== params.workCenterId) continue;
    // по каждому этапу: средняя стоимость единицы × единицы, ещё не принятые финальным этапом
    let qty = 0n;
    let amount = 0n;
    for (const st of g.stages.values()) {
      const rest = st.done - g.consumed;
      if (rest <= 0n || st.done <= 0n) continue;
      if (rest > qty) qty = rest;
      amount += mul(div(st.cost, st.done), rest);
    }
    if (qty <= 0n) continue;
    const ck = g.center ?? '';
    const center = out.get(ck) ?? { workCenterId: g.center, workCenterName: g.center ? (centers.get(g.center) ?? null) : null, orders: [], amount: '0' };
    const docId = orderOf.get(g.source) ?? null;
    const doc = docId ? docs.get(docId) : undefined;
    let order = center.orders.find(o => o.orderId === docId);
    if (!order) {
      order = { orderId: docId, number: doc?.number ?? null, date: doc?.date ?? null, items: [], amount: '0' };
      center.orders.push(order);
    }
    order.items.push({
      key: g.source,
      itemName: g.itemName,
      stages: [...g.stages.values()].sort((a, b) => a.sortOrder - b.sortOrder).map(s => ({ stageId: s.stageId, name: s.name, sortOrder: s.sortOrder, done: fmt(s.done, 3) })),
      qty: fmt(qty, 3),
      amount: fmt(amount, 2),
    });
    order.amount = fmt(dec(order.amount) + amount, 2);
    center.amount = fmt(dec(center.amount) + amount, 2);
    total += amount;
    out.set(ck, center);
  }
  const list = [...out.values()].sort((a, b) => (a.workCenterName ?? '￿').localeCompare(b.workCenterName ?? '￿'));
  for (const c of list) {
    c.orders.sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '') || (a.number ?? '').localeCompare(b.number ?? ''));
    for (const o of c.orders) o.items.sort((a, b) => a.itemName.localeCompare(b.itemName));
  }
  return { date, centers: list, total: fmt(total, 2) };
}

/** Суммы видят только роли с доступом к себестоимости; остальным остаются количества */
export function maskWipBalance(b: WipBalance, seeCost: boolean): WipBalance {
  if (seeCost) return b;
  return {
    ...b,
    total: null,
    centers: b.centers.map(c => ({ ...c, amount: null, orders: c.orders.map(o => ({ ...o, amount: null, items: o.items.map(i => ({ ...i, amount: null })) })) })),
  };
}
