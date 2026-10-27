/* Повторные продажи и план продаж (задача 1133), раздел docs/architecture/repeat-sales.md.
   Дата следующего контакта ставится при проведении реализации, акта и выполнении заказ-наряда; напоминание создаёт воркер
   (apps/worker/src/next-contacts.ts) через runNextContacts; план продаж — packages/db/src/sales-plan.ts. */
import { and, asc, eq, inArray, isNull, lte, ne } from 'drizzle-orm';
import { nextContactAfterSale } from '@gr8r/shared';
import type { Db } from './client';
import type { DocCtx, DocumentLineRow, DocumentRow } from './documents';
import { recordEvent } from './events';
import { crmActivities, crmNextContactRuns, companies, members, notifications, products } from './schema';

/** Типы документов, после которых ставится дата следующего контакта */
const SALE_TYPES = ['realization', 'act', 'work_order'];

/** Вызывается после проведения документа: у компании-покупателя ставится дата следующего контакта */
export async function applySaleNextContact(db: Db, ctx: DocCtx, doc: DocumentRow, lines: DocumentLineRow[]): Promise<void> {
  if (!SALE_TYPES.includes(doc.type) || !doc.counterpartyId || !lines.length) return;
  const prods = await db.select({ days: products.repeatSaleDays }).from(products).where(inArray(products.id, [...new Set(lines.map(l => l.productId))]));
  const [company] = await db.select({ id: companies.id, next: companies.nextContactDate }).from(companies).where(and(eq(companies.workspaceId, ctx.workspaceId), eq(companies.id, doc.counterpartyId))).limit(1);
  if (!company) return;
  const date = nextContactAfterSale(doc.date, prods.map(p => p.days), company.next);
  if (!date) return;
  await db.update(companies).set({ nextContactDate: date, updatedAt: new Date() }).where(eq(companies.id, company.id));
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'company.updated', entity: 'company', recordId: company.id, actorId: ctx.memberId, payload: { changes: { nextContactDate: { from: company.next, to: date } }, via: 'repeat_sale' } });
}

/* ---------------- напоминание о контакте (воркер) ---------------- */

/** Дела на сегодня: компаниям с датой следующего контакта не позже today создаётся дело «Позвонить клиенту» ровно один раз,
    уведомление ответственному, затем дата очищается. Без ответственного — владелец воркспейса. Возвращает число созданных дел */
export async function runNextContacts(db: Db, workspaceId: string, today: string): Promise<number> {
  const due = await db
    .select({ id: companies.id, name: companies.name, ownerId: companies.ownerId, date: companies.nextContactDate, note: companies.nextContactNote })
    .from(companies)
    .where(and(eq(companies.workspaceId, workspaceId), isNull(companies.archivedAt), lte(companies.nextContactDate, today)));
  if (!due.length) return 0;
  const [wsOwner] = await db.select({ id: members.id }).from(members).where(and(eq(members.workspaceId, workspaceId), eq(members.role, 'owner'), ne(members.status, 'deactivated'))).orderBy(asc(members.createdAt)).limit(1);
  let created = 0;
  for (const c of due) {
    const date = c.date!;
    // журнал защищает от дубля при повторе задачи и двух воркерах: вставка выигрывает один раз
    const [run] = await db.insert(crmNextContactRuns).values({ workspaceId, companyId: c.id, contactDate: date }).onConflictDoNothing().returning({ companyId: crmNextContactRuns.companyId });
    if (run) {
      const responsible = c.ownerId ?? wsOwner?.id ?? null;
      const subject = `Позвонить клиенту: ${c.name}`;
      const [act] = await db
        .insert(crmActivities)
        .values({ workspaceId, type: 'task', subject, companyId: c.id, authorId: responsible, dueDate: today, done: false, body: c.note || null })
        .returning({ id: crmActivities.id });
      await db.update(crmNextContactRuns).set({ activityId: act!.id }).where(and(eq(crmNextContactRuns.companyId, c.id), eq(crmNextContactRuns.contactDate, date)));
      await recordEvent(db, { workspaceId, type: 'crm_activity.created', entity: 'crm_activity', recordId: act!.id, actorId: null, payload: { record: { id: act!.id, type: 'task', subject, companyId: c.id }, via: 'repeat_sale' } });
      if (responsible) {
        const [n] = await db.insert(notifications).values({ workspaceId, recipientId: responsible, type: 'update', actorId: null, text: subject, snippet: c.note }).returning({ id: notifications.id });
        await recordEvent(db, { workspaceId, type: 'notification.created', entity: 'notification', recordId: n!.id, actorId: null, payload: { recipientId: responsible, via: 'repeat_sale' } });
      }
      created++;
    }
    // дата очищается в любом случае: дело уже есть (в том числе созданное прошлым проходом)
    await db.update(companies).set({ nextContactDate: null, nextContactNote: '', updatedAt: new Date() }).where(and(eq(companies.id, c.id), eq(companies.nextContactDate, date)));
    await recordEvent(db, { workspaceId, type: 'company.updated', entity: 'company', recordId: c.id, actorId: null, payload: { changes: { nextContactDate: { from: date, to: null } }, via: 'repeat_sale' } });
  }
  return created;
}
