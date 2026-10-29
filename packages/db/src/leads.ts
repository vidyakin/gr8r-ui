/* Лиды (задача 1175, docs/architecture/leads.md): создание (вручную, вебхук, узел автоматизации), поиск дублей,
   объединение, конвертация в контрагента / контакт / сделку, распределение ответственных. Всё идёт в транзакции
   вызывающего: данные + события outbox вместе. Права проверяют маршруты. */
import { and, asc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { membersWithFunction, normalizeEmail, normalizePhone, nextRoundRobin, phoneKey, type LeadStatusCategory, type MemberPositionLink, type PositionDef } from '@gr8r/shared';
import { resolveAttribution } from './ad';
import type { Db } from './client';
import { DomainError } from './errors';
import { recordEvent } from './events';
import {
  companies,
  contacts,
  crmActivities,
  dealContacts,
  deals,
  leadAssignCursor,
  leadForms,
  leadStatuses,
  leads,
  memberPositions,
  members,
  positions,
} from './schema';

export type LeadRow = typeof leads.$inferSelect;
export type LeadStatusRow = typeof leadStatuses.$inferSelect;

export interface LeadCtx {
  workspaceId: string;
  /** members.id автора; null — вебхук или автоматизация */
  memberId: string | null;
  /** Метка flow (защита от зацикливания): попадает в payload событий */
  via?: Record<string, unknown> | undefined;
}

const json = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const withVia = (ctx: LeadCtx, payload: Record<string, unknown>) => (ctx.via ? { ...payload, via: ctx.via } : payload);

/* ---------------- статусы ---------------- */

export const DEFAULT_LEAD_STATUSES: { name: string; category: LeadStatusCategory; color: string }[] = [
  { name: 'New', category: 'new', color: 'blue' },
  { name: 'Contacted', category: 'in_progress', color: 'amber' },
  { name: 'Qualified', category: 'in_progress', color: 'violet' },
  { name: 'Converted', category: 'converted', color: 'green' },
  { name: 'Rejected', category: 'rejected', color: 'red' },
];

/** Статусы нового воркспейса (в существующих их создаёт миграция). Повторный вызов ничего не дублирует */
export async function ensureLeadStatuses(db: Db, workspaceId: string, names: { name: string; category: LeadStatusCategory; color: string }[] = DEFAULT_LEAD_STATUSES): Promise<void> {
  await db
    .insert(leadStatuses)
    .values(names.map((s, i) => ({ workspaceId, name: s.name, category: s.category, color: s.color, sortOrder: i })))
    .onConflictDoNothing();
}

/** Первый (по порядку) статус категории */
export async function statusOfCategory(db: Db, category: LeadStatusCategory): Promise<LeadStatusRow> {
  const [s] = await db.select().from(leadStatuses).where(eq(leadStatuses.category, category)).orderBy(asc(leadStatuses.sortOrder), asc(leadStatuses.createdAt)).limit(1);
  if (!s) throw new DomainError(422, 'lead_status_missing', `No lead status in category "${category}"`);
  return s;
}

/* ---------------- создание ---------------- */

export interface LeadInput {
  name: string;
  companyName?: string | undefined;
  phone?: string | undefined;
  email?: string | undefined;
  comment?: string | undefined;
  /** Источник по названию (найдётся или создастся); `sourceId` / `campaignId` важнее (задача 1177) */
  source?: string | undefined;
  sourceId?: string | null | undefined;
  campaignId?: string | null | undefined;
  ownerId?: string | null | undefined;
  statusId?: string | undefined;
  formId?: string | null | undefined;
  custom?: Record<string, unknown> | undefined;
  id?: string | undefined;
}

/** Вставка лида: нормализация телефона и email, статус по умолчанию — первый статус категории new. Событие lead.created */
export async function insertLead(db: Db, ctx: LeadCtx, input: LeadInput): Promise<LeadRow> {
  const name = input.name.trim();
  if (!name) throw new DomainError(422, 'lead_name_required', 'Lead name is required');
  const status = input.statusId ? await loadStatus(db, input.statusId) : await statusOfCategory(db, 'new');
  if (status.category === 'converted') throw new DomainError(422, 'lead_use_convert', 'Use conversion to move a lead to a converted status');
  const attr = await resolveAttribution(db, ctx.workspaceId, { sourceId: input.sourceId, campaignId: input.campaignId, sourceName: input.sourceId || input.campaignId ? undefined : input.source });
  const [row] = await db
    .insert(leads)
    .values({
      ...(input.id ? { id: input.id } : {}),
      workspaceId: ctx.workspaceId,
      name,
      companyName: input.companyName?.trim() ?? '',
      phone: input.phone?.trim() ?? '',
      phoneNorm: normalizePhone(input.phone),
      email: input.email?.trim() ?? '',
      emailNorm: normalizeEmail(input.email),
      comment: input.comment ?? '',
      ...attr,
      ownerId: input.ownerId ?? null,
      statusId: status.id,
      formId: input.formId ?? null,
      custom: input.custom ?? {},
    })
    .returning();
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'lead.created', entity: 'lead', recordId: row!.id, actorId: ctx.memberId, payload: withVia(ctx, { record: json(row!) }) });
  return row!;
}

