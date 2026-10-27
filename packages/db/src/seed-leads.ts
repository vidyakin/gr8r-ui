/* Демо лидов (задача 1175): русские статусы, форма сайта, лиды по всем статусам с касаниями; один лид повторяет телефон
   существующего контакта (демо поиска дублей), один сконвертирован настоящим сервисом. */
import { and, asc, eq, ne } from 'drizzle-orm';
import type { Db } from './client';
import { convertLead, ensureLeadStatuses, insertLead, newFormSecret } from './leads';
import { contacts, crmActivities, leadForms, leadStatuses, leads, members } from './schema';

export async function seedLeads(db: Db, workspaceId: string, authorId: string): Promise<void> {
  await ensureLeadStatuses(db, workspaceId, [
    { name: 'Новый', category: 'new', color: 'blue' },
    { name: 'Связались', category: 'in_progress', color: 'amber' },
    { name: 'Квалифицирован', category: 'in_progress', color: 'violet' },
    { name: 'Сконвертирован', category: 'converted', color: 'green' },
    { name: 'Отказ', category: 'rejected', color: 'red' },
  ]);
  // миграция уже могла завести английские статусы — в демо они заменены русскими
  await db.delete(leadStatuses).where(and(eq(leadStatuses.workspaceId, workspaceId), ne(leadStatuses.name, 'Новый'), ne(leadStatuses.name, 'Связались'), ne(leadStatuses.name, 'Квалифицирован'), ne(leadStatuses.name, 'Сконвертирован'), ne(leadStatuses.name, 'Отказ')));
  const st = Object.fromEntries((await db.select().from(leadStatuses).where(eq(leadStatuses.workspaceId, workspaceId))).map(s => [s.name, s.id])) as Record<string, string>;

  const people = await db.select({ id: members.id }).from(members).where(and(eq(members.workspaceId, workspaceId), eq(members.status, 'active'))).orderBy(asc(members.createdAt), asc(members.id));
  const owner = (i: number) => people[i % Math.max(people.length, 1)]?.id ?? authorId;

  const secret = newFormSecret();
  const [form] = await db.insert(leadForms).values({ workspaceId, name: 'Форма на сайте', token: secret, source: 'Сайт', defaultOwnerId: authorId }).returning();

  const [dupContact] = await db.select({ phone: contacts.phone, name: contacts.name }).from(contacts).where(and(eq(contacts.workspaceId, workspaceId), ne(contacts.phone, ''))).limit(1);
  const ctx = { workspaceId, memberId: authorId };
  const mk = (i: number, l: Parameters<typeof insertLead>[2]) => insertLead(db, ctx, { ownerId: owner(i), ...l });

  const l1 = await mk(0, { name: 'Ирина Волкова', companyName: 'Кофейня «Зерно»', phone: '+7 (916) 111-22-33', email: 'volkova@zerno.example', source: 'Сайт', formId: form!.id, comment: 'Нужна мебель для зала на 30 мест', custom: { utm_source: 'yandex', utm_medium: 'cpc' } });
  const l2 = await mk(1, { name: 'Пётр Сидоров', phone: '8 925 444-55-66', source: 'Звонок', statusId: st['Связались']!, comment: 'Звонил по поводу замера' });
  const l3 = await mk(2, { name: 'Анна Белова', companyName: 'ООО «Лофт-студия»', email: 'belova@loft.example', phone: '+79031230099', source: 'Рекомендация', statusId: st['Квалифицирован']! });
  await mk(0, { name: dupContact ? `${dupContact.name} (повторное обращение)` : 'Олег Миронов', phone: dupContact?.phone ?? '+7 495 000-11-22', source: 'Сайт', formId: form!.id, comment: 'Телефон совпадает с контактом в базе — проверить дубль' });
  const l5 = await mk(1, { name: 'Мария Орлова', email: 'orlova@example.com', source: 'Сайт', statusId: st['Отказ']!, comment: 'Не подошла цена' });
  await db.update(leads).set({ rejectReason: 'Дорого' }).where(eq(leads.id, l5.id));
  const l6 = await mk(2, { name: 'Сергей Громов', companyName: 'ИП Громов', phone: '+7 910 777-88-99', source: 'Выставка', statusId: st['Связались']! });

  const touch = (leadId: string, type: 'call' | 'email' | 'meeting' | 'note', subject: string, body?: string) =>
    db.insert(crmActivities).values({ workspaceId, type, subject, body: body ?? null, leadId, authorId });
  await touch(l1.id, 'note', 'Заявка с сайта', 'Форма «Заказать звонок»');
  await touch(l2.id, 'call', 'Первый звонок', 'Договорились о замере на следующей неделе');
  await touch(l3.id, 'email', 'Отправили коммерческое предложение');
  await touch(l3.id, 'meeting', 'Встреча в студии');
  await touch(l6.id, 'call', 'Перезвонить после выставки');

  // сконвертированный лид: контрагент, контакт и сделка создаются настоящим сервисом, касания переезжают
  const done = await insertLead(db, ctx, { name: 'Дмитрий Козлов', companyName: 'ООО «Вектор»', phone: '+7 999 321-00-11', email: 'kozlov@vektor.example', source: 'Сайт', ownerId: authorId });
  await touch(done.id, 'call', 'Уточнили потребности');
  await convertLead(db, ctx, done.id, { company: { mode: 'new', name: 'ООО «Вектор»' }, contact: { mode: 'new', name: 'Дмитрий Козлов' }, deal: { name: 'Поставка мебели для «Вектор»', amount: '250000' } });
}
