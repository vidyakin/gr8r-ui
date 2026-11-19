/* Обращения клиентов (docs/architecture/cases.md): создание (вручную, из формы сайта, из письма), статусы и SLA, распределение,
   заказ-наряд из обращения, проход «просрочка SLA». Всё идёт в транзакции вызывающего: данные + события outbox вместе.
   Права проверяют маршруты. */
import { and, asc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import {
  CASE_REOPEN_DAYS,
  DEFAULT_CASE_SLA,
  canChangeCaseStatus,
  caseDueDates,
  formatCaseNumber,
  isCaseOpen,
  membersWithFunction,
  nextRoundRobin,
  normalizeEmail,
  normalizePhone,
  phoneKey,
  type CasePriority,
  type CaseSlaRules,
  type CaseStatus,
  type MemberPositionLink,
  type PositionDef,
} from '@erp/shared';
import type { Db } from './client';
import { createDocument, type DocCtx } from './documents';
import { DomainError } from './errors';
import { recordEvent } from './events';
import { insertLead } from './leads';
import {
  caseAssignCursor,
  caseCounters,
  caseForms,
  caseSlaRules,
  cases,
  companies,
  contacts,
  crmActivities,
  deals,
  documents,
  leads,
  mailboxes,
  memberPositions,
  members,
  notifications,
  positions,
} from './schema';

export type CaseRow = typeof cases.$inferSelect;

export interface CaseCtx {
  workspaceId: string;
  /** members.id автора; null — вебхук, почта или автоматизация */
  memberId: string | null;
  role?: DocCtx['role'];
  via?: Record<string, unknown> | undefined;
}

const json = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const withVia = (ctx: CaseCtx, payload: Record<string, unknown>) => (ctx.via ? { ...payload, via: ctx.via } : payload);
const DAY = 86_400_000;

/* ---------------- SLA ---------------- */

/** Правила воркспейса: заданные в таблице поверх значений по умолчанию */
export async function loadSlaRules(db: Db): Promise<CaseSlaRules> {
  const rows = await db.select().from(caseSlaRules);
  const out: CaseSlaRules = JSON.parse(JSON.stringify(DEFAULT_CASE_SLA));
  for (const r of rows) out[r.priority] = { firstResponseHours: r.firstResponseHours, resolveHours: r.resolveHours };
  return out;
}

export async function saveSlaRules(db: Db, workspaceId: string, rules: CaseSlaRules): Promise<CaseSlaRules> {
  for (const [priority, r] of Object.entries(rules) as [CasePriority, CaseSlaRules[CasePriority]][]) {
    await db
      .insert(caseSlaRules)
      .values({ workspaceId, priority, firstResponseHours: r.firstResponseHours, resolveHours: r.resolveHours })
      .onConflictDoUpdate({ target: [caseSlaRules.workspaceId, caseSlaRules.priority], set: { firstResponseHours: r.firstResponseHours, resolveHours: r.resolveHours, updatedAt: new Date() } });
  }
  return loadSlaRules(db);
}

/* ---------------- номера и распределение ---------------- */

/** Следующий номер воркспейса на год: строка счётчика блокируется до коммита, номера идут подряд */
async function nextCaseNumber(db: Db, workspaceId: string, year: number): Promise<string> {
  const [r] = await db
    .insert(caseCounters)
    .values({ workspaceId, year, lastNumber: 1 })
    .onConflictDoUpdate({ target: [caseCounters.workspaceId, caseCounters.year], set: { lastNumber: sql`${caseCounters.lastNumber} + 1` } })
    .returning({ n: caseCounters.lastNumber });
  return formatCaseNumber(year, r!.n);
}

/** Активные участники с функцией support_agent; если такой должности нет вообще — все активные */
export async function supportAgentIds(db: Db): Promise<string[]> {
  const ms = await db.select({ id: members.id }).from(members).where(eq(members.status, 'active'));
  const pos = await db.select({ id: positions.id, functions: positions.functions, sections: positions.sections }).from(positions);
  const links = await db.select({ memberId: memberPositions.memberId, positionId: memberPositions.positionId }).from(memberPositions);
  const defs: PositionDef[] = pos.map(p => ({ id: p.id, functions: p.functions, sections: p.sections }));
  return membersWithFunction(ms, defs, links as MemberPositionLink[], 'support_agent').map(m => m.id);
}

/** Следующий сотрудник по кругу; курсор блокируется (гонки двух обращений нет) */
export async function pickCaseRoundRobin(db: Db, workspaceId: string): Promise<string | null> {
  const ids = await supportAgentIds(db);
  if (!ids.length) return null;
  await db.insert(caseAssignCursor).values({ workspaceId }).onConflictDoNothing();
  const [cur] = await db.select().from(caseAssignCursor).where(eq(caseAssignCursor.workspaceId, workspaceId)).limit(1).for('update');
  const next = nextRoundRobin(ids, cur?.lastMemberId);
  if (next) await db.update(caseAssignCursor).set({ lastMemberId: next, updatedAt: new Date() }).where(eq(caseAssignCursor.workspaceId, workspaceId));
  return next;
}

/* ---------------- создание ---------------- */

export interface CaseInput {
  subject: string;
  description?: string | undefined;
  priority?: CasePriority | undefined;
  channel?: 'email' | 'manual' | 'web_form' | undefined;
  companyId?: string | null | undefined;
  contactId?: string | null | undefined;
  leadId?: string | null | undefined;
  /** Явный ответственный; иначе defaultOwnerId (ящик, форма), иначе по кругу */
  ownerId?: string | null | undefined;
  defaultOwnerId?: string | null | undefined;
  dealId?: string | null | undefined;
  mailboxId?: string | null | undefined;
  formId?: string | null | undefined;
  custom?: Record<string, unknown> | undefined;
  /** Время создания (тесты, перенос) */
  at?: Date | undefined;
}

async function assertRefs(db: Db, i: Omit<CaseInput, "subject"> | CasePatch) {
  const check = async (id: string | null | undefined, table: typeof companies | typeof contacts | typeof leads | typeof deals | typeof members | typeof mailboxes, what: string) => {
    if (!id) return;
    const [r] = await db.select({ id: table.id }).from(table).where(eq(table.id, id)).limit(1);
    if (!r) throw new DomainError(422, 'invalid_reference', `${what} not found`);
  };
  await check(i.companyId, companies, 'Company');
  await check(i.contactId, contacts, 'Contact');
  await check(i.leadId, leads, 'Lead');
  await check(i.dealId, deals, 'Deal');
  await check(i.ownerId, members, 'Owner');
  await check(i.mailboxId, mailboxes, 'Mailbox');
}

/** Вставка обращения: номер, сроки SLA по приоритету, ответственный. Событие case.created */
export async function insertCase(db: Db, ctx: CaseCtx, input: CaseInput): Promise<CaseRow> {
  const subject = input.subject.trim();
  if (!subject) throw new DomainError(422, 'case_subject_required', 'Case subject is required');
  await assertRefs(db, input);
  // контакт без контрагента приводит свой контрагент
  let companyId = input.companyId ?? null;
  if (input.contactId && !companyId) {
    const [c] = await db.select({ companyId: contacts.companyId }).from(contacts).where(eq(contacts.id, input.contactId)).limit(1);
    companyId = c?.companyId ?? null;
  }
  const at = input.at ?? new Date();
  const priority = input.priority ?? 'normal';
  const rules = await loadSlaRules(db);
  const due = caseDueDates(at, priority, rules);
  const ownerId = input.ownerId ?? input.defaultOwnerId ?? (await pickCaseRoundRobin(db, ctx.workspaceId));
  const number = await nextCaseNumber(db, ctx.workspaceId, at.getUTCFullYear());
  const [row] = await db
    .insert(cases)
    .values({
      workspaceId: ctx.workspaceId,
      number,
      subject: subject.slice(0, 500),
      description: input.description ?? '',
      priority,
      channel: input.channel ?? 'manual',
      companyId,
      contactId: input.contactId ?? null,
      leadId: input.leadId ?? null,
      ownerId,
      dealId: input.dealId ?? null,
      mailboxId: input.mailboxId ?? null,
      formId: input.formId ?? null,
      firstResponseDueAt: due.firstResponseDueAt,
      resolveDueAt: due.resolveDueAt,
      custom: input.custom ?? {},
      createdBy: ctx.memberId,
      createdAt: at,
      updatedAt: at,
    })
    .returning();
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'case.created', entity: 'case', recordId: row!.id, actorId: ctx.memberId, payload: withVia(ctx, { record: json(row!) }) });
  if (ownerId && ownerId !== ctx.memberId) await notifyCaseOwner(db, ctx.workspaceId, row!, ownerId, `New case ${row!.number}: ${row!.subject}`);
  return row!;
}

