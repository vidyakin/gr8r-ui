/* CRM: компании, контакты, сделки, активности. */
import { eq, gte, inArray, lte } from 'drizzle-orm';
import { companies, contacts, crmActivities, dealContacts, deals } from '@gr8r/db';
import {
  companyCreate,
  companyQuery,
  companyUpdate,
  contactCreate,
  contactQuery,
  contactUpdate,
  crmActivityCreate,
  crmActivityQuery,
  crmActivityUpdate,
  dealCreate,
  dealQuery,
  dealUpdate,
} from '@gr8r/shared';
import { crud, type Ctx } from '../crud';
import { forbidden } from '../errors';
import { hasRole } from '../middleware';
import { customForCreate, customForUpdate } from '../meta/service';
import { nextOrder } from './helpers';
import { assertRequisites } from './documents';

export const companyRoutes = crud({
  entity: 'company',
  table: companies,
  create: companyCreate,
  update: companyUpdate,
  query: companyQuery,
  sortable: { name: companies.name, industry: companies.industry, city: companies.city, createdAt: companies.createdAt },
  defaultSort: 'name',
  search: [companies.name, companies.industry, companies.city, companies.website, companies.inn],
  filters: q => [q.ownerId ? eq(companies.ownerId, q.ownerId) : undefined, q.industry ? eq(companies.industry, q.industry) : undefined],
  prepareCreate: async (ctx, body) => {
    assertRequisites(body);
    return { ownerId: body.ownerId ?? ctx.memberId, ...(await customForCreate(ctx, 'company', body.custom)) };
  },
  prepareUpdate: (ctx, existing, body) => {
    // реквизиты проверяются по итоговому состоянию: тип, ИНН, КПП и ОГРН зависят друг от друга
    assertRequisites({ kind: body.kind ?? existing.kind, inn: body.inn ?? existing.inn, kpp: body.kpp ?? existing.kpp, ogrn: body.ogrn ?? existing.ogrn });
    return customForUpdate(ctx, 'company', existing.custom, body.custom, existing.id);
  },
});

export const contactRoutes = crud({
  entity: 'contact',
  table: contacts,
  create: contactCreate,
  update: contactUpdate,
  query: contactQuery,
  sortable: { name: contacts.name, createdAt: contacts.createdAt, title: contacts.title },
  defaultSort: 'name',
  search: [contacts.name, contacts.email, contacts.phone, contacts.title],
  filters: q => [q.companyId ? eq(contacts.companyId, q.companyId) : undefined, q.ownerId ? eq(contacts.ownerId, q.ownerId) : undefined],
  prepareCreate: async (ctx, body) => ({ ownerId: body.ownerId ?? ctx.memberId, ...(await customForCreate(ctx, 'contact', body.custom)) }),
  prepareUpdate: (ctx, existing, body) => customForUpdate(ctx, 'contact', existing.custom, body.custom, existing.id),
});

const CLOSED = ['won', 'lost'];

async function setDealContacts(ctx: Ctx, dealId: string, ids: string[]) {
  await ctx.db.delete(dealContacts).where(eq(dealContacts.dealId, dealId));
  const uniq = [...new Set(ids)];
  if (uniq.length) await ctx.db.insert(dealContacts).values(uniq.map(contactId => ({ workspaceId: ctx.workspaceId, dealId, contactId })));
}