async function loadStatus(db: Db, id: string): Promise<LeadStatusRow> {
  const [s] = await db.select().from(leadStatuses).where(eq(leadStatuses.id, id)).limit(1);
  if (!s) throw new DomainError(422, 'lead_status_missing', 'Lead status not found');
  return s;
}

export async function loadLead(db: Db, id: string, lock = false): Promise<LeadRow> {
  const q = db.select().from(leads).where(eq(leads.id, id)).limit(1);
  const [l] = await (lock ? q.for('update') : q);
  if (!l) throw new DomainError(404, 'not_found', 'Lead not found');
  return l;
}

/* ---------------- распределение ---------------- */

/** Активные участники с функцией sales_manager; если такой должности нет вообще — все активные (как `membersWithFunction`) */
export async function salesManagerIds(db: Db): Promise<string[]> {
  const ms = await db.select({ id: members.id }).from(members).where(eq(members.status, 'active'));
  const pos = await db.select({ id: positions.id, functions: positions.functions, sections: positions.sections }).from(positions);
  const links = await db.select({ memberId: memberPositions.memberId, positionId: memberPositions.positionId }).from(memberPositions);
  const defs: PositionDef[] = pos.map(p => ({ id: p.id, functions: p.functions, sections: p.sections }));
  return membersWithFunction(ms, defs, links as MemberPositionLink[], 'sales_manager').map(m => m.id);
}

/** Следующий менеджер по кругу: курсор хранится в lead_assign_cursor (блокировка строки исключает гонку двух лидов) */
export async function pickRoundRobin(db: Db, workspaceId: string): Promise<string | null> {
  const ids = await salesManagerIds(db);
  if (!ids.length) return null;
  await db.insert(leadAssignCursor).values({ workspaceId }).onConflictDoNothing();
  const [cur] = await db.select().from(leadAssignCursor).where(eq(leadAssignCursor.workspaceId, workspaceId)).limit(1).for('update');
  const next = nextRoundRobin(ids, cur?.lastMemberId);
  if (next) await db.update(leadAssignCursor).set({ lastMemberId: next, updatedAt: new Date() }).where(eq(leadAssignCursor.workspaceId, workspaceId));
  return next;
}

/** Назначить ответственного: вручную (memberId) или по кругу. Событие lead.updated с changes.ownerId */
export async function assignLead(db: Db, ctx: LeadCtx, leadId: string, mode: 'manual' | 'round_robin', memberId?: string | null): Promise<{ ownerId: string | null; changed: boolean }> {
  const lead = await loadLead(db, leadId, true);
  let ownerId: string | null;
  if (mode === 'round_robin') {
    ownerId = await pickRoundRobin(db, ctx.workspaceId);
    if (!ownerId) throw new DomainError(422, 'no_sales_managers', 'There are no members to assign leads to');
  } else {
    if (!memberId) throw new DomainError(422, 'validation_error', 'memberId is required for manual assignment');
    const [m] = await db.select({ id: members.id }).from(members).where(eq(members.id, memberId)).limit(1);
    if (!m) throw new DomainError(422, 'invalid_reference', 'Member not found');
    ownerId = memberId;
  }
  if (lead.ownerId === ownerId) return { ownerId, changed: false };
  await db.update(leads).set({ ownerId, updatedAt: new Date() }).where(eq(leads.id, leadId));
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'lead.updated', entity: 'lead', recordId: leadId, actorId: ctx.memberId, payload: withVia(ctx, { changes: { ownerId: { from: lead.ownerId, to: ownerId } } }) });
  return { ownerId, changed: true };
}