async function notifyCaseOwner(db: Db, workspaceId: string, c: CaseRow, recipientId: string, text: string, snippet = '') {
  const [n] = await db.insert(notifications).values({ workspaceId, recipientId, type: 'update', text: text.slice(0, 500), snippet: (snippet || c.description).slice(0, 500) }).returning();
  await recordEvent(db, { workspaceId, type: 'notification.created', entity: 'notification', recordId: n!.id, actorId: null, payload: { recipientId, caseId: c.id } });
}

export async function loadCase(db: Db, id: string, lock = false): Promise<CaseRow> {
  const q = db.select().from(cases).where(eq(cases.id, id)).limit(1);
  const [c] = await (lock ? q.for('update') : q);
  if (!c) throw new DomainError(404, 'not_found', 'Case not found');
  return c;
}

/* ---------------- правка и статусы ---------------- */

export interface CasePatch {
  subject?: string | undefined;
  description?: string | undefined;
  status?: CaseStatus | undefined;
  priority?: CasePriority | undefined;
  companyId?: string | null | undefined;
  contactId?: string | null | undefined;
  leadId?: string | null | undefined;
  ownerId?: string | null | undefined;
  dealId?: string | null | undefined;
  mailboxId?: string | null | undefined;
  custom?: Record<string, unknown> | undefined;
}

