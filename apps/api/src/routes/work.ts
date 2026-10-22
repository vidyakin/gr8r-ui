/* REST-ресурсы этапа 1: проекты, статусы, задачи, комментарии, учёт времени, уведомления, участники, команды, виды, календарь, файлы, активность, события. */
import { zValidator } from '@hono/zod-validator';
import { and, eq, gte, inArray, isNull, lte, sql as dsql } from 'drizzle-orm';
import {
  activity,
  calendarEvents,
  commentReactions,
  comments,
  events,
  files,
  issueTaskKey as issueTaskKeyInDb,
  members,
  notifications,
  projectMembers,
  projects,
  recordEvent,
  savedViews,
  statuses,
  tasks,
  teams,
  timeLogs,
} from '@gr8r/db';
import {
  activityQuery,
  calendarEventCreate,
  calendarEventQuery,
  calendarEventUpdate,
  commentCreate,
  commentQuery,
  commentUpdate,
  fileCreate,
  fileQuery,
  fileUpdate,
  idParam,
  listQuery,
  memberQuery,
  memberUpdate,
  notificationQuery,
  notificationUpdate,
  projectCreate,
  projectQuery,
  projectUpdate,
  reactionBody,
  savedViewCreate,
  savedViewQuery,
  savedViewUpdate,
  statusCreate,
  statusQuery,
  statusUpdate,
  taskCreate,
  taskQuery,
  taskUpdate,
  teamCreate,
  teamQuery,
  teamUpdate,
  timeLogCreate,
  timeLogQuery,
  timeLogUpdate,
  uuid,
} from '@gr8r/shared';
import { z } from 'zod';
import { crud, ctxOf, validationHook } from '../crud';
import { AppError, forbidden, notFound } from '../errors';
import { hasRole } from '../middleware';
import { customForCreate, customForUpdate } from '../meta/service';
import { addActivity, assertTasksExist, nextOrder, notify } from './helpers';

/* ============================== projects ============================== */
export const projectRoutes = crud({
  entity: 'project',
  table: projects,
  create: projectCreate,
  update: projectUpdate,
  query: projectQuery,
  sortable: { name: projects.name, key: projects.key, status: projects.status, dueDate: projects.dueDate, startDate: projects.startDate, sortOrder: projects.sortOrder, createdAt: projects.createdAt, updatedAt: projects.updatedAt, lastActivityAt: projects.lastActivityAt },
  defaultSort: 'sortOrder',
  search: [projects.name, projects.key, projects.description],
  filters: q => [q.status ? eq(projects.status, q.status) : undefined, q.teamId ? eq(projects.teamId, q.teamId) : undefined, q.leadId ? eq(projects.leadId, q.leadId) : undefined, q.fav != null ? eq(projects.fav, q.fav) : undefined, q.module ? eq(projects.module, q.module) : undefined],
  prepareCreate: async (ctx, body) => ({ sortOrder: body.sortOrder ?? (await nextOrder(ctx, projects)), ...(await customForCreate(ctx, 'project', body.custom)) }),
  prepareUpdate: (ctx, existing, body) => customForUpdate(ctx, 'project', existing.custom, body.custom, existing.id),
  afterCreate: async (ctx, row, body) => {
    await setProjectMembers(ctx, row.id, body.members ?? [{ memberId: ctx.memberId, permission: 'admin' }]);
    await addActivity(ctx, { verb: 'created project', projectId: row.id });
  },
  afterUpdate: async (ctx, before, after, body) => {
    if (body.members) {
      await setProjectMembers(ctx, after.id, body.members);
      await recordEvent(ctx.db, { workspaceId: ctx.workspaceId, type: 'project.members_changed', entity: 'project', recordId: after.id, actorId: ctx.memberId, payload: { members: body.members } });
    }
    if (before.status !== after.status) await addActivity(ctx, { verb: 'changed status of project', projectId: after.id, extra: `to ${after.status}` });
  },
  // системный проект модуля — часть инфраструктуры: его нельзя удалить или в архив (в нём лежат задачи модуля)
  beforeDelete: (_ctx, row) => {
    if (row.module !== 'general') throw new AppError(422, 'module_project_protected', 'A module project cannot be deleted or archived');
  },
  decorate: async (ctx, rows) => {
    if (!rows.length) return [];
    const pm = await ctx.db.select({ projectId: projectMembers.projectId, memberId: projectMembers.memberId, permission: projectMembers.permission }).from(projectMembers).where(inArray(projectMembers.projectId, rows.map(r => r.id)));
    return rows.map(r => ({ ...r, members: pm.filter(m => m.projectId === r.id).map(({ memberId, permission }) => ({ memberId, permission })) }));
  },
});