export const dealRoutes = crud({
  entity: 'deal',
  table: deals,
  create: dealCreate,
  update: dealUpdate,
  query: dealQuery,
  sortable: { name: deals.name, amount: deals.amount, stage: deals.stage, closeDate: deals.closeDate, sortOrder: deals.sortOrder, createdAt: deals.createdAt, updatedAt: deals.updatedAt },
  defaultSort: 'sortOrder',
  search: [deals.name],
  filters: q => [
    q.stage ? eq(deals.stage, q.stage) : undefined,
    q.companyId ? eq(deals.companyId, q.companyId) : undefined,
    q.ownerId ? eq(deals.ownerId, q.ownerId) : undefined,
    q.closeFrom ? gte(deals.closeDate, q.closeFrom) : undefined,
    q.closeTo ? lte(deals.closeDate, q.closeTo) : undefined,
  ],
  prepareCreate: async (ctx, body) => ({
    ownerId: body.ownerId ?? ctx.memberId,
    sortOrder: body.sortOrder ?? (await nextOrder(ctx, deals, eq(deals.stage, body.stage))),
    closedAt: CLOSED.includes(body.stage) ? (body.closedAt ?? new Date().toISOString().slice(0, 10)) : null,
    ...(await customForCreate(ctx, 'deal', body.custom)),
  }),
  afterCreate: async (ctx, row, body) => {
    if (body.contactIds) await setDealContacts(ctx, row.id, body.contactIds);
  },
  prepareUpdate: async (ctx, existing, body) => {
    const patch: Record<string, unknown> = { ...(await customForUpdate(ctx, 'deal', existing.custom, body.custom, existing.id)) };
    if (body.stage && body.stage !== existing.stage) {
      // Переход в won/lost фиксирует дату закрытия; возврат в открытый этап — сбрасывает её и причину отказа
      if (CLOSED.includes(body.stage)) patch.closedAt = body.closedAt ?? new Date().toISOString().slice(0, 10);
      else {
        patch.closedAt = null;
        patch.lostReason = null;
      }
      if (body.sortOrder === undefined) patch.sortOrder = await nextOrder(ctx, deals, eq(deals.stage, body.stage));
    }
    return patch;
  },
  afterUpdate: async (ctx, before, after, body) => {
    if (body.contactIds) await setDealContacts(ctx, after.id, body.contactIds);
    if (before.stage !== after.stage) {
      // Служебная запись о смене этапа (как в локальной модели фронтенда)
      await ctx.db.insert(crmActivities).values({ workspaceId: ctx.workspaceId, type: 'note', subject: `Stage changed: ${before.stage} → ${after.stage}`, dealId: after.id, companyId: after.companyId, authorId: ctx.memberId, system: true });
    }
  },
  decorate: async (ctx, rows) => {
    if (!rows.length) return [];
    const dc = await ctx.db.select({ dealId: dealContacts.dealId, contactId: dealContacts.contactId }).from(dealContacts).where(inArray(dealContacts.dealId, rows.map(r => r.id)));
    return rows.map(r => ({ ...r, contactIds: dc.filter(x => x.dealId === r.id).map(x => x.contactId) }));
  },
});

export const crmActivityRoutes = crud({
  entity: 'crm_activity',
  table: crmActivities,
  create: crmActivityCreate,
  update: crmActivityUpdate,
  query: crmActivityQuery,
  sortable: { createdAt: crmActivities.createdAt, dueDate: crmActivities.dueDate },
  defaultSort: '-createdAt',
  search: [crmActivities.subject, crmActivities.body],
  filters: q => [
    q.type ? eq(crmActivities.type, q.type) : undefined,
    q.dealId ? eq(crmActivities.dealId, q.dealId) : undefined,
    q.companyId ? eq(crmActivities.companyId, q.companyId) : undefined,
    q.contactId ? eq(crmActivities.contactId, q.contactId) : undefined,
    q.leadId ? eq(crmActivities.leadId, q.leadId) : undefined,
  ],
  prepareCreate: async (ctx, body) => {
    // Компания берётся из сделки, если не указана
    let companyId = body.companyId;
    if (!companyId && body.dealId) companyId = (await ctx.db.select({ c: deals.companyId }).from(deals).where(eq(deals.id, body.dealId)).limit(1))[0]?.c ?? null;
    return { authorId: ctx.memberId, companyId, done: body.type === 'task' ? (body.done ?? false) : null, system: false };
  },
  prepareUpdate: (ctx, existing) => {
    if (existing.system) throw forbidden('System records cannot be edited');
    if (existing.authorId !== ctx.memberId && !hasRole(ctx.c, 'admin')) throw forbidden('Only the author or an admin can change this record');
    return {};
  },
  beforeDelete: (ctx, row) => {
    if (row.system) throw forbidden('System records cannot be deleted');
    if (row.authorId !== ctx.memberId && !hasRole(ctx.c, 'admin')) throw forbidden('Only the author or an admin can change this record');
  },
});