const PATCH_KEYS = ['subject', 'description', 'status', 'priority', 'companyId', 'contactId', 'leadId', 'ownerId', 'dealId', 'mailboxId', 'custom'] as const;

/** Правка обращения. Закрытое не правится (409 `case_closed`). Приоритет пересчитывает сроки от создания.
    `undefined` — не трогать, `null` — очистить. Событие case.updated с changes (по changes.status работает триггер смены статуса) */
export async function updateCase(db: Db, ctx: CaseCtx, id: string, patch: CasePatch, now: Date = new Date()): Promise<CaseRow> {
  const cur = await loadCase(db, id, true);
  if (cur.status === 'closed') throw new DomainError(409, 'case_closed', 'A closed case cannot be edited');
  await assertRefs(db, patch);
  const set: Record<string, unknown> = {};
  for (const k of PATCH_KEYS) if (k in patch && patch[k] !== undefined) set[k] = patch[k];
  if (patch.subject !== undefined && !patch.subject.trim()) throw new DomainError(422, 'case_subject_required', 'Case subject is required');
  if (patch.status && patch.status !== cur.status) {
    if (!canChangeCaseStatus(cur.status, patch.status)) throw new DomainError(409, 'case_closed', 'A closed case cannot be reopened');
    if (patch.status === 'resolved') set.resolvedAt = now;
    else if (patch.status === 'closed') {
      set.closedAt = now;
      set.resolvedAt = cur.resolvedAt ?? now;
    } else if (cur.status === 'resolved') set.resolvedAt = null;
  }
  if (patch.priority && patch.priority !== cur.priority) {
    const due = caseDueDates(cur.createdAt, patch.priority, await loadSlaRules(db));
    set.firstResponseDueAt = due.firstResponseDueAt;
    set.resolveDueAt = due.resolveDueAt;
    // новый срок в будущем — нарушение можно объявить снова
    if (due.firstResponseDueAt > now) set.firstResponseBreachedAt = null;
    if (due.resolveDueAt > now) set.resolveBreachedAt = null;
  }
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of [...PATCH_KEYS, 'resolvedAt', 'closedAt', 'firstResponseDueAt', 'resolveDueAt'] as const) {
    if (!(k in set)) continue;
    const from = (cur as Record<string, unknown>)[k];
    const to = set[k];
    if (JSON.stringify(from) !== JSON.stringify(to)) changes[k] = { from: json(from), to: json(to) };
  }
  if (!Object.keys(changes).length) return cur;
  const [row] = await db.update(cases).set({ ...set, updatedAt: now }).where(eq(cases.id, id)).returning();
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'case.updated', entity: 'case', recordId: id, actorId: ctx.memberId, payload: withVia(ctx, { changes }) });
  if (changes.ownerId && row!.ownerId && row!.ownerId !== ctx.memberId) await notifyCaseOwner(db, ctx.workspaceId, row!, row!.ownerId, `Case ${row!.number} assigned to you: ${row!.subject}`);
  return row!;
}

