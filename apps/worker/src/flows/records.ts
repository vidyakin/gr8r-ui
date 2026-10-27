/* Действия flow над данными. Все функции принимают `db` транзакции арендатора (роль app_user + app.workspace_id), поэтому
   RLS действует и здесь; фильтр по workspace_id в запросах — дополнительный пояс безопасности. Каждое изменение пишет событие
   в outbox с меткой `via` (какой flow его породил): по ней движок не даёт flow запустить сам себя. */
import { and, eq, max, sql } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import {
  activity,
  comments,
  companies,
  contacts,
  crmActivities,
  deals,
  documents,
  entities,
  fields,
  isUuid,
  leads,
  members,
  notifications,
  products,
  projects,
  recordEvent,
  records,
  statuses,
  tasks,
  assignLead as assignLeadService,
  insertLead,
  type Db,
} from '@gr8r/db';
import { BUILTIN_FIELDS, buildRecordSchema, type EventVia, type FieldDef, type FieldType } from '@gr8r/shared';

type AnyTable = PgTable & { id: PgColumn; workspaceId: PgColumn };
const SYSTEM_TABLES: Record<string, AnyTable> = {
  task: tasks as unknown as AnyTable,
  project: projects as unknown as AnyTable,
  deal: deals as unknown as AnyTable,
  company: companies as unknown as AnyTable,
  contact: contacts as unknown as AnyTable,
  product: products as unknown as AnyTable,
  lead: leads as unknown as AnyTable,
  document: documents as unknown as AnyTable,
};
type Row = Record<string, unknown>;

/** Колонки, которые допускают NULL (остальные при очистке получают '' или отклоняют пустое значение) */
const NULLABLE: Record<string, string[]> = {
  task: ['assigneeId', 'priority', 'dueDate', 'startDate'],
  project: ['leadId', 'dueDate', 'startDate'],
  deal: ['ownerId', 'companyId', 'closeDate', 'lostReason'],
  company: ['ownerId'],
  contact: ['ownerId', 'companyId'],
  product: [],
  lead: ['ownerId'],
};
const NEVER_EMPTY = new Set(['title', 'name', 'status', 'stage', 'amount', 'price', 'purchasePrice', 'currency']);

const json = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export const assertUuid = (v: unknown, what: string): string => {
  if (!isUuid(v)) throw new Error(`${what} is not a valid ID: "${String(v ?? '').slice(0, 60)}"`);
  return v.toLowerCase();
};

/* ---------------- чтение ---------------- */

/** Запись для контекста подстановок: системная — строка таблицы, пользовательская — id + значения полей на верхнем уровне */
export async function loadRecord(db: Db, ws: string, entity: string, id: string): Promise<Row | null> {
  if (!isUuid(id)) return null;
  const t = SYSTEM_TABLES[entity];
  if (t) {
    const [row] = await db.select().from(t).where(and(eq(t.workspaceId, ws), eq(t.id, id))).limit(1);
    return row ? json(row as Row) : null;
  }
  const [e] = await db.select({ id: entities.id }).from(entities).where(and(eq(entities.workspaceId, ws), eq(entities.key, entity))).limit(1);
  if (!e) return null;
  const [r] = await db.select().from(records).where(and(eq(records.workspaceId, ws), eq(records.entityId, e.id), eq(records.id, id))).limit(1);
  return r ? json({ id: r.id, ...r.data, createdAt: r.createdAt, updatedAt: r.updatedAt, archivedAt: r.archivedAt }) : null;
}

/** Проект задачи (для «владельца проекта» в шаблонах) */
export async function loadProjectOf(db: Db, ws: string, task: Row | null): Promise<Row | null> {
  return task && isUuid(task.projectId) ? loadRecord(db, ws, 'project', task.projectId) : null;
}

/* ---------------- значения ---------------- */

const TRUE = new Set(['true', '1', 'yes', 'y', 'on']);
const FALSE = new Set(['false', '0', 'no', 'n', 'off']);