async function setProjectMembers(ctx: ReturnType<typeof ctxOf>, projectId: string, list: { memberId: string; permission: string }[]) {
  await ctx.db.delete(projectMembers).where(eq(projectMembers.projectId, projectId));
  const uniq = [...new Map(list.map(m => [m.memberId, m])).values()];
  if (uniq.length) await ctx.db.insert(projectMembers).values(uniq.map(m => ({ workspaceId: ctx.workspaceId, projectId, memberId: m.memberId, permission: m.permission })));
}

/* ============================== statuses ============================== */
export const statusRoutes = crud({
  entity: 'status',
  table: statuses,
  create: statusCreate,
  update: statusUpdate,
  query: statusQuery,
  sortable: { sortOrder: statuses.sortOrder, name: statuses.name, key: statuses.key, createdAt: statuses.createdAt },
  defaultSort: 'sortOrder',
  search: [statuses.name, statuses.key],
  writeRole: 'admin',
  prepareCreate: async (ctx, body) => ({ sortOrder: body.sortOrder ?? (await nextOrder(ctx, statuses)) }),
  prepareUpdate: (_ctx, existing, body) => {
    if (existing.builtin && body.name !== undefined && body.name !== existing.name) throw new AppError(422, 'builtin_status', 'Built-in statuses cannot be renamed');
    return {};
  },
  beforeDelete: (_ctx, row) => {
    if (row.builtin) throw new AppError(422, 'builtin_status', 'Built-in statuses cannot be deleted');
  },
});

/* ============================== tasks ============================== */
/** Модуль проекта: задача наследует модуль проекта, поэтому указанный клиентом модуль должен совпадать с ним */
async function projectModuleOf(ctx: ReturnType<typeof ctxOf>, projectId: string) {
  const [p] = await ctx.db.select({ module: projects.module }).from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!p) throw new AppError(422, 'invalid_reference', 'Project not found');
  return p.module;
}
/** Ключ задачи WEB-109: атомарно увеличиваем счётчик проекта (строка заблокирована до конца транзакции).
    `restoreKey` — прежний ключ при повторном создании (Undo удаления): должен принадлежать этому проекту; счётчик не уменьшается. */
async function issueTaskKey(ctx: ReturnType<typeof ctxOf>, projectId: string, restoreKey?: string): Promise<string> {
  if (restoreKey) {
    const [p] = await ctx.db.select({ key: projects.key, n: projects.taskCounter }).from(projects).where(eq(projects.id, projectId)).for('update').limit(1);
    if (!p) throw new AppError(422, 'invalid_reference', 'Project not found');
    const cut = restoreKey.lastIndexOf('-');
    if (restoreKey.slice(0, cut) !== p.key.toUpperCase()) throw new AppError(422, 'invalid_key', `Task key must start with ${p.key}-`);
    const [taken] = await ctx.db.select({ id: tasks.id }).from(tasks).where(eq(tasks.key, restoreKey)).limit(1);
    if (taken) throw new AppError(409, 'conflict', 'A task with this key already exists');
    const num = Number(restoreKey.slice(cut + 1));
    if (num > p.n) await ctx.db.update(projects).set({ taskCounter: num }).where(eq(projects.id, projectId));
    return restoreKey;
  }
  return issueTaskKeyInDb(ctx.db, projectId);
}