/** Первый исходящий ответ: ставит first_responded_at и переводит `new` в `in_progress`. Повторные ответы ничего не меняют */
export async function markFirstResponse(db: Db, ctx: CaseCtx, caseId: string, now: Date = new Date()): Promise<void> {
  const cur = await loadCase(db, caseId, true);
  if (cur.firstRespondedAt || !isCaseOpen(cur.status)) return;
  const toStatus = cur.status === 'new' ? 'in_progress' : cur.status;
  await db.update(cases).set({ firstRespondedAt: now, status: toStatus, updatedAt: now }).where(eq(cases.id, caseId));
  const changes: Record<string, { from: unknown; to: unknown }> = { firstRespondedAt: { from: null, to: now.toISOString() } };
  if (toStatus !== cur.status) changes.status = { from: cur.status, to: toStatus };
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'case.updated', entity: 'case', recordId: caseId, actorId: ctx.memberId, payload: withVia(ctx, { changes }) });
}

/** Ответ клиента на существующее обращение: `waiting` возвращается в `in_progress`; решённое в течение 7 дней открывается снова
    (вернёт обновлённое обращение). Закрытое или решённое давно обращение не меняется — вернётся null: вызывающий создаёт новое */
export async function applyClientReply(db: Db, ctx: CaseCtx, caseId: string, now: Date = new Date()): Promise<CaseRow | null> {
  const cur = await loadCase(db, caseId, true);
  if (cur.status === 'closed') return null;
  if (cur.status === 'resolved') {
    if (!cur.resolvedAt || now.getTime() - cur.resolvedAt.getTime() > CASE_REOPEN_DAYS * DAY) return null;
    const [row] = await db.update(cases).set({ status: 'in_progress', resolvedAt: null, updatedAt: now }).where(eq(cases.id, caseId)).returning();
    await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'case.updated', entity: 'case', recordId: caseId, actorId: ctx.memberId, payload: withVia(ctx, { changes: { status: { from: 'resolved', to: 'in_progress' }, resolvedAt: { from: cur.resolvedAt.toISOString(), to: null } } }) });
    if (row!.ownerId) await notifyCaseOwner(db, ctx.workspaceId, row!, row!.ownerId, `Case ${row!.number} reopened: ${row!.subject}`);
    return row!;
  }
  if (cur.status === 'waiting') {
    const [row] = await db.update(cases).set({ status: 'in_progress', updatedAt: now }).where(eq(cases.id, caseId)).returning();
    await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'case.updated', entity: 'case', recordId: caseId, actorId: ctx.memberId, payload: withVia(ctx, { changes: { status: { from: 'waiting', to: 'in_progress' } } }) });
    return row!;
  }
  return cur;
}

/* ---------------- клиент обращения ---------------- */

export interface Requester {
  companyId: string | null;
  contactId: string | null;
  leadId: string | null;
}