/** Значение из подставленной строки → значение поля по его типу и схеме конструктора (null — очистить) */
export function coerceFieldValue(def: Pick<FieldDef, 'key' | 'name' | 'type' | 'options'>, value: unknown): unknown {
  let v: unknown = typeof value === 'string' && value.trim() === '' ? null : value;
  if (typeof v === 'string') {
    if (def.type === 'boolean') {
      const s = v.trim().toLowerCase();
      v = TRUE.has(s) ? true : FALSE.has(s) ? false : v;
    } else if (def.type === 'multi_select' || def.type === 'refs') {
      const s = v.trim();
      v = s.startsWith('[') ? safeJson(s, v) : s.split(',').map(x => x.trim()).filter(Boolean);
    }
  }
  const parsed = buildRecordSchema([{ key: def.key, name: def.name, type: def.type, required: false, options: def.options }], 'patch').safeParse({ [def.key]: v });
  if (!parsed.success) throw new Error(`${def.name}: ${parsed.error.issues[0]?.message ?? 'invalid value'}`);
  return (parsed.data as Row)[def.key] ?? null;
}

const safeJson = (s: string, fallback: unknown) => {
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
};

async function assertMember(db: Db, ws: string, id: string, label: string) {
  assertUuid(id, label);
  const [m] = await db.select({ id: members.id }).from(members).where(and(eq(members.workspaceId, ws), eq(members.id, id))).limit(1);
  if (!m) throw new Error(`${label}: member not found`);
}

async function assertStatus(db: Db, ws: string, key: string) {
  const [s] = await db.select({ key: statuses.key }).from(statuses).where(and(eq(statuses.workspaceId, ws), eq(statuses.key, key))).limit(1);
  if (!s) throw new Error(`Status "${key}" does not exist`);
}

/* ---------------- изменение поля ---------------- */

interface Target {
  name: string;
  type: FieldType;
  key: string;
  options: FieldDef['options'];
  /** Пользовательское поле (лежит в custom / data) */
  custom: boolean;
  unique?: boolean;
}

async function resolveTarget(db: Db, ws: string, entity: string, field: string): Promise<Target> {
  const builtin = BUILTIN_FIELDS[entity]?.find(f => f.key === field);
  if (builtin) {
    if (!builtin.writable) throw new Error(`Field "${builtin.name}" of ${entity} cannot be changed by automations`);
    return { name: builtin.name, type: builtin.type, key: field, options: builtin.options ?? {}, custom: false };
  }
  const [row] = await db
    .select({ name: fields.name, type: fields.type, options: fields.options, unique: fields.unique, archivedAt: fields.archivedAt })
    .from(fields)
    .innerJoin(entities, eq(entities.id, fields.entityId))
    .where(and(eq(fields.workspaceId, ws), eq(entities.key, entity), eq(fields.key, field)))
    .limit(1);
  if (!row || row.archivedAt) throw new Error(`Unknown field "${field}" of ${entity}`);
  return { name: row.name, type: row.type as FieldType, key: field, options: row.options, custom: true, unique: row.unique };
}