/* ---------------- дубли ---------------- */

export interface DuplicateMatch {
  kind: 'lead' | 'contact' | 'company';
  id: string;
  name: string;
  /** По чему совпало */
  by: 'phone' | 'email' | 'contact' | 'name';
  companyId?: string | null;
  phone?: string;
  email?: string;
}

/** Совпадения по телефону (последние 10 цифр) и email среди лидов, контактов и контрагентов.
    У контрагента нет своих телефона и email, поэтому он находится через найденный контакт или по точному названию компании лида. */
export async function findDuplicates(db: Db, q: { phone?: string | undefined; email?: string | undefined; companyName?: string | undefined; excludeLeadId?: string | undefined }): Promise<DuplicateMatch[]> {
  const key = phoneKey(q.phone);
  const email = normalizeEmail(q.email);
  const out: DuplicateMatch[] = [];
  const phoneExpr = (col: string) => sql`right(regexp_replace(${sql.raw(col)}, '\\D', '', 'g'), 10)`;

  if (key || email) {
    const leadConds = [];
    if (key) leadConds.push(sql`${phoneExpr('phone')} = ${key}`);
    if (email) leadConds.push(eq(leads.emailNorm, email));
    const lrows = await db
      .select()
      .from(leads)
      .where(and(isNull(leads.archivedAt), q.excludeLeadId ? ne(leads.id, q.excludeLeadId) : undefined, or(...leadConds)))
      .limit(20);
    for (const l of lrows) out.push({ kind: 'lead', id: l.id, name: l.name, by: key && phoneKey(l.phone) === key ? 'phone' : 'email', phone: l.phone, email: l.email });

    const contactConds = [];
    if (key) contactConds.push(sql`${phoneExpr('phone')} = ${key}`);
    if (email) contactConds.push(sql`lower(${contacts.email}) = ${email}`);
    const crows = await db.select().from(contacts).where(and(isNull(contacts.archivedAt), or(...contactConds))).limit(20);
    const companyIds = new Set<string>();
    for (const c of crows) {
      out.push({ kind: 'contact', id: c.id, name: c.name, by: key && phoneKey(c.phone) === key ? 'phone' : 'email', companyId: c.companyId, phone: c.phone, email: c.email });
      if (c.companyId) companyIds.add(c.companyId);
    }
    if (companyIds.size) {
      const comps = await db.select().from(companies).where(and(isNull(companies.archivedAt), inArray(companies.id, [...companyIds])));
      for (const co of comps) out.push({ kind: 'company', id: co.id, name: co.name, by: 'contact' });
    }
  }
  const cn = q.companyName?.trim();
  if (cn) {
    const comps = await db.select().from(companies).where(and(isNull(companies.archivedAt), sql`lower(${companies.name}) = ${cn.toLowerCase()}`)).limit(5);
    for (const co of comps) if (!out.some(o => o.kind === 'company' && o.id === co.id)) out.push({ kind: 'company', id: co.id, name: co.name, by: 'name' });
  }
  return out;
}

/* ---------------- объединение ---------------- */

/** Объединить лид `fromId` в `intoId`: касания переезжают, пустые поля целевого лида заполняются, пользовательские поля целевого
    имеют приоритет, комментарий дописывается; исходный лид удаляется. Оба лида не должны быть сконвертированы */