/** Контакт → (его контрагент) → лид по адресу и телефону; неизвестному с адресом или телефоном создаётся лид (если createLead) */
export async function resolveRequester(
  db: Db,
  ctx: CaseCtx,
  q: { email?: string | undefined; phone?: string | undefined; name?: string | undefined; company?: string | undefined; source?: string | undefined },
  createLead: boolean,
): Promise<Requester> {
  const email = normalizeEmail(q.email);
  const key = phoneKey(q.phone);
  const conds = [];
  if (email) conds.push(sql`lower(trim(${contacts.email})) = ${email}`);
  if (key) conds.push(sql`right(regexp_replace(${contacts.phone}, '\\D', '', 'g'), 10) = ${key}`);
  if (conds.length) {
    const [c] = await db.select().from(contacts).where(and(isNull(contacts.archivedAt), or(...conds))).orderBy(asc(contacts.createdAt), asc(contacts.id)).limit(1);
    if (c) return { companyId: c.companyId, contactId: c.id, leadId: null };
    const lconds = [];
    if (email) lconds.push(eq(leads.emailNorm, email));
    if (key) lconds.push(sql`right(regexp_replace(${leads.phone}, '\\D', '', 'g'), 10) = ${key}`);
    const [l] = await db.select().from(leads).where(and(isNull(leads.archivedAt), or(...lconds))).orderBy(asc(leads.createdAt), asc(leads.id)).limit(1);
    if (l) return { companyId: l.companyId, contactId: l.contactId, leadId: l.convertedAt ? null : l.id };
    if (createLead) {
      const lead = await insertLead(db, { workspaceId: ctx.workspaceId, memberId: null, ...(ctx.via ? { via: ctx.via } : {}) }, { name: q.name?.trim() || email || q.phone!.trim(), companyName: q.company, phone: q.phone, email: q.email, comment: '', ...(q.source ? { source: q.source } : {}) });
      return { companyId: null, contactId: null, leadId: lead.id };
    }
  }
  return { companyId: null, contactId: null, leadId: null };
}

/* ---------------- форма сайта ---------------- */

export async function findEnabledCaseForm(db: Db, secret: string) {
  const [f] = await db.select().from(caseForms).where(and(eq(caseForms.token, secret), eq(caseForms.enabled, true))).limit(1);
  return f ?? null;
}

export interface CaseFormSubmission {
  name?: string | undefined;
  email?: string | undefined;
  phone?: string | undefined;
  company?: string | undefined;
  subject?: string | undefined;
  message?: string | undefined;
  priority?: CasePriority | undefined;
}

/** Обращение с формы сайта: клиент по адресу или телефону (иначе лид), ответственный формы или по кругу */
export async function submitCaseForm(db: Db, workspaceId: string, form: { id: string; name: string; defaultOwnerId: string | null }, b: CaseFormSubmission): Promise<CaseRow> {
  const ctx: CaseCtx = { workspaceId, memberId: null };
  const who = await resolveRequester(db, ctx, { email: b.email, phone: b.phone, name: b.name, company: b.company, source: form.name }, true);
  const subject = b.subject?.trim() || b.message?.trim().split('\n')[0]?.slice(0, 120) || b.name?.trim() || b.email || b.phone || 'Request';
  const description = [b.message?.trim(), [b.name?.trim(), b.email?.trim(), normalizePhone(b.phone) || b.phone?.trim()].filter(Boolean).join(', ')].filter(Boolean).join('\n\n');
  return insertCase(db, ctx, { subject, description, priority: b.priority, channel: 'web_form', ...who, defaultOwnerId: form.defaultOwnerId, formId: form.id });
}

/* ---------------- заказ-наряд ---------------- */

/** Заказ-наряд из обращения: контрагент и описание из обращения, связь в обе стороны (cases.work_order_id и documents.case_id) */
export async function createWorkOrderFromCase(db: Db, ctx: CaseCtx, caseId: string): Promise<{ caseRow: CaseRow; documentId: string }> {
  const c = await loadCase(db, caseId, true);
  if (c.status === 'closed') throw new DomainError(409, 'case_closed', 'A closed case cannot be edited');
  if (c.workOrderId) throw new DomainError(409, 'case_work_order_exists', 'A work order has already been created from this case');
  if (!c.companyId) throw new DomainError(422, 'case_company_required', 'Select a company in the case before creating a work order');
  const dctx: DocCtx = { workspaceId: ctx.workspaceId, memberId: ctx.memberId, ...(ctx.role ? { role: ctx.role } : {}) };
  const documentId = await createDocument(db, dctx, { type: 'work_order', counterpartyId: c.companyId, ...(c.dealId ? { dealId: c.dealId } : {}), comment: `${c.number}: ${c.subject}${c.description ? `\n\n${c.description}` : ''}` });
  await db.update(documents).set({ caseId }).where(eq(documents.id, documentId));
  const [row] = await db.update(cases).set({ workOrderId: documentId, updatedAt: new Date() }).where(eq(cases.id, caseId)).returning();
  await db.insert(crmActivities).values({ workspaceId: ctx.workspaceId, type: 'note', subject: `Work order created from case ${c.number}`, caseId, companyId: c.companyId, contactId: c.contactId, authorId: ctx.memberId, system: true });
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'case.updated', entity: 'case', recordId: caseId, actorId: ctx.memberId, payload: withVia(ctx, { changes: { workOrderId: { from: null, to: documentId } } }) });
  return { caseRow: row!, documentId };
}