export async function updateField(db: Db, ws: string, via: EventVia, a: { entity: string; recordId: string; field: string; value: unknown }): Promise<{ changed: boolean; before: unknown; after: unknown }> {
  const id = assertUuid(a.recordId, 'Record ID');
  const target = await resolveTarget(db, ws, a.entity, a.field);
  let value = coerceFieldValue(target, a.value);
  if (target.key === 'priority' && !target.custom && value !== null && !Number.isInteger(value)) throw new Error('Priority must be a whole number');
  if (!target.custom && target.type === 'user' && value !== null) await assertMember(db, ws, String(value), target.name);
  if (!target.custom && a.entity === 'task' && target.key === 'status' && value !== null) await assertStatus(db, ws, String(value));

  const sys = SYSTEM_TABLES[a.entity];
  if (sys) {
    const [row] = (await db.select().from(sys).where(and(eq(sys.workspaceId, ws), eq(sys.id, id))).limit(1).for('update')) as Row[];
    if (!row) throw new Error(`${a.entity} ${id} not found`);
    const patch: Row = {};
    let before: unknown;
    if (target.custom) {
      const custom = { ...((row.custom as Row) ?? {}) };
      before = custom[a.field];
      if (value === null) delete custom[a.field];
      else custom[a.field] = value;
      if (target.unique && value !== null) await assertUnique(db, tableName(a.entity), null, a.field, String(value), id);
      patch.custom = custom;
    } else {
      before = row[a.field];
      if (value === null && !(NULLABLE[a.entity] ?? []).includes(a.field)) {
        if (NEVER_EMPTY.has(a.field) || (target.type !== 'text' && target.type !== 'long_text')) throw new Error(`${target.name} cannot be empty`);
        value = '';
      }
      patch[a.field] = value;
    }
    if ((target.custom && before === undefined && value === null) || same(before, value)) return { changed: false, before: before ?? null, after: value };
    if (a.entity === 'task' && a.field === 'status') {
      patch.prevStatus = row.status;
      patch.completedAt = value === 'done' ? new Date() : null;
    }
    if (a.entity === 'deal' && a.field === 'stage') {
      const closed = value === 'won' || value === 'lost';
      patch.closedAt = closed ? new Date().toISOString().slice(0, 10) : null;
      if (!closed) patch.lostReason = null;
    }
    if ('updatedAt' in row) patch.updatedAt = new Date();
    const [after] = (await db.update(sys).set(patch as never).where(and(eq(sys.workspaceId, ws), eq(sys.id, id))).returning()) as Row[];
    const changes: Row = {};
    for (const k of Object.keys(after!)) if (k !== 'updatedAt' && !same(row[k], after![k])) changes[k] = { from: json(row[k] ?? null), to: json(after![k] ?? null) };
    if (Object.keys(changes).length) await recordEvent(db, { workspaceId: ws, type: `${a.entity}.updated`, entity: a.entity, recordId: id, actorId: null, payload: { changes, via } });
    if (a.entity === 'deal' && a.field === 'stage') {
      await db.insert(crmActivities).values({ workspaceId: ws, type: 'note', subject: `Stage changed: ${String(row.stage)} → ${String(after!.stage)}`, dealId: id, companyId: (after!.companyId as string | null) ?? null, authorId: null, system: true });
    }
    return { changed: true, before: before ?? null, after: value };
  }

  // Запись пользовательской сущности
  const [e] = await db.select({ id: entities.id }).from(entities).where(and(eq(entities.workspaceId, ws), eq(entities.key, a.entity))).limit(1);
  if (!e) throw new Error(`Unknown entity "${a.entity}"`);
  const [rec] = await db.select().from(records).where(and(eq(records.workspaceId, ws), eq(records.entityId, e.id), eq(records.id, id))).limit(1).for('update');
  if (!rec) throw new Error(`${a.entity} record ${id} not found`);
  const before = rec.data[a.field];
  if ((before === undefined && value === null) || same(before, value)) return { changed: false, before: before ?? null, after: value };
  const data = { ...rec.data };
  if (value === null) delete data[a.field];
  else data[a.field] = value;
  if (target.unique && value !== null) await assertUnique(db, null, e.id, a.field, String(value), id);
  await db.update(records).set({ data, updatedAt: new Date() }).where(and(eq(records.workspaceId, ws), eq(records.id, id)));
  await recordEvent(db, { workspaceId: ws, type: 'record.updated', entity: 'record', recordId: id, actorId: null, payload: { entityKey: a.entity, changes: { [a.field]: { from: before ?? null, to: value } }, via } });
  return { changed: true, before: before ?? null, after: value };
}

const TABLE_NAMES: Record<string, string> = { task: 'tasks', project: 'projects', deal: 'deals', company: 'companies', contact: 'contacts', product: 'products' };
const tableName = (entity: string) => {
  const t = TABLE_NAMES[entity];
  if (!t) throw new Error(`Entity "${entity}" has no custom fields`);
  return t;
};

