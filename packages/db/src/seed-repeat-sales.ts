/* Демо повторных продаж и планирования продаж (задача 1133): срок повтора у двух услуг, дата следующего контакта у двух компаний,
   сценарии планирования («По менеджерам», «По категориям») и проведённый план продаж на текущий год по менеджерам.
   Даты — относительно сегодняшнего дня; план проводится настоящим сервисом. */
import { and, asc, eq, isNotNull } from 'drizzle-orm';
import { addDays } from '@gr8r/shared';
import type { Db } from './client';
import { postDocument, type DocCtx } from './documents';
import { createSalesPlan } from './sales-plan';
import { companies, members, products, salesPlanScenarios, workspaces } from './schema';

export async function seedRepeatSales(db: Db, ctx: DocCtx, companyIds: { first: string; second: string }): Promise<void> {
  const wsId = ctx.workspaceId;
  // услуги со сроком повтора: сборка мебели — раз в полгода, замер — через месяц
  await db.update(products).set({ repeatSaleDays: 180 }).where(and(eq(products.workspaceId, wsId), eq(products.sku, 'SV-ASM')));
  await db.update(products).set({ repeatSaleDays: 30 }).where(and(eq(products.workspaceId, wsId), eq(products.sku, 'SV-MSR')));
  // даты, поставленные продажами демо-документов, не нужны: напоминания начинаются с двух явных дат
  await db.update(companies).set({ nextContactDate: null }).where(and(eq(companies.workspaceId, wsId), isNotNull(companies.nextContactDate)));
  const today = new Date().toISOString().slice(0, 10);
  await db.update(companies).set({ nextContactDate: addDays(today, 3), nextContactNote: 'Предложить повторный замер и сборку' }).where(eq(companies.id, companyIds.first));
  await db.update(companies).set({ nextContactDate: addDays(today, 14), nextContactNote: 'Уточнить планы на следующий квартал' }).where(eq(companies.id, companyIds.second));

  // сценарии планирования
  const [byManager] = await db.insert(salesPlanScenarios).values({ workspaceId: wsId, name: 'По менеджерам, по месяцам', periodicity: 'month', dimension: 'manager' }).returning({ id: salesPlanScenarios.id });
  await db.insert(salesPlanScenarios).values({ workspaceId: wsId, name: 'По категориям, по кварталам', periodicity: 'quarter', dimension: 'category' });

  // план продаж на текущий год по менеджерам: первые три активных участника, сумма без НДС растёт к концу года
  const people = await db.select({ id: members.id }).from(members).where(and(eq(members.workspaceId, wsId), eq(members.status, 'active'))).orderBy(asc(members.createdAt), asc(members.id));
  // дата документа — после запрета редактирования демо-периода (его ставит сид документов)
  const [lock] = await db.select({ closedThrough: workspaces.closedThrough }).from(workspaces).where(eq(workspaces.id, wsId)).limit(1);
  const docDate = lock?.closedThrough && lock.closedThrough >= today ? addDays(lock.closedThrough, 1) : today;
  const year = today.slice(0, 4);
  const lines = people.slice(0, 3).flatMap((m, i) => Array.from({ length: 12 }, (_, k) => ({ periodStart: `${year}-${String(k + 1).padStart(2, '0')}-01`, memberId: m.id, amount: String(300_000 - i * 60_000 + k * 10_000) })));
  if (!lines.length) return;
  const id = await createSalesPlan(db, ctx, { scenarioId: byManager!.id, periodStart: `${year}-01-01`, date: docDate, comment: 'План продаж на год', lines });
  await postDocument(db, ctx, id);
}