/* ---------------- просрочка SLA ---------------- */

/** Проход воркера: просроченные открытые обращения получают отметку и событие case.sla_breached (kind: first_response | resolve)
    ровно один раз на каждый срок; ответственный получает уведомление. Идемпотентно: отметка ставится в той же транзакции. Возвращает число объявленных нарушений */
export async function scanCaseSla(db: Db, workspaceId: string, at: Date = new Date()): Promise<number> {
  const open = inArray(cases.status, ['new', 'in_progress', 'waiting']);
  let n = 0;
  const first = await db
    .select()
    .from(cases)
    .where(and(eq(cases.workspaceId, workspaceId), open, isNull(cases.firstRespondedAt), isNull(cases.firstResponseBreachedAt), lt(cases.firstResponseDueAt, at)))
    .orderBy(asc(cases.createdAt))
    .for('update', { skipLocked: true });
  for (const c of first) {
    await db.update(cases).set({ firstResponseBreachedAt: at }).where(eq(cases.id, c.id));
    await recordEvent(db, { workspaceId, type: 'case.sla_breached', entity: 'case', recordId: c.id, actorId: null, payload: { kind: 'first_response', dueAt: c.firstResponseDueAt?.toISOString() ?? null } });
    if (c.ownerId) await notifyCaseOwner(db, workspaceId, c, c.ownerId, `First response deadline missed: ${c.number} ${c.subject}`);
    n++;
  }
  const resolve = await db
    .select()
    .from(cases)
    .where(and(eq(cases.workspaceId, workspaceId), open, isNull(cases.resolvedAt), isNull(cases.resolveBreachedAt), lt(cases.resolveDueAt, at)))
    .orderBy(asc(cases.createdAt))
    .for('update', { skipLocked: true });
  for (const c of resolve) {
    await db.update(cases).set({ resolveBreachedAt: at }).where(eq(cases.id, c.id));
    await recordEvent(db, { workspaceId, type: 'case.sla_breached', entity: 'case', recordId: c.id, actorId: null, payload: { kind: 'resolve', dueAt: c.resolveDueAt?.toISOString() ?? null } });
    if (c.ownerId) await notifyCaseOwner(db, workspaceId, c, c.ownerId, `Resolution deadline missed: ${c.number} ${c.subject}`);
    n++;
  }
  return n;
}

/* ---------------- счётчики ---------------- */

/** «Просрочено» и «новые» для плашек списка: открытое обращение с нарушенным сроком, который ещё не закрыт ответом/решением */
export async function caseCounts(db: Db, at: Date = new Date()): Promise<{ new: number; open: number; overdue: number }> {
  const [r] = await db
    .select({
      new: sql<number>`count(*) filter (where ${cases.status} = 'new')::int`,
      open: sql<number>`count(*) filter (where ${cases.status} in ('new','in_progress','waiting'))::int`,
      overdue: sql<number>`count(*) filter (where ${cases.status} in ('new','in_progress','waiting') and ((${cases.firstRespondedAt} is null and ${cases.firstResponseDueAt} < ${at}) or (${cases.resolvedAt} is null and ${cases.resolveDueAt} < ${at})))::int`,
    })
    .from(cases);
  return { new: r?.new ?? 0, open: r?.open ?? 0, overdue: r?.overdue ?? 0 };
}