/** Поле с флагом unique: значение не должно повторяться среди записей той же сущности (имя таблицы — из белого списка) */
async function assertUnique(db: Db, table: string | null, entityId: string | null, key: string, value: string, selfId: string) {
  const rows = table
    ? await db.execute(sql`select 1 from ${sql.raw(table)} where custom->>${key} = ${value} and id <> ${selfId} limit 1`)
    : await db.execute(sql`select 1 from records where entity_id = ${entityId} and data->>${key} = ${value} and id <> ${selfId} limit 1`);
  if (rows.length) throw new Error('This value is already used by another record (the field must be unique)');
}

/* ---------------- задачи, комментарии, уведомления ---------------- */

export async function createTask(
  db: Db,
  ws: string,
  via: EventVia,
  createdBy: string | null,
  a: { projectId: string; title: string; description?: string; assigneeId?: string | null; priority?: number | null; status?: string; dueDate?: string | null },
): Promise<{ id: string; key: string }> {
  const projectId = assertUuid(a.projectId, 'Project');
  if (!a.title.trim()) throw new Error('Task title is empty');
  const status = a.status || 'todo';
  await assertStatus(db, ws, status);
  if (a.assigneeId) await assertMember(db, ws, a.assigneeId, 'Assignee');
  if (a.dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(a.dueDate)) throw new Error('Due date must be YYYY-MM-DD');
  const [p] = await db
    .update(projects)
    .set({ taskCounter: sql`${projects.taskCounter} + 1`, lastActivityAt: new Date() })
    .where(and(eq(projects.workspaceId, ws), eq(projects.id, projectId)))
    .returning({ key: projects.key, n: projects.taskCounter });
  if (!p) throw new Error('Project not found');
  const [m] = await db.select({ m: max(tasks.sortOrder) }).from(tasks).where(and(eq(tasks.workspaceId, ws), eq(tasks.projectId, projectId)));
  const [row] = await db
    .insert(tasks)
    .values({
      workspaceId: ws,
      key: `${p.key}-${p.n}`,
      projectId,
      title: a.title.trim(),
      description: a.description ?? '',
      status,
      assigneeId: a.assigneeId || null,
      priority: a.priority ?? null,
      dueDate: a.dueDate || null,
      sortOrder: Number(m?.m ?? 0) + 1,
      createdBy,
      completedAt: status === 'done' ? new Date() : null,
    })
    .returning();
  await recordEvent(db, { workspaceId: ws, type: 'task.created', entity: 'task', recordId: row!.id, actorId: null, payload: { record: json(row!), via } });
  await db.insert(activity).values({ workspaceId: ws, actorId: createdBy, verb: 'created', taskId: row!.id, projectId, extra: 'by automation' });
  if (row!.assigneeId) await insertNotification(db, ws, { memberId: row!.assigneeId, type: 'assign', text: 'assigned you', snippet: row!.title, taskId: row!.id, projectId });
  return { id: row!.id, key: row!.key };
}

