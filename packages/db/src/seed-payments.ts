/* Демо-данные денег (задача 1174б, по-русски): касса «Основная касса», статьи ДДС, оплаты части документов полностью и частично,
   аванс, выдача подотчётному и авансовый отчёт, перемещение денег (инкассация) и физлицо с расчётами «по контрагенту».
   Вызывается из seedDocuments до закрытия месяца: после даты запрета проводить документы уже нельзя. */
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Db } from './client';
import { changeDocumentState, createDocument, postDocument, type DocCtx } from './documents';
import { createPaymentFromRequest, createRequest } from './payment-requests';
import { createPayment, createPaymentFromDocument, ensureCashFlowItems, updatePayment } from './payments';
import { bankAccounts, cashFlowItems, cashRegisters, companies, costItems, documents } from './schema';

const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 864e5).toISOString().slice(0, 10);

export async function seedPayments(db: Db, ctx: DocCtx, refs: { organizationId: string; customerId: string; serviceId: string }) {
  const ws = ctx.workspaceId;
  await ensureCashFlowItems(db, ws);
  const [register] = await db.insert(cashRegisters).values({ workspaceId: ws, name: 'Основная касса', organizationId: refs.organizationId, responsibleId: ctx.memberId }).returning({ id: cashRegisters.id });
  const [bank] = await db.select({ id: bankAccounts.id }).from(bankAccounts).where(eq(bankAccounts.organizationId, refs.organizationId)).orderBy(desc(bankAccounts.isDefault), asc(bankAccounts.createdAt)).limit(1);
  const item = async (name: string, kind: 'income' | 'expense') => (await db.insert(cashFlowItems).values({ workspaceId: ws, name, kind, flowGroup: 'operating' }).returning({ id: cashFlowItems.id }))[0]!.id;
  const rent = await item('Аренда помещения', 'expense');
  const household = await item('Хозяйственные расходы', 'expense');
  const interest = await item('Проценты по остатку на счёте', 'income');
  const [costHousehold] = await db.insert(costItems).values({ workspaceId: ws, name: 'Хозяйственные нужды офиса', kind: 'expense' }).returning({ id: costItems.id });

  const post = async (id: string, daysAgo: number) => {
    await updatePayment(db, ctx, id, { date: iso(daysAgo) });
    await postDocument(db, ctx, id);
  };

  // оплаты проведённых документов: первая реализация/акт покупателя — полностью на счёт, вторая — частично наличными
  const sales = await db
    .select({ id: documents.id, total: documents.total })
    .from(documents)
    .where(and(eq(documents.workspaceId, ws), inArray(documents.type, ['realization', 'act']), eq(documents.status, 'posted')))
    .orderBy(asc(documents.date), asc(documents.createdAt));
  const withCp = sales.filter(s => Number(s.total) > 0);
  if (withCp[0]) {
    const p = await createPaymentFromDocument(db, ctx, withCp[0].id, 'bank');
    await post(p, 6);
  }
  if (withCp[1]) {
    const p = await createPaymentFromDocument(db, ctx, withCp[1].id, 'cash');
    const half = (Number(withCp[1].total) / 2).toFixed(2);
    await updatePayment(db, ctx, p, { lines: [{ settlementDocumentId: withCp[1].id, amount: half, comment: 'Предоплата 50%' } as never] });
    await post(p, 5);
  }
  // оплата поставщику: первое поступление
  const [receipt] = await db
    .select({ id: documents.id, total: documents.total })
    .from(documents)
    .where(and(eq(documents.workspaceId, ws), eq(documents.type, 'receipt'), eq(documents.status, 'posted')))
    .orderBy(asc(documents.date))
    .limit(1);
  if (receipt && Number(receipt.total) > 0) {
    const p = await createPaymentFromDocument(db, ctx, receipt.id, 'bank');
    await post(p, 4);
  }

  // аванс покупателя без документа: зачтётся при следующей отгрузке
  const advance = await createPayment(db, ctx, { type: 'bank_receipt', operation: 'from_customer', counterpartyId: refs.customerId, bankAccountId: bank?.id ?? null, comment: 'Аванс по договору', lines: [{ amount: '100000', comment: 'Аванс' } as never] });
  await post(advance, 5);

  // касса: поступление наличными, аренда, инкассация, проценты банка
  const cashIn = await createPayment(db, ctx, { type: 'cash_receipt', operation: 'other_income', cashRegisterId: register!.id, comment: 'Выручка розницы', lines: [{ amount: '80000', cashFlowItemId: interest, comment: 'Розничные продажи' } as never] });
  await post(cashIn, 8);
  const rentPay = await createPayment(db, ctx, { type: 'bank_payment', operation: 'other_expense', bankAccountId: bank?.id ?? null, comment: 'Аренда за месяц', lines: [{ amount: '65000', cashFlowItemId: rent, comment: 'Аренда помещения' } as never] });
  await post(rentPay, 3);
  const incassation = await createPayment(db, ctx, { type: 'cash_payment', operation: 'money_transfer', cashRegisterId: register!.id, targetBankAccountId: bank?.id ?? null, comment: 'Инкассация', lines: [{ amount: '50000' } as never] });
  await post(incassation, 2);

  // подотчёт: выдача, авансовый отчёт на часть суммы (остаток — долг сотрудника)
  if (ctx.memberId) {
    const issue = await createPayment(db, ctx, { type: 'cash_payment', operation: 'to_accountable', cashRegisterId: register!.id, accountableMemberId: ctx.memberId, comment: 'На хозяйственные расходы', lines: [{ amount: '15000' } as never] });
    await post(issue, 4);
    const report = await createPayment(db, ctx, { type: 'advance_report', accountableMemberId: ctx.memberId, comment: 'Канцелярия и вода для офиса', lines: [{ amount: '9800', costItemId: costHousehold!.id, cashFlowItemId: household, comment: 'Канцтовары, вода' } as never] });
    await post(report, 2);
  }

  // физлицо: расчёты «по контрагенту» — одно сальдо, оплата закрывает акты по порядку
  const [person] = await db
    .insert(companies)
    .values({ workspaceId: ws, name: 'Петров Сергей Иванович (физлицо)', kind: 'individual', settlementMode: 'by_counterparty', ownerId: ctx.memberId })
    .returning({ id: companies.id });
  for (const [days, price] of [
    [40, '12000'],
    [20, '8000'],
  ] as const) {
    const act = await createDocument(db, ctx, { type: 'act', counterpartyId: person!.id, date: iso(days), lines: [{ productId: refs.serviceId, qty: '1', price, discountPct: '0', vatRate: 'none' }] });
    await postDocument(db, ctx, act);
  }
  const cashPay = await createPayment(db, ctx, { type: 'cash_receipt', operation: 'from_customer', cashRegisterId: register!.id, counterpartyId: person!.id, comment: 'Оплата наличными', lines: [{ amount: '15000' } as never] });
  await post(cashPay, 10);

  // платёжный календарь (1174г): сроки неоплаченных документов и заявки на расход в разных состояниях
  await db
    .update(documents)
    .set({ dueDate: sql`${documents.date} + 14` })
    .where(and(eq(documents.workspaceId, ws), isNull(documents.dueDate), eq(documents.status, 'posted'), inArray(documents.type, ['realization', 'act', 'receipt', 'work_order'])));
  const [supplierDoc] = await db
    .select({ cp: documents.counterpartyId })
    .from(documents)
    .where(and(eq(documents.workspaceId, ws), eq(documents.type, 'receipt'), eq(documents.status, 'posted')))
    .limit(1);
  const payee = supplierDoc?.cp ?? refs.customerId;
  const admin = { ...ctx, role: 'owner' as const };
  const future = (days: number) => iso(-days);
  const rentNext = await createRequest(db, ctx, { counterpartyId: payee, dueDate: future(5), comment: 'Аренда офиса на следующий месяц', lines: [{ amount: '65000', cashFlowItemId: rent, comment: 'Аренда' } as never] });
  await postDocument(db, ctx, rentNext);
  await changeDocumentState(db, admin, rentNext, 'approved');
  const repair = await createRequest(db, ctx, { counterpartyId: payee, dueDate: future(12), operation: 'other_expense', comment: 'Ремонт кондиционера', lines: [{ amount: '28000', cashFlowItemId: household, comment: 'Ремонт' } as never] });
  await postDocument(db, ctx, repair);
  const furniture = await createRequest(db, ctx, { counterpartyId: payee, dueDate: future(3), operation: 'other_expense', comment: 'Мебель для переговорной', lines: [{ amount: '54000', cashFlowItemId: household, comment: 'Столы и стулья' } as never] });
  await postDocument(db, ctx, furniture);
  await changeDocumentState(db, admin, furniture, 'rejected');
  const water = await createRequest(db, ctx, { counterpartyId: payee, dueDate: iso(1), operation: 'other_expense', comment: 'Питьевая вода на квартал', lines: [{ amount: '6400', cashFlowItemId: household, comment: 'Вода' } as never] });
  await postDocument(db, ctx, water);
  await changeDocumentState(db, admin, water, 'approved');
  const waterPay = await createPaymentFromRequest(db, ctx, water, 'bank');
  await post(waterPay, 1);
}