export const taskRoutes = crud({
  entity: 'task',
  table: tasks,
  create: taskCreate,
  update: taskUpdate,
  query: taskQuery,
  sortable: { createdAt: tasks.createdAt, updatedAt: tasks.updatedAt, title: tasks.title, key: tasks.key, status: tasks.status, priority: tasks.priority, dueDate: tasks.dueDate, startDate: tasks.startDate, sortOrder: tasks.sortOrder },
  defaultSort: 'sortOrder',
  search: [tasks.title, tasks.key, tasks.description],
  filters: q => [
    q.projectId ? eq(tasks.projectId, q.projectId) : undefined,
    q.module ? eq(tasks.module, q.module) : undefined,
    q.status ? eq(tasks.status, q.status) : undefined,
    q.assigneeId === 'none' ? isNull(tasks.assigneeId) : q.assigneeId ? eq(tasks.assigneeId, q.assigneeId) : undefined,
    q.priority ? eq(tasks.priority, q.priority) : undefined,
    q.label ? dsql`${q.label} = any(${tasks.labels})` : undefined,
    q.dueFrom ? gte(tasks.dueDate, q.dueFrom) : undefined,
    q.dueTo ? lte(tasks.dueDate, q.dueTo) : undefined,
    q.fav != null ? eq(tasks.fav, q.fav) : undefined,
  ],
  prepareCreate: async (ctx, body) => {
    await assertTasksExist(ctx, body.deps);
    const key = await issueTaskKey(ctx, body.projectId, body.key);
    const module = await projectModuleOf(ctx, body.projectId);
    if (body.module && body.module !== module) throw new AppError(422, 'module_mismatch', 'A task must be in a project of the same module');
    return {
      key,
      module,
      sortOrder: body.sortOrder ?? (await nextOrder(ctx, tasks, eq(tasks.projectId, body.projectId))),
      createdBy: ctx.memberId,
      completedAt: body.status === 'done' ? new Date() : null,
      ...(await customForCreate(ctx, 'task', body.custom)),
    };
  },
  afterCreate: async (ctx, row) => {
    await addActivity(ctx, { verb: 'created', taskId: row.id, projectId: row.projectId });
    await notify(ctx, { to: row.assigneeId, type: 'assign', text: 'assigned you', snippet: row.title, taskId: row.id, projectId: row.projectId });
  },
  prepareUpdate: async (ctx, existing, body) => {
    const patch: Record<string, unknown> = { ...(await customForUpdate(ctx, 'task', existing.custom, body.custom, existing.id)) };
    if (body.deps) {
      if (body.deps.includes(existing.id)) throw new AppError(422, 'invalid_dependency', 'A task cannot depend on itself');
      await assertTasksExist(ctx, body.deps);
    }
    // Перенос в другой проект: задача получает новый ключ по счётчику целевого проекта и его модуль
    if (body.projectId && body.projectId !== existing.projectId) {
      patch.key = await issueTaskKey(ctx, body.projectId);
      patch.module = await projectModuleOf(ctx, body.projectId);
    }
    if (body.module !== undefined && body.module !== (patch.module ?? existing.module)) throw new AppError(422, 'module_mismatch', 'A task must be in a project of the same module');
    if (body.status && body.status !== existing.status) {
      patch.prevStatus = existing.status;
      patch.completedAt = body.status === 'done' ? new Date() : null;
    }
    return patch;
  },
  afterUpdate: async (ctx, before, after) => {
    if (before.projectId !== after.projectId) await addActivity(ctx, { verb: 'moved', taskId: after.id, projectId: after.projectId, extra: `from ${before.key} to ${after.key}` });
    if (before.status !== after.status) {
      const [st] = await ctx.db.select({ name: statuses.name }).from(statuses).where(eq(statuses.key, after.status)).limit(1);
      await addActivity(ctx, after.status === 'done' ? { verb: 'completed', taskId: after.id, projectId: after.projectId } : { verb: 'moved', taskId: after.id, projectId: after.projectId, extra: `to ${st?.name ?? after.status}` });
      await notify(ctx, { to: after.assigneeId, type: 'update', text: after.status === 'done' ? 'completed' : `moved to ${st?.name ?? after.status}`, snippet: after.title, taskId: after.id, projectId: after.projectId });
    }
    if (before.assigneeId !== after.assigneeId && after.assigneeId) {
      await addActivity(ctx, { verb: 'assigned', taskId: after.id, projectId: after.projectId });
      await notify(ctx, { to: after.assigneeId, type: 'assign', text: 'assigned you', snippet: after.title, taskId: after.id, projectId: after.projectId });
    }
    if (before.priority !== after.priority) await addActivity(ctx, { verb: 'changed priority of', taskId: after.id, projectId: after.projectId, extra: `to ${after.priority ?? 'none'}` });
  },
});

