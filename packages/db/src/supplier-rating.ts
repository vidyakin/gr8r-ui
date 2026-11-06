/* Рейтинг поставщиков: расчёт на лету по проведённым документам (задача 1276). */
import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import type { Db } from './client';
import { companies, documents, documentLines, stockBatches, workspaces } from './schema';
import { computeSupplierRating, DEFAULT_SUPPLIER_RATING_WEIGHTS, type SupplierRatingWeights } from '@gr8r/shared';
import { dec } from '@gr8r/shared';

const PURCHASE_TYPES = ['supplier_order', 'receipt', 'supplier_return'] as const;

export interface SupplierRatingSettings {
  weights: SupplierRatingWeights;
  dPolicy: 'none' | 'warn' | 'block';
}

export async function loadSupplierRatingSettings(db: Db, workspaceId: string): Promise<SupplierRatingSettings> {
  const [ws] = await db.select({ w: workspaces.supplierRatingWeights, p: workspaces.supplierRatingDPolicy }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  const w = (ws?.w as any) ?? {};
  return {
    weights: {
      onTime: Number(w?.onTime ?? DEFAULT_SUPPLIER_RATING_WEIGHTS.onTime),
      completeness: Number(w?.completeness ?? DEFAULT_SUPPLIER_RATING_WEIGHTS.completeness),
      quality: Number(w?.quality ?? DEFAULT_SUPPLIER_RATING_WEIGHTS.quality),
    },
    dPolicy: (ws?.p as any) ?? 'none',
  };
}

export async function saveSupplierRatingSettings(db: Db, workspaceId: string, body: { weights?: Partial<SupplierRatingWeights>; dPolicy?: string }): Promise<SupplierRatingSettings> {
  const patch: any = { updatedAt: new Date() };
  if (body.weights) patch.supplierRatingWeights = { ...DEFAULT_SUPPLIER_RATING_WEIGHTS, ...body.weights };
  if (body.dPolicy) patch.supplierRatingDPolicy = body.dPolicy;
  await db.update(workspaces).set(patch).where(eq(workspaces.id, workspaceId));
  return loadSupplierRatingSettings(db, workspaceId);
}

function defaultPeriod(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to);
  from.setFullYear(from.getFullYear() - 1);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

export function defaultSupplierRatingPeriod() {
  return defaultPeriod();
}

interface CalcResult {
  companyId: string;
  companyName: string;
  ordersCount: number;
  onTimeRate: number | null;
  completenessRate: number | null;
  qualityRate: number | null;
  rating: number | null;
  level: 'A' | 'B' | 'C' | 'D' | null;
  onTimeOrders: number;
  dueDateOrders: number;
  orderedQty: string;
  receivedQty: string;
  receivedQtyQuality: string;
  rejectedQty: string;
  returnedQty: string;
}

async function calculate(db: Db, workspaceId: string, from: string, to: string): Promise<CalcResult[]> {
  const settings = await loadSupplierRatingSettings(db, workspaceId);
  // posted purchase docs in period
  const docs = await db
    .select({ id: documents.id, type: documents.type, counterpartyId: documents.counterpartyId, date: documents.date, dueDate: documents.dueDate, basedOnId: documents.basedOnId })
    .from(documents)
    .where(and(inArray(documents.type, [...PURCHASE_TYPES]), eq(documents.status, 'posted'), gte(documents.date, from), lte(documents.date, to)));
  const companyIds = [...new Set(docs.map(d => d.counterpartyId).filter((x): x is string => !!x))];
  if (!companyIds.length) return [];
  const companyRows = await db.select({ id: companies.id, name: companies.name }).from(companies).where(inArray(companies.id, companyIds));
  const nameMap = new Map(companyRows.map(c => [c.id, c.name]));

  // orders (supplier_order) in period
  const orders = docs.filter(d => d.type === 'supplier_order');
  const orderIds = orders.map(o => o.id);

  // lines of orders
  const orderLines = orderIds.length
    ? await db.select({ documentId: documentLines.documentId, qty: documentLines.qty }).from(documentLines).where(inArray(documentLines.documentId, orderIds))
    : [];
  const orderedByOrder = new Map<string, bigint>();
  for (const l of orderLines) orderedByOrder.set(l.documentId, (orderedByOrder.get(l.documentId) ?? 0n) + dec(l.qty));

  // receipts in period
  const receipts = docs.filter(d => d.type === 'receipt');
  const receiptIds = receipts.map(r => r.id);
  const receiptLines = receiptIds.length
    ? await db.select({ documentId: documentLines.documentId, id: documentLines.id, qty: documentLines.qty }).from(documentLines).where(inArray(documentLines.documentId, receiptIds))
    : [];
  const receiptQtyByDoc = new Map<string, bigint>();
  for (const l of receiptLines) receiptQtyByDoc.set(l.documentId, (receiptQtyByDoc.get(l.documentId) ?? 0n) + dec(l.qty));

  // receipts based on orders (any period? use those in period docs only)
  const receiptsByBase = new Map<string, typeof receipts>();
  for (const r of receipts) {
    if (r.basedOnId) {
      const arr = receiptsByBase.get(r.basedOnId) ?? [];
      arr.push(r);
      receiptsByBase.set(r.basedOnId, arr);
    }
  }

  // rejected batches created by receipt lines
  const allReceiptLineIds = receiptLines.map(l => l.id);
  const rejectedLineIds = new Set<string>();
  if (allReceiptLineIds.length) {
    const batches = await db
      .select({ documentLineId: stockBatches.documentLineId, status: stockBatches.status })
      .from(stockBatches)
      .where(and(inArray(stockBatches.documentLineId, allReceiptLineIds), eq(stockBatches.status, 'rejected')));
    for (const b of batches) if (b.documentLineId) rejectedLineIds.add(b.documentLineId);
  }
  const rejectedQtyByLine = new Map<string, bigint>();
  for (const l of receiptLines) if (rejectedLineIds.has(l.id)) rejectedQtyByLine.set(l.id, dec(l.qty));

  // returns in period
  const returns = docs.filter(d => d.type === 'supplier_return');
  const returnIds = returns.map(r => r.id);
  const returnLines = returnIds.length
    ? await db.select({ documentId: documentLines.documentId, qty: documentLines.qty }).from(documentLines).where(inArray(documentLines.documentId, returnIds))
    : [];
  const returnQtyByDoc = new Map<string, bigint>();
  for (const l of returnLines) returnQtyByDoc.set(l.documentId, (returnQtyByDoc.get(l.documentId) ?? 0n) + dec(l.qty));

  const results: CalcResult[] = [];
  for (const cid of companyIds) {
    const companyOrders = orders.filter(o => o.counterpartyId === cid);
    const companyReceipts = receipts.filter(r => r.counterpartyId === cid);
    const companyReturns = returns.filter(r => r.counterpartyId === cid);

    // timeliness
    const dueOrders = companyOrders.filter(o => !!o.dueDate);
    let onTimeCount = 0;
    for (const o of dueOrders) {
      const rs = receiptsByBase.get(o.id) ?? [];
      if (rs.some(r => r.date <= (o.dueDate as string))) onTimeCount++;
    }
    const onTimeRate = dueOrders.length ? (onTimeCount / dueOrders.length) * 100 : null;

    // completeness
    let orderedTotal = 0n;
    let receivedTotal = 0n;
    for (const o of companyOrders) {
      const ord = orderedByOrder.get(o.id) ?? 0n;
      orderedTotal += ord;
      const rs = receiptsByBase.get(o.id) ?? [];
      let rec = 0n;
      for (const r of rs) rec += receiptQtyByDoc.get(r.id) ?? 0n;
      if (rec > ord) rec = ord;
      receivedTotal += rec;
    }
    const completenessRate = orderedTotal > 0n ? Number(receivedTotal * 10000n / orderedTotal) / 100 : null;

    // quality
    let receivedQ = 0n;
    for (const r of companyReceipts) receivedQ += receiptQtyByDoc.get(r.id) ?? 0n;
    let rejectedQ = 0n;
    for (const r of companyReceipts) {
      const lines = receiptLines.filter(l => l.documentId === r.id);
      for (const l of lines) if (rejectedLineIds.has(l.id)) rejectedQ += dec(l.qty);
    }
    let returnedQ = 0n;
    for (const r of companyReturns) returnedQ += returnQtyByDoc.get(r.id) ?? 0n;

    let qualityRate: number | null = null;
    if (receivedQ > 0n) {
      const rejPct = Number(rejectedQ * 10000n / receivedQ) / 100;
      const retPct = Number(returnedQ * 10000n / receivedQ) / 100;
      qualityRate = 100 - rejPct + retPct;
      if (qualityRate < 0) qualityRate = 0;
      if (qualityRate > 100) qualityRate = 100;
    }

    const ratingRes = computeSupplierRating({ onTime: onTimeRate, completeness: completenessRate, quality: qualityRate, weights: settings.weights });
    results.push({
      companyId: cid,
      companyName: nameMap.get(cid) ?? '',
      ordersCount: companyOrders.length,
      onTimeRate,
      completenessRate,
      qualityRate,
      rating: ratingRes.score,
      level: ratingRes.level,
      onTimeOrders: onTimeCount,
      dueDateOrders: dueOrders.length,
      orderedQty: orderedTotal.toString(),
      receivedQty: receivedTotal.toString(),
      receivedQtyQuality: receivedQ.toString(),
      rejectedQty: rejectedQ.toString(),
      returnedQty: returnedQ.toString(),
    });
  }
  return results;
}

export async function listSupplierRatings(db: Db, workspaceId: string, from?: string, to?: string) {
  const p = from && to ? { from, to } : defaultPeriod();
  const rows = await calculate(db, workspaceId, p.from, p.to);
  return rows.map(r => ({
    companyId: r.companyId,
    companyName: r.companyName,
    ordersCount: r.ordersCount,
    onTimeRate: r.onTimeRate,
    completenessRate: r.completenessRate,
    qualityRate: r.qualityRate,
    rating: r.rating,
    level: r.level,
    // aliases
    onTime: r.onTimeRate,
    completeness: r.completenessRate,
    quality: r.qualityRate,
    score: r.rating,
    grade: r.level,
    indicators: { onTime: r.onTimeRate, completeness: r.completenessRate, quality: r.qualityRate },
  }));
}

export async function getSupplierRating(db: Db, workspaceId: string, companyId: string, from?: string, to?: string) {
  const p = from && to ? { from, to } : defaultPeriod();
  const rows = await calculate(db, workspaceId, p.from, p.to);
  const r = rows.find(x => x.companyId === companyId);
  if (!r) {
    // still return empty rating
    const [c] = await db.select({ name: companies.name }).from(companies).where(and(eq(companies.id, companyId))).limit(1);
    return {
      companyId,
      companyName: c?.name ?? '',
      from: p.from,
      to: p.to,
      ordersCount: 0,
      onTimeRate: null,
      completenessRate: null,
      qualityRate: null,
      rating: null,
      level: null,
      onTime: null,
      completeness: null,
      quality: null,
      score: null,
      grade: null,
      onTimeOrders: 0,
      dueDateOrders: 0,
      orderedQty: '0',
      receivedQty: '0',
      receivedQtyQuality: '0',
      rejectedQty: '0',
      returnedQty: '0',
    };
  }
  return {
    companyId: r.companyId,
    companyName: r.companyName,
    from: p.from,
    to: p.to,
    ordersCount: r.ordersCount,
    onTimeRate: r.onTimeRate,
    completenessRate: r.completenessRate,
    qualityRate: r.qualityRate,
    rating: r.rating,
    level: r.level,
    onTime: r.onTimeRate,
    completeness: r.completenessRate,
    quality: r.qualityRate,
    score: r.rating,
    grade: r.level,
    onTimeOrders: r.onTimeOrders,
    dueDateOrders: r.dueDateOrders,
    orderedQty: r.orderedQty,
    receivedQty: r.receivedQty,
    receivedQtyQuality: r.receivedQtyQuality,
    rejectedQty: r.rejectedQty,
    returnedQty: r.returnedQty,
  };
}

export async function supplierRatingLevelOf(db: Db, workspaceId: string, companyId: string): Promise<'A' | 'B' | 'C' | 'D' | null> {
  const p = defaultPeriod();
  const r = await getSupplierRating(db, workspaceId, companyId, p.from, p.to);
  return r.level;
}