export async function mergeLeads(db: Db, ctx: LeadCtx, fromId: string, intoId: string): Promise<LeadRow> {
  if (fromId === intoId) throw new DomainError(422, 'lead_merge_same', 'Cannot merge a lead into itself');
  const [a, b] = fromId < intoId ? [fromId, intoId] : [intoId, fromId];
  await loadLead(db, a, true);
  await loadLead(db, b, true);
  const from = await loadLead(db, fromId);
  const into = await loadLead(db, intoId);
  if (from.convertedAt || into.convertedAt) throw new DomainError(409, 'lead_already_converted', 'Converted leads cannot be merged');
  const phone = into.phone || from.phone;
  const email = into.email || from.email;
  const patch = {
    companyName: into.companyName || from.companyName,
    phone,
    phoneNorm: normalizePhone(phone),
    email,
    emailNorm: normalizeEmail(email),
    ...(into.sourceId ? {} : { source: from.source, sourceId: from.sourceId, campaignId: from.campaignId }),
    ownerId: into.ownerId ?? from.ownerId,
    comment: [into.comment, from.comment].filter(Boolean).join('\n\n'),
    custom: { ...from.custom, ...into.custom },
    updatedAt: new Date(),
  };
  await db.update(crmActivities).set({ leadId: intoId }).where(eq(crmActivities.leadId, fromId));
  const [after] = await db.update(leads).set(patch).where(eq(leads.id, intoId)).returning();
  await db.insert(crmActivities).values({ workspaceId: ctx.workspaceId, type: 'note', subject: `Merged lead: ${from.name}`, leadId: intoId, authorId: ctx.memberId, system: true });
  await db.delete(leads).where(eq(leads.id, fromId));
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'lead.deleted', entity: 'lead', recordId: fromId, actorId: ctx.memberId, payload: withVia(ctx, { mergedInto: intoId }) });
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'lead.updated', entity: 'lead', recordId: intoId, actorId: ctx.memberId, payload: withVia(ctx, { changes: { merged: { from: fromId, to: intoId } } }) });
  return after!;
}

/* ---------------- конвертация ---------------- */

export type ConvertTarget = { mode: 'existing'; id: string } | { mode: 'new'; name: string } | { mode: 'none' };

export interface ConvertInput {
  company: ConvertTarget;
  contact: ConvertTarget;
  deal?: { name: string; amount?: string | undefined } | null | undefined;
}

export interface ConvertResult {
  lead: LeadRow;
  companyId: string | null;
  contactId: string | null;
  dealId: string | null;
  movedActivities: number;
}

/** Конвертация: найти или создать контрагента и контакт, при необходимости создать сделку; касания лида переезжают к контакту / сделке;
    лид получает первый статус категории converted и ссылки. Повторно конвертировать нельзя (409 `lead_already_converted`). */