/* ============================== comments ============================== */
const ownOrAdmin = (c: ReturnType<typeof ctxOf>, authorId: string) => {
  if (authorId !== c.memberId && !hasRole(c.c, 'admin')) throw forbidden('Only the author or an admin can change this record');
};

export const commentRoutes = crud({
  entity: 'comment',
  table: comments,
  create: commentCreate,
  update: commentUpdate,
  query: commentQuery,
  sortable: { createdAt: comments.createdAt, updatedAt: comments.updatedAt },
  defaultSort: 'createdAt',
  search: [comments.body],
  writeRole: 'guest', // комментировать могут все, включая гостей
  filters: q => [q.taskId ? eq(comments.taskId, q.taskId) : undefined, q.authorId ? eq(comments.authorId, q.authorId) : undefined],
  prepareCreate: ctx => ({ authorId: ctx.memberId }),
  afterCreate: async (ctx, row) => {
    const [t] = await ctx.db.select({ id: tasks.id, projectId: tasks.projectId, assigneeId: tasks.assigneeId }).from(tasks).where(eq(tasks.id, row.taskId)).limit(1);
    await addActivity(ctx, { verb: 'commented on', taskId: row.taskId, projectId: t?.projectId });
    await notify(ctx, { to: t?.assigneeId, type: 'comment', text: 'commented on', snippet: row.body.slice(0, 140), taskId: row.taskId, projectId: t?.projectId });
  },
  prepareUpdate: (ctx, existing) => {
    ownOrAdmin(ctx, existing.authorId);
    return {};
  },
  beforeDelete: (ctx, row) => ownOrAdmin(ctx, row.authorId),
  decorate: async (ctx, rows) => {
    if (!rows.length) return [];
    const rs = await ctx.db.select().from(commentReactions).where(inArray(commentReactions.commentId, rows.map(r => r.id)));
    return rows.map(r => {
      const re: Record<string, string[]> = {};
      for (const x of rs) if (x.commentId === r.id) (re[x.emoji] ??= []).push(x.memberId);
      return { ...r, re };
    });
  },
}).post('/:id/reactions', zValidator('param', idParam, validationHook), zValidator('json', reactionBody, validationHook), async c => {
  // Переключатель реакции текущего участника: есть — снимает, нет — ставит
  const ctx = ctxOf(c);
  const { id } = c.req.valid('param');
  const { emoji } = c.req.valid('json');
  const [cm] = await ctx.db.select().from(comments).where(eq(comments.id, id)).limit(1);
  if (!cm) throw notFound('comment');
  const mine = and(eq(commentReactions.commentId, id), eq(commentReactions.memberId, ctx.memberId), eq(commentReactions.emoji, emoji));
  const removed = await ctx.db.delete(commentReactions).where(mine).returning({ e: commentReactions.emoji });
  if (!removed.length) await ctx.db.insert(commentReactions).values({ workspaceId: ctx.workspaceId, commentId: id, memberId: ctx.memberId, emoji });
  await recordEvent(ctx.db, { workspaceId: ctx.workspaceId, type: 'comment.reacted', entity: 'comment', recordId: id, actorId: ctx.memberId, payload: { emoji, on: !removed.length } });
  const rs = await ctx.db.select().from(commentReactions).where(eq(commentReactions.commentId, id));
  const re: Record<string, string[]> = {};
  for (const x of rs) (re[x.emoji] ??= []).push(x.memberId);
  return c.json({ ...cm, re });
});

