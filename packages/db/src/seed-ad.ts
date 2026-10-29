/* Демо источников и рекламных кампаний (задача 1177): справочник каналов, две кампании с расходами за два месяца,
   лиды кампаний, источники у части контрагентов и сделок — чтобы отчёт по каналам не был пустым. Запускается после seedLeads. */
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { Db } from './client';
import { findOrCreateSource } from './ad';
import { insertLead } from './leads';
import { adCampaignExpenses, adCampaigns, companies, deals, leadSources } from './schema';

const iso = (d: Date) => d.toISOString().slice(0, 10);

export async function seedAdCampaigns(db: Db, workspaceId: string, authorId: string): Promise<void> {
  const colors: Record<string, string> = { Сайт: 'blue', 'Яндекс.Директ': 'amber', 'VK Реклама': 'violet', Звонок: 'teal', Рекомендация: 'green', Выставка: 'rose' };
  const src: Record<string, string> = {};
  for (const name of Object.keys(colors)) src[name] = (await findOrCreateSource(db, workspaceId, name)).id;
  for (const [name, color] of Object.entries(colors)) await db.update(leadSources).set({ color }).where(eq(leadSources.id, src[name]!));

  const today = new Date();
  const monthAgo = new Date(today.getTime() - 60 * 86_400_000);
  const [direct, vk] = await db
    .insert(adCampaigns)
    .values([
      { workspaceId, name: 'Директ — кухни, осень', sourceId: src['Яндекс.Директ']!, utmCampaign: 'kitchens-autumn', startDate: iso(monthAgo), budget: '120000', ownerId: authorId, comment: 'Поиск + РСЯ по Москве' },
      { workspaceId, name: 'VK — офисная мебель', sourceId: src['VK Реклама']!, utmCampaign: 'vk-office', startDate: iso(monthAgo), budget: '60000', ownerId: authorId },
    ])
    .returning();

  // расходы раз в неделю за два месяца
  const exp: (typeof adCampaignExpenses.$inferInsert)[] = [];
  for (let w = 0; w < 9; w++) {
    const d = iso(new Date(monthAgo.getTime() + w * 7 * 86_400_000));
    if (d > iso(today)) break;
    exp.push({ workspaceId, campaignId: direct!.id, date: d, amount: String(11_000 + (w % 3) * 1_500), comment: 'Списание Директа за неделю' });
    exp.push({ workspaceId, campaignId: vk!.id, date: d, amount: String(5_500 + (w % 2) * 1_000), comment: 'Пополнение кабинета VK' });
  }
  await db.insert(adCampaignExpenses).values(exp);

  const ctx = { workspaceId, memberId: authorId };
  const names = ['Елена Котова', 'Игорь Лебедев', 'Ольга Смирнова', 'Артём Зуев', 'Наталья Фомина'];
  for (const [i, name] of names.entries()) {
    await insertLead(db, ctx, { name, phone: `+7 916 200-1${i}-0${i}`, campaignId: i < 3 ? direct!.id : vk!.id, ownerId: authorId, comment: 'Заявка с рекламы', custom: { utm_source: i < 3 ? 'yandex' : 'vk', utm_campaign: i < 3 ? 'kitchens-autumn' : 'vk-office' } });
  }

  // источники у части контрагентов и сделок демо: первое касание, выигранные сделки получают источник клиента
  const cs = await db.select({ id: companies.id }).from(companies).where(and(eq(companies.workspaceId, workspaceId), isNull(companies.sourceId))).orderBy(asc(companies.createdAt), asc(companies.id));
  const plan: [string, string | null][] = [
    [src['Яндекс.Директ']!, direct!.id],
    [src['Рекомендация']!, null],
    [src['VK Реклама']!, vk!.id],
    [src['Выставка']!, null],
    [src['Сайт']!, null],
    [src['Звонок']!, null],
  ];
  for (const [i, c] of cs.entries()) {
    const [sourceId, campaignId] = plan[i % plan.length]!;
    await db.update(companies).set({ sourceId, campaignId }).where(eq(companies.id, c.id));
    await db.update(deals).set({ sourceId, campaignId }).where(and(eq(deals.companyId, c.id), isNull(deals.sourceId)));
  }
}
