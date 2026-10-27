/* Платёжный календарь (задача 1174г): плановые поступления и платежи по неоплаченным документам, заявки на расход и прогноз
   остатка денег по дням. Ничего не хранит — собирается из долгов (взаиморасчёты) и заявок. Правила — docs/architecture/payments.md. */
import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm';
import { addIsoDays, allocateRequest, buildForecast, dec, fmt, type PlanItem } from '@gr8r/shared';
import type { Db } from './client';
import { cashBalances } from './payments';
import { requestPaidAmounts } from './request-paid';
import { debtReport } from './settlements';
import { companies, contracts, documents, paymentLines } from './schema';

export interface CalendarParams {
  days: number;
  organizationId?: string;
  includePending: boolean;
}

/** Срок оплаты: срок документа, иначе дата + отсрочка по договору, иначе дата документа */
const dueOf = (d: { dueDate: string | null; date: string; contractId: string | null }, days: Map<string, number>) => d.dueDate ?? addIsoDays(d.date, d.contractId ? (days.get(d.contractId) ?? 0) : 0);

export async function paymentCalendar(db: Db, workspaceId: string, p: CalendarParams, now: string = new Date().toISOString().slice(0, 10)) {
  const to = addIsoDays(now, p.days - 1);
  const balances = await cashBalances(db, workspaceId, now);
  const cash = balances.cash.filter(a => !p.organizationId || a.organizationId === p.organizationId).reduce((s, a) => s + dec(a.balance), 0n);
  const bank = balances.bank.filter(a => !p.organizationId || a.organizationId === p.organizationId).reduce((s, a) => s + dec(a.balance), 0n);
  const opening = cash + bank;

  const items: PlanItem[] = [];
  // coverage: сколько по неоплаченному документу уже покрыто заявками (чтобы не считать платёж дважды)
  const covered = new Map<string, bigint>();

  // заявки на расход: согласованные и (по желанию) на согласовании — остаток к оплате
  const reqRows = await db
    .select()
    .from(documents)
    .where(and(eq(documents.workspaceId, workspaceId), eq(documents.type, 'payment_request'), eq(documents.status, 'posted'), inArray(documents.state, p.includePending ? ['approved', 'pending'] : ['approved']), p.organizationId ? eq(documents.organizationId, p.organizationId) : undefined))
    .orderBy(asc(documents.date));
  const reqLines = reqRows.length ? await db.select().from(paymentLines).where(inArray(paymentLines.documentId, reqRows.map(r => r.id))).orderBy(asc(paymentLines.sortOrder), asc(paymentLines.createdAt)) : [];
  const names = new Map<string, string>();
  const cpIds = [...new Set(reqRows.map(r => r.counterpartyId).filter((x): x is string => !!x))];
  if (cpIds.length) for (const c of await db.select({ id: companies.id, name: companies.name }).from(companies).where(inArray(companies.id, cpIds))) names.set(c.id, c.name);
  for (const r of reqRows) {
    const { posted } = await requestPaidAmounts(db, r.id);
    const remaining = dec(r.total) - posted;
    if (remaining <= 0n) continue;
    const lines = reqLines.filter(l => l.documentId === r.id);
    for (const a of allocateRequest(lines.map(l => ({ id: l.id, amount: l.amount })), fmt(remaining, 2))) {
      const sd = lines.find(l => l.id === a.id)?.settlementDocumentId;
      if (sd) covered.set(sd, (covered.get(sd) ?? 0n) + dec(a.amount));
    }
    const due = r.dueDate ?? r.date;
    items.push({ direction: 'out', source: 'request', date: due < now ? now : due, dueDate: due, overdue: due < now, amount: fmt(remaining, 2), documentId: r.id, documentType: r.type, number: r.number, counterpartyId: r.counterpartyId, counterpartyName: r.counterpartyId ? (names.get(r.counterpartyId) ?? '') : '', state: r.state ?? undefined });
  }

  // неоплаченные документы: долги покупателей и поставщиков
  for (const side of ['customer', 'supplier'] as const) {
    const report = await debtReport(db, workspaceId, side, to);
    const docIds = report.rows.flatMap(r => r.docs.map(d => d.documentId));
    if (!docIds.length) continue;
    const meta = new Map((await db.select({ id: documents.id, contractId: documents.contractId, organizationId: documents.organizationId }).from(documents).where(inArray(documents.id, docIds))).map(d => [d.id, d]));
    const conIds = [...new Set([...meta.values()].map(m => m.contractId).filter((x): x is string => !!x))];
    const terms = new Map((conIds.length ? await db.select({ id: contracts.id, days: contracts.paymentDays }).from(contracts).where(and(inArray(contracts.id, conIds), isNotNull(contracts.paymentDays))) : []).map(c => [c.id, c.days]));
    for (const row of report.rows) {
      for (const d of row.docs) {
        const m = meta.get(d.documentId);
        if (p.organizationId && m?.organizationId !== p.organizationId) continue;
        let amount = dec(d.amount);
        if (side === 'supplier') {
          const cv = covered.get(d.documentId) ?? 0n;
          amount -= cv < amount ? cv : amount;
        }
        if (amount <= 0n) continue;
        const due = dueOf({ dueDate: d.dueDate, date: d.date, contractId: m?.contractId ?? null }, terms);
        items.push({ direction: side === 'customer' ? 'in' : 'out', source: 'document', date: due < now ? now : due, dueDate: due, overdue: due < now, amount: fmt(amount, 2), documentId: d.documentId, documentType: d.type, number: d.number, counterpartyId: row.companyId, counterpartyName: row.companyName });
      }
    }
  }

  const inWindow = items.filter(i => i.date <= to).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.direction === b.direction ? 0 : a.direction === 'in' ? -1 : 1));
  const forecast = buildForecast({ from: now, days: p.days, opening: fmt(opening, 2), items: inWindow });
  return { from: now, to, opening: { total: fmt(opening, 2), cash: fmt(cash, 2), bank: fmt(bank, 2) }, ...forecast, items: inWindow, beyond: items.length - inWindow.length };
}