/* ============================== time logs ============================== */
export const timeLogRoutes = crud({
  entity: 'time_log',
  table: timeLogs,
  create: timeLogCreate,
  update: timeLogUpdate,
  query: timeLogQuery,
  sortable: { logDate: timeLogs.logDate, createdAt: timeLogs.createdAt, hours: timeLogs.hours },
  defaultSort: '-logDate',
  search: [timeLogs.note],
  filters: q => [q.taskId ? eq(timeLogs.taskId, q.taskId) : undefined, q.memberId ? eq(timeLogs.memberId, q.memberId) : undefined, q.from ? gte(timeLogs.logDate, q.from) : undefined, q.to ? lte(timeLogs.logDate, q.to) : undefined],
  prepareCreate: (ctx, body) => {
    if (body.memberId && body.memberId !== ctx.memberId && !hasRole(ctx.c, 'admin')) throw forbidden('Only an admin can log time for other members');
    return { memberId: body.memberId ?? ctx.memberId };
  },
  prepareUpdate: (ctx, existing) => {
    ownOrAdmin(ctx, existing.memberId);
    return {};
  },
  beforeDelete: (ctx, row) => ownOrAdmin(ctx, row.memberId),
});

/* ============================== notifications ============================== */
export const notificationRoutes = crud({
  entity: 'notification',
  table: notifications,
  create: notificationUpdate,
  update: notificationUpdate,
  query: notificationQuery,
  sortable: { createdAt: notifications.createdAt },
  defaultSort: '-createdAt',
  search: [notifications.text, notifications.snippet],
  writeRole: 'guest',
  disabled: ['create'], // уведомления создаёт сервер
  scope: ctx => eq(notifications.recipientId, ctx.memberId), // только свои
  filters: q => [q.read != null ? eq(notifications.read, q.read) : undefined, q.type ? eq(notifications.type, q.type) : undefined],
}).post('/read-all', async c => {
  const ctx = ctxOf(c);
  const rows = await ctx.db.update(notifications).set({ read: true }).where(and(eq(notifications.recipientId, ctx.memberId), eq(notifications.read, false))).returning({ id: notifications.id });
  if (rows.length) await recordEvent(ctx.db, { workspaceId: ctx.workspaceId, type: 'notification.read_all', entity: 'notification', actorId: ctx.memberId, payload: { count: rows.length } });
  return c.json({ updated: rows.length });
});

/* ============================== members / teams ============================== */
export const memberRoutes = crud({
  entity: 'member',
  table: members,
  create: memberUpdate, // создание отключено: участники появляются через приглашения
  update: memberUpdate,
  query: memberQuery,
  sortable: { name: members.name, title: members.title, createdAt: members.createdAt, lastSeenAt: members.lastSeenAt },
  defaultSort: 'name',
  search: [members.name, members.email, members.title],
  writeRole: 'guest', // править можно свой профиль; чужой и статус — admin (проверка в prepareUpdate)
  disabled: ['create', 'delete'],
  filters: q => [q.teamId ? eq(members.teamId, q.teamId) : undefined, q.status ? eq(members.status, q.status) : undefined, q.role ? eq(members.role, q.role) : undefined],
  prepareUpdate: (ctx, existing, body) => {
    const admin = hasRole(ctx.c, 'admin');
    if (existing.id !== ctx.memberId && !admin) throw forbidden('You can only edit your own profile');
    if ((body.status !== undefined || body.teamId !== undefined) && !admin) throw forbidden('Only an admin can change team or status');
    if (body.status === 'deactivated' && existing.role === 'owner') throw new AppError(422, 'owner_protected', 'An owner cannot be deactivated');
    return {};
  },
});