export async function convertLead(db: Db, ctx: LeadCtx, leadId: string, input: ConvertInput): Promise<ConvertResult> {
  const lead = await loadLead(db, leadId, true);
  if (lead.convertedAt) throw new DomainError(409, 'lead_already_converted', 'The lead has already been converted');
  const owner = lead.ownerId ?? ctx.memberId;
  const ev = (type: string, entity: string, id: string, record: unknown) => recordEvent(db, { workspaceId: ctx.workspaceId, type, entity, recordId: id, actorId: ctx.memberId, payload: withVia(ctx, { record: json(record) }) });

  let companyId: string | null = null;
  if (input.company.mode === 'existing') {
    const [c] = await db.select({ id: companies.id, sourceId: companies.sourceId }).from(companies).where(eq(companies.id, input.company.id)).limit(1);
    if (!c) throw new DomainError(422, 'invalid_reference', 'Company not found');
    companyId = c.id;
    // первое касание важнее: источник существующему контрагенту ставится, только если его нет
    if (!c.sourceId && lead.sourceId) await db.update(companies).set({ sourceId: lead.sourceId, campaignId: lead.campaignId, updatedAt: new Date() }).where(eq(companies.id, c.id));
  } else if (input.company.mode === 'new') {
    const name = input.company.name.trim();
    if (!name) throw new DomainError(422, 'validation_error', 'Company name is required');
    const [c] = await db.insert(companies).values({ workspaceId: ctx.workspaceId, name, ownerId: owner, kind: 'legal', sourceId: lead.sourceId, campaignId: lead.campaignId }).returning();
    companyId = c!.id;
    await ev('company.created', 'company', c!.id, c);
  }

  let contactId: string | null = null;
  if (input.contact.mode === 'existing') {
    const [c] = await db.select({ id: contacts.id }).from(contacts).where(eq(contacts.id, input.contact.id)).limit(1);
    if (!c) throw new DomainError(422, 'invalid_reference', 'Contact not found');
    contactId = c.id;
  } else if (input.contact.mode === 'new') {
    const name = input.contact.name.trim() || lead.name;
    const [c] = await db.insert(contacts).values({ workspaceId: ctx.workspaceId, name, email: lead.email, phone: lead.phone, companyId, ownerId: owner, custom: lead.custom }).returning();
    contactId = c!.id;
    await ev('contact.created', 'contact', c!.id, c);
  }

  let dealId: string | null = null;
  if (input.deal) {
    const [d] = await db
      .insert(deals)
      .values({ workspaceId: ctx.workspaceId, name: input.deal.name.trim() || lead.name, companyId, ownerId: owner, amount: input.deal.amount ?? '0', stage: 'qualified', sourceId: lead.sourceId, campaignId: lead.campaignId })
      .returning();
    dealId = d!.id;
    if (contactId) await db.insert(dealContacts).values({ workspaceId: ctx.workspaceId, dealId, contactId });
    await ev('deal.created', 'deal', d!.id, d);
  }

  // Касания лида переезжают к сделке (если есть), иначе к контакту / контрагенту
  const moved = await db
    .update(crmActivities)
    .set({ leadId: null, dealId, contactId, companyId })
    .where(eq(crmActivities.leadId, leadId))
    .returning({ id: crmActivities.id });
  if (dealId || contactId || companyId) {
    await db.insert(crmActivities).values({ workspaceId: ctx.workspaceId, type: 'note', subject: `Converted from lead: ${lead.name}`, body: lead.comment || null, dealId, contactId, companyId, authorId: ctx.memberId, system: true });
  }

  const status = await statusOfCategory(db, 'converted');
  const [after] = await db
    .update(leads)
    .set({ statusId: status.id, convertedAt: new Date(), companyId, contactId, dealId, updatedAt: new Date() })
    .where(eq(leads.id, leadId))
    .returning();
  await recordEvent(db, {
    workspaceId: ctx.workspaceId,
    type: 'lead.updated',
    entity: 'lead',
    recordId: leadId,
    actorId: ctx.memberId,
    payload: withVia(ctx, { changes: { statusId: { from: lead.statusId, to: status.id }, convertedAt: { from: null, to: after!.convertedAt }, companyId: { from: null, to: companyId }, contactId: { from: null, to: contactId }, dealId: { from: null, to: dealId } }, converted: true }),
  });
  return { lead: after!, companyId, contactId, dealId, movedActivities: moved.length };
}

/* ---------------- форма сайта (вебхук) ---------------- */

export const LEAD_FORM_FIELD_MAX = 2000;

/** Токен формы: `<workspace_id>.<секрет>`. Секрет — 24 случайных байта (base64url) */
export const newFormSecret = () => Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString('base64url');
export const formToken = (workspaceId: string, secret: string) => `${workspaceId}.${secret}`;

/** Разбор токена вебхука: воркспейс (для контекста RLS) и секрет формы. null — формат неверен */
export function parseFormToken(token: string): { workspaceId: string; secret: string } | null {
  const m = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.([A-Za-z0-9_-]{16,64})$/i.exec(token);
  return m ? { workspaceId: m[1]!.toLowerCase(), secret: m[2]! } : null;
}

export async function findEnabledForm(db: Db, secret: string) {
  const [f] = await db.select().from(leadForms).where(and(eq(leadForms.token, secret), eq(leadForms.enabled, true))).limit(1);
  return f ?? null;
}
