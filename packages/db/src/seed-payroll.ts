/* Демо-данные зарплаты (задача 1184, по-русски): кадровые данные, оклады, начисление за прошлый месяц, ведомости
   (расчёт из кассы, аванс через банк), черновик начисления за текущий месяц со сдельной.
   Вызывается из seedDocuments до закрытия месяца: после даты запрета проводить документы нельзя. */
import { and, asc, eq, isNull } from 'drizzle-orm';
import { periodEndOf, periodStartOf } from '@gr8r/shared';
import type { Db } from './client';
import { postDocument, type DocCtx } from './documents';
import {
  addEmployeeAccrual,
  createPayroll,
  createReflection,
  createStatement,
  ensurePayrollKinds,
  fillPayroll,
  fillStatement,
  payStatement,
  updateEmployeePayroll,
} from './payroll';
import { bankAccounts, cashRegisters, costItems, members, workCenters } from './schema';

const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 864e5).toISOString().slice(0, 10);

export async function seedPayroll(db: Db, ctx: DocCtx, refs: { organizationId: string }): Promise<void> {
  const ws = ctx.workspaceId;
  const kinds = await ensurePayrollKinds(db, ws);
  const [costItem] = await db.insert(costItems).values({ workspaceId: ws, name: 'Оплата труда', kind: 'expense', distributionMethod: 'work_hours' }).returning({ id: costItems.id });
  const [center] = await db.select({ id: workCenters.id }).from(workCenters).where(and(eq(workCenters.workspaceId, ws), isNull(workCenters.archivedAt))).orderBy(asc(workCenters.createdAt)).limit(1);
  const reflectionId = await createReflection(db, ctx, { name: 'Оплата труда цеха', costItemId: costItem!.id, workCenterId: center?.id ?? null });
  const officeReflectionId = await createReflection(db, ctx, { name: 'Оплата труда управления', costItemId: costItem!.id, workCenterId: null });

  const people = await db.select({ id: members.id, name: members.name }).from(members).where(and(eq(members.workspaceId, ws), eq(members.status, 'active'))).orderBy(asc(members.name)).limit(4);
  const salaries = ['52000', '45000', '40000', '38000'];
  for (const [i, p] of people.entries()) {
    await updateEmployeePayroll(db, ctx, p.id, {
      organizationId: refs.organizationId,
      workCenterId: i === 0 ? null : (center?.id ?? null),
      reflectionId: i === 0 ? officeReflectionId : reflectionId,
      ndflRate: '13',
      cardAccount: `4081781000000000${String(i + 1).padStart(4, '0')}`,
      advancePercent: '40',
    });
    await addEmployeeAccrual(db, ctx, { memberId: p.id, kindId: kinds.get('salary')!.id, validFrom: '2026-01-01', amount: salaries[i]!, percentBasis: 'revenue' });
    // менеджеру — процент от продаж, одному из цеха — ежемесячная премия
    if (i === 0) await addEmployeeAccrual(db, ctx, { memberId: p.id, kindId: kinds.get('sales_percent')!.id, validFrom: '2026-01-01', percent: '3', percentBasis: 'revenue' });
    if (i === 1) await addEmployeeAccrual(db, ctx, { memberId: p.id, kindId: kinds.get('bonus')!.id, validFrom: '2026-01-01', amount: '5000', percentBasis: 'revenue' });
  }

  // начисление за прошлый месяц: проведено, затем ведомость на расчёт и выплата из кассы
  const prev = new Date(`${periodStartOf(iso(0))}T00:00:00Z`);
  prev.setUTCMonth(prev.getUTCMonth() - 1);
  const prevPeriod = prev.toISOString().slice(0, 10);
  const accrual = await createPayroll(db, ctx, { organizationId: refs.organizationId, period: prevPeriod, comment: 'Зарплата за прошлый месяц' });
  await fillPayroll(db, ctx, accrual);
  await postDocument(db, ctx, accrual);

  const [register] = await db.select({ id: cashRegisters.id }).from(cashRegisters).where(eq(cashRegisters.workspaceId, ws)).orderBy(asc(cashRegisters.createdAt)).limit(1);
  const settlement = await createStatement(db, ctx, { organizationId: refs.organizationId, period: prevPeriod, kind: 'settlement', method: 'cash', date: periodEndOf(prevPeriod), comment: 'Расчёт за прошлый месяц' });
  await fillStatement(db, ctx, settlement);
  await postDocument(db, ctx, settlement);
  const payment = await payStatement(db, ctx, settlement, { cashRegisterId: register?.id ?? null });
  await postDocument(db, ctx, payment);

  // аванс за текущий месяц — через банк
  const [bank] = await db.select({ id: bankAccounts.id }).from(bankAccounts).where(eq(bankAccounts.organizationId, refs.organizationId)).orderBy(asc(bankAccounts.createdAt)).limit(1);
  const currentPeriod = periodStartOf(iso(0));
  const advance = await createStatement(db, ctx, { organizationId: refs.organizationId, period: currentPeriod, kind: 'advance', method: 'bank', date: iso(0), comment: 'Аванс за текущий месяц' });
  await fillStatement(db, ctx, advance);
  await postDocument(db, ctx, advance);
  if (bank) {
    const pay = await payStatement(db, ctx, advance, { bankAccountId: bank.id });
    await postDocument(db, ctx, pay);
  }

  // черновик начисления за текущий месяц: оклад по графику, сдельная по нарядам, процент от продаж
  const current = await createPayroll(db, ctx, { organizationId: refs.organizationId, period: currentPeriod, comment: 'Зарплата за текущий месяц (черновик)' });
  await fillPayroll(db, ctx, current);
}