export const teamRoutes = crud({
  entity: 'team',
  table: teams,
  create: teamCreate,
  update: teamUpdate,
  query: teamQuery,
  sortable: { sortOrder: teams.sortOrder, name: teams.name, key: teams.key },
  defaultSort: 'sortOrder',
  search: [teams.name, teams.key],
  writeRole: 'admin',
  prepareCreate: async (ctx, body) => ({ sortOrder: body.sortOrder ?? (await nextOrder(ctx, teams)) }),
});

/* ============================== saved views / calendar / files / activity / events ============================== */
export const savedViewRoutes = crud({
  entity: 'saved_view',
  table: savedViews,
  create: savedViewCreate,
  update: savedViewUpdate,
  query: savedViewQuery,
  sortable: { createdAt: savedViews.createdAt, name: savedViews.name },
  defaultSort: 'createdAt',
  search: [savedViews.name],
  filters: q => [q.projectId ? eq(savedViews.projectId, q.projectId) : undefined],
  prepareCreate: ctx => ({ ownerId: ctx.memberId }),
});

export const calendarEventRoutes = crud({
  entity: 'calendar_event',
  table: calendarEvents,
  create: calendarEventCreate,
  update: calendarEventUpdate,
  query: calendarEventQuery,
  sortable: { eventDate: calendarEvents.eventDate, eventTime: calendarEvents.eventTime, title: calendarEvents.title },
  defaultSort: 'eventDate,eventTime',
  search: [calendarEvents.title],
  filters: q => [q.projectId ? eq(calendarEvents.projectId, q.projectId) : undefined, q.from ? gte(calendarEvents.eventDate, q.from) : undefined, q.to ? lte(calendarEvents.eventDate, q.to) : undefined],
  prepareCreate: ctx => ({ createdBy: ctx.memberId }),
});

export const fileRoutes = crud({
  entity: 'file',
  table: files,
  create: fileCreate,
  update: fileUpdate,
  query: fileQuery,
  sortable: { createdAt: files.createdAt, name: files.name, sizeBytes: files.sizeBytes },
  defaultSort: '-createdAt',
  search: [files.name],
  filters: q => [q.projectId ? eq(files.projectId, q.projectId) : undefined, q.taskId ? eq(files.taskId, q.taskId) : undefined],
  prepareCreate: ctx => ({ uploadedBy: ctx.memberId }),
});

/** Лента активности — только чтение (записи создаёт сервер при изменениях) */
export const activityRoutes = crud({
  entity: 'activity',
  table: activity,
  create: z.object({}),
  update: z.object({}),
  query: activityQuery,
  sortable: { createdAt: activity.createdAt },
  defaultSort: '-createdAt',
  search: [activity.verb, activity.extra],
  disabled: ['create', 'update', 'delete'],
  filters: q => [q.projectId ? eq(activity.projectId, q.projectId) : undefined, q.taskId ? eq(activity.taskId, q.taskId) : undefined, q.actorId ? eq(activity.actorId, q.actorId) : undefined],
});

/** Журнал событий (только чтение): `?since=<event id>` — догнать пропущенное после обрыва WebSocket (uuid v7 сортируется по времени) */
const eventQuery = listQuery.extend({ since: uuid.optional(), entity: z.string().max(64).optional(), type: z.string().max(64).optional(), recordId: uuid.optional() });
export const eventRoutes = crud({
  entity: 'event',
  table: events,
  create: z.object({}),
  update: z.object({}),
  query: eventQuery,
  sortable: { id: events.id, createdAt: events.createdAt },
  defaultSort: 'id',
  disabled: ['create', 'update', 'delete'],
  filters: q => [dsql`${events.id} > ${q.since ?? '00000000-0000-0000-0000-000000000000'}::uuid`, q.entity ? eq(events.entity, q.entity) : undefined, q.type ? eq(events.type, q.type) : undefined, q.recordId ? eq(events.recordId, q.recordId) : undefined],
});
