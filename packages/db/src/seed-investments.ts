/* Демо-данные инвестпроектов: утверждённый проект «Новый участок окраски» (квартал, 12 периодов, 14% годовых) с фактом
   обоими путями — поступление оборудования и акт с полем «Инвестпроект», прочие затраты по статье проекта — и черновик.
   Вызывается из seedDocuments до закрытия месяца: после даты запрета проводить документы уже нельзя. */
import { and, eq } from 'drizzle-orm';
import { periodStart } from '@gr8r/shared';
import type { Db } from './client';
import { createDocument, postDocument, type DocCtx } from './documents';
import { createInvestment, setInvestmentStatus } from './investments';
import { createOtherCosts } from './other-costs';
import { costItems, projects } from './schema';

const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 864e5).toISOString().slice(0, 10);

export async function seedInvestments(db: Db, ctx: DocCtx, refs: { organizationId: string; supplierId: string; customerId: string; serviceId: string }) {
  const item = async (name: string, kind: 'expense' | 'income') => (await db.insert(costItems).values({ workspaceId: ctx.workspaceId, name, kind }).returning({ id: costItems.id }))[0]!.id;
  const equipment = await item('Оборудование участка окраски', 'expense');
  const mounting = await item('Монтаж и пусконаладка', 'expense');
  const upkeep = await item('Обслуживание участка окраски', 'expense');
  const revenue = await item('Выручка участка окраски', 'income');
  const [project] = await db.select({ id: projects.id }).from(projects).where(and(eq(projects.workspaceId, ctx.workspaceId), eq(projects.module, 'general'))).limit(1);

  // старт — квартал около 200 дней назад: первые периоды уже прошли и имеют факт
  const startDate = periodStart(iso(200), 'quarter');
  const paint = await createInvestment(db, ctx, {
    name: 'Новый участок окраски',
    periodKind: 'quarter',
    startDate,
    periods: 12,
    discountRate: '14',
    projectId: project?.id ?? null,
    organizationId: refs.organizationId,
    responsibleId: ctx.memberId,
    comment: 'Окрасочная камера и сушка: окраска своих изделий и услуги окраски для заказчиков',
    costItemIds: [mounting],
    lines: [
      { periodIndex: 0, costItemId: equipment, amount: '2350000', comment: 'Окрасочная камера с сушкой' },
      { periodIndex: 0, costItemId: mounting, amount: '350000', comment: 'Монтаж и вентиляция' },
      { periodIndex: 1, costItemId: mounting, amount: '150000', comment: 'Пусконаладка и обучение' },
      { periodIndex: 1, costItemId: revenue, amount: '300000', comment: 'Первые заказы' },
      ...Array.from({ length: 10 }, (_, k) => [
        { periodIndex: k + 2, costItemId: revenue, amount: '650000', comment: '' },
        { periodIndex: k + 2, costItemId: upkeep, amount: '60000', comment: '' },
      ]).flat(),
    ],
  });
  await setInvestmentStatus(db, ctx, paint, 'approve');

  // факт по полю документа: поступление оборудования (без НДС 2 350 000) и акты услуг окраски
  const rc = await createDocument(db, ctx, {
    type: 'receipt',
    counterpartyId: refs.supplierId,
    date: iso(190),
    investmentProjectId: paint,
    comment: 'Окрасочная камера с сушкой',
    lines: [{ productId: refs.serviceId, name: 'Окрасочная камера с сушкой, поставка', qty: '1', price: '2820000', discountPct: '0', vatRate: '20', costItemId: equipment }],
  });
  await postDocument(db, ctx, rc);
  for (const [days, price] of [
    [80, '216000'],
    [35, '540000'],
  ] as const) {
    const act = await createDocument(db, ctx, {
      type: 'act',
      counterpartyId: refs.customerId,
      date: iso(days),
      investmentProjectId: paint,
      comment: 'Окраска изделий заказчика',
      lines: [{ productId: refs.serviceId, name: 'Окраска изделий', qty: '1', price, discountPct: '0', vatRate: '20' }],
    });
    await postDocument(db, ctx, act);
  }
  // факт по статье проекта: «Прочие затраты» без поля — монтаж попадает в проект по закреплённой статье
  const oc = await createOtherCosts(db, ctx, { date: iso(165), comment: 'Монтаж окрасочной камеры', lines: [{ costItemId: mounting, amount: '410000', comment: 'Монтаж и вентиляция' }] });
  await postDocument(db, ctx, oc);

  // черновик: помесячный план, факта нет
  const wms = await item('Складская автоматизация', 'expense');
  const savings = await item('Экономия на складских операциях', 'income');
  await createInvestment(db, ctx, {
    name: 'Адресное хранение на складе',
    periodKind: 'month',
    startDate: periodStart(iso(-30), 'month'),
    periods: 24,
    discountRate: '16',
    projectId: null,
    organizationId: refs.organizationId,
    responsibleId: ctx.memberId,
    comment: 'Сканеры, стеллажи и WMS: меньше пересортицы и быстрее сборка заказов',
    costItemIds: [],
    lines: [
      { periodIndex: 0, costItemId: wms, amount: '780000', comment: 'Стеллажи и сканеры' },
      { periodIndex: 1, costItemId: wms, amount: '240000', comment: 'Внедрение WMS' },
      ...Array.from({ length: 22 }, (_, k) => ({ periodIndex: k + 2, costItemId: savings, amount: '55000', comment: '' })),
    ],
  });
}
