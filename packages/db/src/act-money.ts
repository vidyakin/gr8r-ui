/* Деньги актов объекта (задача 1273, docs/architecture/construction.md): «выставлено» — суммы документов,
   созданных из акта (счёт и «Акт оказания услуг»), «оплачено» — оплаты по этим документам из взаиморасчётов.
   Отдельный модуль, чтобы им пользовались и акты, и вехи (object-progress.ts) без кругового импорта. */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { dec, fmt, type Dec } from '@gr8r/shared';
import type { Db } from './client';
import { companyMode, paymentStatuses } from './settlements';
import { documents, settlementMoves } from './schema';

/** Документы одного акта: счёт и «Акт оказания услуг» (оба необязательны, пока акт не выставлен) */
export interface ActDocuments {
  invoiceDocumentId: string | null;
  actDocumentId: string | null;
}

export interface ActMoney {
  /** Выставлено: сумма без НДС документа акта (нет документов — 0) */
  invoiced: Dec;
  /** Оплачено: оплаты по счёту и документу акта */
  paid: Dec;
}

const ZERO: ActMoney = { invoiced: 0n, paid: 0n };

/** Итоги по документам актов: суммы без НДС и оплаты. Один запрос на пачку актов, не по запросу на акт. */
export async function actMoneyByAct(db: Db, acts: (ActDocuments & { id: string })[], customerId: string | null): Promise<Map<string, ActMoney>> {
  const out = new Map<string, ActMoney>();
  if (!acts.length) return out;
  const docIds = [...new Set(acts.flatMap(a => [a.invoiceDocumentId, a.actDocumentId].filter((x): x is string => !!x)))];
  if (!docIds.length) return out;
  const docs = await db.select({ id: documents.id, amountNet: documents.amountNet }).from(documents).where(inArray(documents.id, docIds));
  const net = new Map(docs.map(d => [d.id, dec(d.amountNet)]));
  // режим «по контрагенту»: оплаты лежат в общем пуле, распределение по документам — FIFO (paymentStatuses)
  const mode = customerId ? await companyMode(db, customerId) : 'by_documents';
  const paid = new Map<string, Dec>();
  if (mode === 'by_documents') {
    // только строки оплат, без зачётов: зачёт аванса счёта в акт — пара строк на два документа, сумма дала бы двойной счёт
    const rows = await db
      .select({ docId: settlementMoves.settlementDocumentId, s: sql<string>`coalesce(sum(${settlementMoves.amount}), 0)::text` })
      .from(settlementMoves)
      .where(and(inArray(settlementMoves.settlementDocumentId, docIds), eq(settlementMoves.kind, 'payment')))
      .groupBy(settlementMoves.settlementDocumentId);
    for (const r of rows) if (r.docId) paid.set(r.docId, -dec(r.s));
  } else {
    const statuses = await paymentStatuses(db, docIds);
    for (const [id, st] of Object.entries(statuses)) paid.set(id, dec(st.paid));
  }
  for (const a of acts) {
    const own = [a.invoiceDocumentId, a.actDocumentId].filter((x): x is string => !!x);
    if (!own.length) {
      out.set(a.id, ZERO);
      continue;
    }
    // счёт и акт — одна и та же продажа: «выставлено» берём из документа акта, счёт — только если акта ещё нет
    const amount = (a.actDocumentId ? net.get(a.actDocumentId) : null) ?? (a.invoiceDocumentId ? net.get(a.invoiceDocumentId) : null) ?? 0n;
    let sum = 0n;
    for (const id of own) sum += paid.get(id) ?? 0n;
    out.set(a.id, { invoiced: amount, paid: sum });
  }
  return out;
}

/** Сумма оплат пачки актов как строка с копейками */
export const moneyText = (v: Dec): string => fmt(v, 2);