export async function addComment(db: Db, ws: string, via: EventVia, author: string | null, a: { entity: string; recordId: string; body: string }): Promise<{ id: string }> {
  const id = assertUuid(a.recordId, 'Record ID');
  if (!author) throw new Error('The flow has no author to write comments on behalf of');
  if (!a.body.trim()) throw new Error('Comment is empty');
  if (a.entity === 'task') {
    const [t] = await db.select({ id: tasks.id, projectId: tasks.projectId, assigneeId: tasks.assigneeId }).from(tasks).where(and(eq(tasks.workspaceId, ws), eq(tasks.id, id))).limit(1);
    if (!t) throw new Error(`task ${id} not found`);
    const [c] = await db.insert(comments).values({ workspaceId: ws, taskId: id, authorId: author, body: a.body }).returning();
    await recordEvent(db, { workspaceId: ws, type: 'comment.created', entity: 'comment', recordId: c!.id, actorId: null, payload: { record: json(c!), via } });
    await db.insert(activity).values({ workspaceId: ws, actorId: author, verb: 'commented on', taskId: id, projectId: t.projectId, extra: 'by automation' });
    if (t.assigneeId && t.assigneeId !== author) await insertNotification(db, ws, { memberId: t.assigneeId, type: 'comment', text: 'commented on', snippet: a.body.slice(0, 140), taskId: id, projectId: t.projectId });
    return { id: c!.id };
  }
  if (a.entity === 'deal') {
    const [d] = await db.select({ id: deals.id, companyId: deals.companyId }).from(deals).where(and(eq(deals.workspaceId, ws), eq(deals.id, id))).limit(1);
    if (!d) throw new Error(`deal ${id} not found`);
    const [c] = await db.insert(crmActivities).values({ workspaceId: ws, type: 'note', subject: a.body.slice(0, 120), body: a.body, dealId: id, companyId: d.companyId, authorId: author }).returning();
    await recordEvent(db, { workspaceId: ws, type: 'crm_activity.created', entity: 'crm_activity', recordId: c!.id, actorId: null, payload: { record: json(c!), via } });
    return { id: c!.id };
  }
  throw new Error(`Comments are not supported for ${a.entity}`);
}

async function insertNotification(db: Db, ws: string, n: { memberId: string; type: 'assign' | 'comment' | 'update'; text: string; snippet?: string; taskId?: string | null; projectId?: string | null }) {
  const [row] = await db
    .insert(notifications)
    .values({ workspaceId: ws, recipientId: n.memberId, type: n.type, actorId: null, taskId: n.taskId ?? null, projectId: n.projectId ?? null, text: n.text, snippet: n.snippet ?? '' })
    .returning({ id: notifications.id });
  return row!.id;
}

export async function notifyMember(db: Db, ws: string, via: EventVia, a: { memberId: string; text: string; snippet?: string; taskId?: string | null; projectId?: string | null }): Promise<{ id: string }> {
  await assertMember(db, ws, a.memberId, 'Recipient');
  let projectId = a.projectId ?? null;
  let taskId = a.taskId ?? null;
  if (taskId) {
    assertUuid(taskId, 'Task');
    const [t] = await db.select({ projectId: tasks.projectId }).from(tasks).where(and(eq(tasks.workspaceId, ws), eq(tasks.id, taskId))).limit(1);
    if (!t) taskId = null;
    else projectId ??= t.projectId;
  }
  const id = await insertNotification(db, ws, { memberId: a.memberId, type: 'update', text: a.text, snippet: a.snippet, taskId, projectId });
  await recordEvent(db, { workspaceId: ws, type: 'notification.created', entity: 'notification', recordId: id, actorId: null, payload: { recipientId: a.memberId, via } });
  return { id };
}

/* ---------------- лиды (задача 1175) ---------------- */

export async function createLead(
  db: Db,
  ws: string,
  via: EventVia,
  a: { name: string; companyName?: string; phone?: string; email?: string; comment?: string; source?: string; ownerId?: string | null },
): Promise<{ id: string }> {
  if (!a.name.trim()) throw new Error('Lead name is empty');
  if (a.ownerId) await assertMember(db, ws, a.ownerId, 'Owner');
  const row = await insertLead(db, { workspaceId: ws, memberId: null, via: via as unknown as Record<string, unknown> }, { ...a, name: a.name, ownerId: a.ownerId || null });
  return { id: row.id };
}

export async function assignLead(db: Db, ws: string, via: EventVia, a: { leadId: string; mode: 'manual' | 'round_robin'; memberId?: string | null }): Promise<{ ownerId: string | null; changed: boolean }> {
  const leadId = assertUuid(a.leadId, 'Lead');
  if (a.memberId) assertUuid(a.memberId, 'Member');
  return assignLeadService(db, { workspaceId: ws, memberId: null, via: via as unknown as Record<string, unknown> }, leadId, a.mode, a.memberId);
}
