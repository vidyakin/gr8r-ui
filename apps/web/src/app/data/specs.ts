/* Описания коллекций: как строка API превращается в локальную сущность (id — uuid, время — epoch-миллисекунды, «пустое» — '' / undefined)
   и как локальное изменение превращается в запрос. Таблицы `fields` — «локальное поле → поля API»; ими пользуются и создание, и PATCH.
   Граница слоя здесь: компоненты и reducer видят прежнюю модель данных (types.ts), сервер — свою. */
import type { InferResponseType } from 'hono/client';
import type { Api } from './api';
import { ok } from './api';
import type { Activity, CalendarEvent, Comment, Company, Contact, CrmActivity, Deal, FileKind, LabelId, Member, Notification, Project, ProjectFile, SavedView, StatusDef, Subtask, Task, Team, TimeLog } from './types';
import { uuidv7 } from '../lib/uuid';

/* ---------- типы строк API (выводятся из типизированного клиента) ---------- */
type Items<F extends (...a: never[]) => Promise<unknown>> = Extract<InferResponseType<F, 200>, { items: unknown[] }>['items'][number];
type Rows = {
  members: Items<Api['members']['$get']>;
  teams: Items<Api['teams']['$get']>;
  statuses: Items<Api['statuses']['$get']>;
  projects: Items<Api['projects']['$get']>;
  tasks: Items<Api['tasks']['$get']>;
  comments: Items<Api['comments']['$get']>;
  timeLogs: Items<Api['time-logs']['$get']>;
  files: Items<Api['files']['$get']>;
  savedViews: Items<Api['saved-views']['$get']>;
  events: Items<Api['calendar-events']['$get']>;
  notifs: Items<Api['notifications']['$get']>;
  activity: Items<Api['activity']['$get']>;
  companies: Items<Api['companies']['$get']>;
  contacts: Items<Api['contacts']['$get']>;
  deals: Items<Api['deals']['$get']>;
  crmActivities: Items<Api['crm-activities']['$get']>;
};

/* ---------- помощники ---------- */
const ms = (s: string | null | undefined) => (s ? Date.parse(s) : 0);
const minsSince = (s: string | null | undefined) => (s ? Math.max(0, Math.round((Date.now() - Date.parse(s)) / 6e4)) : null);
const num = (v: string | number | null | undefined) => (v == null ? null : Number(v));
const orNull = <T,>(v: T) => (v === '' || v === undefined ? null : v);

/** «4.2 MB» ↔ байты (подпись файла в интерфейсе — строка) */
export function sizeToBytes(s: string): number {
  const m = /^([\d.]+)\s*(B|KB|MB|GB)$/i.exec(s.trim());
  if (!m) return 0;
  const k = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 }[m[2]!.toUpperCase() as 'B' | 'KB' | 'MB' | 'GB'];
  return Math.round(parseFloat(m[1]!) * k);
}
export function bytesToSize(b: number): string {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return Math.round(b / 1024) + ' KB';
  if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB';
  return (b / 1073741824).toFixed(1) + ' GB';
}

const ROLE_UP = { owner: 'Owner', admin: 'Admin', member: 'Member', guest: 'Guest' } as const;
const roleDown = (r: Member['role']) => r.toLowerCase() as 'owner' | 'admin' | 'member' | 'guest';

/** Участник с id аккаунта — по нему определяется «я» в воркспейсе */
export type MemberRow = Member & { userId: string | null };
/** Проект с позицией в сайдбаре (из неё собирается projOrder) */
export type ProjectRow = Project & { sortOrder: number };

/* ---------- устройство описания ---------- */
type Body = Record<string, unknown>;
type FieldMap<L> = { [K in keyof L]?: (v: L[K], l: L) => Body };

export interface Spec<L extends { id: string } = { id: string }> {
  /** Ключ в кэше и в данных */
  name: string;
  /** Параметры списка: сортировка, архивные */
  query: Record<string, string>;
  /** Только первая страница (лента активности — самые свежие 200) */
  firstPageOnly?: boolean;
  from(row: never): L;
  /** Поля, которые уходят и в POST, и в PATCH */
  fields: FieldMap<L>;
  /** Только в POST */
  createFields?: FieldMap<L>;
  /** Создавать сущность на сервере? (служебные записи создаёт сервер сам) */
  canCreate?: (l: L) => boolean;
  /** hard — DELETE ?hard=true (нужны права admin), soft — архивирование (можно вернуть), none — не синхронизируется */
  remove: 'hard' | 'soft' | 'none';
  /** Флаг l.archived управляет архивацией на сервере */
  archive?: boolean;
  /** Родители, при жёстком удалении которых запись исчезает каскадом (отдельный DELETE не нужен) */
  cascadeFrom?: (l: L) => [string, string | null | undefined][];
  /** Идентификатор в URL, если он отличается от l.id */
  apiId?: (l: L) => string;
  /** Свои запросы вместо стандартных */
  runCreate?: (l: L, mode: 'new' | 'restore', api: Api) => Promise<unknown>;
  /** Дополнительные запросы после PATCH (роль участника, реакции) */
  extraPatch?: (before: L, after: L, keys: string[], api: Api) => Promise<unknown>;
}

/** Только то, что нужно описанию от окружения: id воркспейса и словарь ключ статуса → uuid */
export function buildSpecs(ws: string, statusIds: Map<string, string>) {
  const list = <L extends { id: string }>(s: Spec<L>) => s;

  const members = list<MemberRow>({
    name: 'members',
    query: { sort: 'createdAt' },
    from: ((r: Rows['members']): MemberRow => ({
      id: r.id,
      userId: r.userId,
      name: r.name,
      email: r.email,
      role: ROLE_UP[r.role as keyof typeof ROLE_UP],
      team: r.teamId ?? '',
      title: r.title,
      c: r.color,
      status: r.status,
      last: minsSince(r.lastSeenAt),
      tz: r.tz || '—',
    })) as never,
    fields: {
      name: v => ({ name: v }),
      title: v => ({ title: v }),
      c: v => ({ color: v }),
      team: v => ({ teamId: orNull(v) }),
      tz: v => ({ tz: v === '—' ? '' : v }),
      status: v => ({ status: v }),
    },
    // Нового участника в локальной модели создаёт приглашение: профиль «invited» получает id, выбранный клиентом
    runCreate: async (l, _mode, api) => {
      await ok(api.workspaces[':id'].invites.$post({ param: { id: ws }, json: { email: l.email, role: l.role === 'Owner' ? 'admin' : roleDown(l.role) === 'owner' ? 'member' : (roleDown(l.role) as 'admin' | 'member' | 'guest'), memberId: l.id } }));
      const body: Body = { name: l.name, title: l.title, color: l.c };
      if (l.team) body.teamId = l.team;
      await ok(api.members[':id'].$patch({ param: { id: l.id }, json: body as never }));
    },
    // Роль меняется отдельным маршрутом воркспейса: он обновляет и профиль, и членство
    extraPatch: async (before, after, keys, api) => {
      if (keys.includes('role') && before.role !== after.role) await ok(api.workspaces[':id'].members[':memberId'].$patch({ param: { id: ws, memberId: after.id }, json: { role: roleDown(after.role) } }));
    },
    remove: 'none',
  });

  const teams = list<Team & { key: string }>({
    name: 'teams',
    query: { sort: 'sortOrder' },
    from: ((r: Rows['teams']) => ({ id: r.id, key: r.key, name: r.name, icon: r.icon, c: r.color, desc: r.description })) as never,
    fields: { name: v => ({ name: v }), icon: v => ({ icon: v }), c: v => ({ color: v }), desc: v => ({ description: v }) },
    // Ключ команды — читаемый уникальный идентификатор: из названия + хвост uuid
    createFields: { id: (_v, l) => ({ key: `${l.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/^[^a-z]+/, '').slice(0, 20) || 'team'}-${l.id.slice(-6)}` }) },
    remove: 'hard',
  });

  const statuses = list<StatusDef>({
    name: 'statuses',
    query: { sort: 'sortOrder' },
    from: ((r: Rows['statuses']): StatusDef => {
      statusIds.set(r.key, r.id);
      return { id: r.key, name: r.name, color: r.color, builtin: r.builtin || undefined };
    }) as never,
    fields: { name: v => ({ name: v }), color: v => ({ color: v }) },
    runCreate: async (l, _m, api) => {
      const id = uuidv7();
      statusIds.set(l.id, id);
      await ok(api.statuses.$post({ json: { id, key: l.id, name: l.name, color: l.color } }));
    },
    apiId: l => statusIds.get(l.id) ?? l.id,
    remove: 'hard',
  });

  const projects = list<ProjectRow>({
    name: 'projects',
    query: { sort: 'sortOrder', archived: 'include' },
    from: ((r: Rows['projects']): ProjectRow => ({
      id: r.id,
      key: r.key,
      name: r.name,
      icon: r.icon,
      color: r.color,
      status: r.status,
      team: r.teamId ?? '',
      lead: r.leadId ?? '',
      due: r.dueDate ?? '',
      start: r.startDate ?? '',
      fav: r.fav,
      private: r.isPrivate || undefined,
      archived: !!r.archivedAt,
      archivedAt: r.archivedAt ? ms(r.archivedAt) : null,
      members: r.members.map(m => m.memberId),
      perms: Object.fromEntries(r.members.map(m => [m.memberId, m.permission])),
      access: r.access,
      desc: r.description,
      milestones: r.milestones,
      last: minsSince(r.lastActivityAt) ?? 0,
      sortOrder: r.sortOrder,
    })) as never,
    fields: {
      name: v => ({ name: v }),
      icon: v => ({ icon: v }),
      color: v => ({ color: v }),
      status: v => ({ status: v }),
      team: v => ({ teamId: orNull(v) }),
      lead: v => ({ leadId: orNull(v) }),
      due: v => ({ dueDate: orNull(v) }),
      start: v => ({ startDate: orNull(v) }),
      fav: v => ({ fav: v }),
      private: v => ({ isPrivate: !!v }),
      access: v => ({ access: v ?? 'workspace' }),
      desc: v => ({ description: v }),
      milestones: v => ({ milestones: v }),
      members: (v, l) => ({ members: v.map(id => ({ memberId: id, permission: l.perms?.[id] ?? 'edit' })) }),
      perms: (_v, l) => ({ members: l.members.map(id => ({ memberId: id, permission: l.perms?.[id] ?? 'edit' })) }),
      sortOrder: v => ({ sortOrder: v }),
    },
    createFields: { key: v => ({ key: v }) },
    remove: 'hard',
    archive: true,
  });

  const tasks = list<Task>({
    name: 'tasks',
    query: { sort: 'sortOrder', archived: 'include' },
    from: ((r: Rows['tasks']): Task => ({
      id: r.id,
      key: r.key,
      project: r.projectId,
      title: r.title,
      status: r.status,
      assignee: r.assigneeId,
      priority: r.priority,
      due: r.dueDate,
      start: r.startDate,
      labels: r.labels as LabelId[],
      subtasks: r.subtasks as Subtask[],
      attachments: [], // собираются из файлов с taskId (assemble)
      deps: r.deps,
      desc: r.description,
      planHours: num(r.planHours),
      created: ms(r.createdAt),
      updated: ms(r.updatedAt),
      completedAt: r.completedAt ? ms(r.completedAt) : undefined,
      prevStatus: r.prevStatus ?? undefined,
      order: r.sortOrder,
      fav: r.fav,
      recur: r.recur,
      archived: !!r.archivedAt,
      archivedAt: r.archivedAt ? ms(r.archivedAt) : null,
      custom: r.custom as Record<string, unknown>,
    })) as never,
    fields: {
      custom: v => ({ custom: v }),
      title: v => ({ title: v }),
      status: v => ({ status: v }),
      assignee: v => ({ assigneeId: orNull(v) }),
      priority: v => ({ priority: v ?? null }),
      due: v => ({ dueDate: orNull(v) }),
      start: v => ({ startDate: orNull(v) }),
      labels: v => ({ labels: v }),
      subtasks: v => ({ subtasks: v }),
      deps: v => ({ deps: v }),
      desc: v => ({ description: v }),
      planHours: v => ({ planHours: v ?? null }),
      fav: v => ({ fav: v }),
      recur: v => ({ recur: v ?? null }),
      project: v => ({ projectId: v }),
      order: v => ({ sortOrder: v }),
    },
    // key уходит только при повторном создании (Undo): так задача возвращается под прежним номером
    createFields: { project: v => ({ projectId: v }) },
    remove: 'hard',
    archive: true,
  });

  const comments = list<Comment>({
    name: 'comments',
    query: { sort: 'createdAt' },
    from: ((r: Rows['comments']): Comment => ({ id: r.id, task: r.taskId, by: r.authorId, at: ms(r.createdAt), text: r.body, re: r.re })) as never,
    fields: { text: v => ({ body: v }) },
    createFields: { task: v => ({ taskId: v }) },
    cascadeFrom: l => [['tasks', l.task]],
    remove: 'hard',
    // Реакции — переключатель текущего участника: достаточно по разу на эмодзи, где изменился набор
    extraPatch: async (before, after, keys, api) => {
      if (!keys.includes('re')) return;
      for (const emoji of new Set([...Object.keys(before.re), ...Object.keys(after.re)])) {
        const a = new Set(before.re[emoji] ?? []);
        const b = new Set(after.re[emoji] ?? []);
        if (a.size !== b.size || [...a].some(x => !b.has(x))) await ok(api.comments[':id'].reactions.$post({ param: { id: after.id }, json: { emoji } }));
      }
    },
  });

  const timeLogs = list<TimeLog>({
    name: 'timeLogs',
    query: { sort: 'logDate' },
    from: ((r: Rows['timeLogs']): TimeLog => ({ id: r.id, task: r.taskId, sub: r.subId ?? undefined, by: r.memberId, hours: Number(r.hours), date: r.logDate, note: r.note })) as never,
    fields: { task: v => ({ taskId: v }), sub: v => ({ subId: v ?? null }), hours: v => ({ hours: v }), date: v => ({ logDate: v }), note: v => ({ note: v }) },
    createFields: { by: v => ({ memberId: v }) },
    cascadeFrom: l => [['tasks', l.task]],
    remove: 'hard',
  });

  const files = list<ProjectFile>({
    name: 'files',
    query: { sort: '-createdAt' },
    from: ((r: Rows['files']): ProjectFile => ({ id: r.id, project: r.projectId ?? '', name: r.name, type: r.kind as FileKind, size: bytesToSize(r.sizeBytes), by: r.uploadedBy ?? '', at: ms(r.createdAt), task: r.taskId })) as never,
    fields: { name: v => ({ name: v }), type: v => ({ kind: v }) },
    createFields: { project: v => ({ projectId: orNull(v) }), task: v => ({ taskId: v ?? null }), size: v => ({ sizeBytes: sizeToBytes(v) }) },
    cascadeFrom: l => [
      ['tasks', l.task],
      ['projects', l.project],
    ],
    remove: 'soft',
  });

  const savedViews = list<SavedView>({
    name: 'savedViews',
    query: { sort: 'createdAt' },
    from: ((r: Rows['savedViews']): SavedView => ({ id: r.id, project: r.projectId, name: r.name, type: r.type, filters: r.filters })) as never,
    fields: { name: v => ({ name: v }), type: v => ({ type: v }), filters: v => ({ filters: v }) },
    createFields: { project: v => ({ projectId: v }) },
    cascadeFrom: l => [['projects', l.project]],
    remove: 'hard',
  });

  const events = list<CalendarEvent>({
    name: 'events',
    query: { sort: 'eventDate' },
    from: ((r: Rows['events']): CalendarEvent => ({ id: r.id, title: r.title, date: r.eventDate, time: r.eventTime, project: r.projectId ?? '' })) as never,
    fields: { title: v => ({ title: v }), date: v => ({ eventDate: v }), time: v => ({ eventTime: v }), project: v => ({ projectId: orNull(v) }) },
    remove: 'hard',
  });

  const notifs = list<Notification>({
    name: 'notifs',
    query: { sort: '-createdAt' },
    from: ((r: Rows['notifs']): Notification => ({ id: r.id, type: r.type, by: r.actorId, task: r.taskId ?? undefined, project: r.projectId ?? undefined, text: r.text, snippet: r.snippet, at: ms(r.createdAt), read: r.read })) as never,
    fields: { read: v => ({ read: v }) },
    canCreate: () => false, // уведомления создаёт сервер
    remove: 'none',
  });

  const activity = list<Activity>({
    name: 'activity',
    query: { sort: '-createdAt' },
    firstPageOnly: true,
    from: ((r: Rows['activity']): Activity => ({ id: r.id, by: r.actorId ?? '', verb: r.verb, task: r.taskId, project: r.projectId, at: ms(r.createdAt), extra: r.extra })) as never,
    fields: {},
    canCreate: () => false, // ленту пишет сервер вместе с изменением
    remove: 'none',
  });

  const companies = list<Company>({
    name: 'companies',
    query: { sort: 'name' },
    from: ((r: Rows['companies']): Company => ({ id: r.id, name: r.name, industry: r.industry, size: r.size, owner: r.ownerId ?? '', website: r.website, city: r.city, created: ms(r.createdAt), custom: r.custom as Record<string, unknown> })) as never,
    fields: { custom: v => ({ custom: v }), name: v => ({ name: v }), industry: v => ({ industry: v }), size: v => ({ size: v }), owner: v => ({ ownerId: orNull(v) }), website: v => ({ website: v }), city: v => ({ city: v }) },
    remove: 'soft',
  });

  const contacts = list<Contact>({
    name: 'contacts',
    query: { sort: 'name' },
    from: ((r: Rows['contacts']): Contact => ({ id: r.id, company: r.companyId ?? '', name: r.name, title: r.title, email: r.email, phone: r.phone, owner: r.ownerId ?? '', created: ms(r.createdAt), custom: r.custom as Record<string, unknown> })) as never,
    fields: { custom: v => ({ custom: v }), company: v => ({ companyId: orNull(v) }), name: v => ({ name: v }), title: v => ({ title: v }), email: v => ({ email: v }), phone: v => ({ phone: v }), owner: v => ({ ownerId: orNull(v) }) },
    remove: 'soft',
  });

  const deals = list<Deal>({
    name: 'deals',
    query: { sort: 'sortOrder' },
    from: ((r: Rows['deals']): Deal => ({
      id: r.id,
      name: r.name,
      company: r.companyId ?? '',
      contacts: r.contactIds,
      owner: r.ownerId ?? '',
      amount: Number(r.amount),
      stage: r.stage,
      closeDate: r.closeDate ?? '',
      created: ms(r.createdAt),
      closedAt: r.closedAt ?? undefined,
      lostReason: r.lostReason ?? undefined,
      order: r.sortOrder,
      custom: r.custom as Record<string, unknown>,
    })) as never,
    fields: {
      custom: v => ({ custom: v }),
      name: v => ({ name: v }),
      company: v => ({ companyId: orNull(v) }),
      contacts: v => ({ contactIds: v }),
      owner: v => ({ ownerId: orNull(v) }),
      amount: v => ({ amount: v }),
      stage: v => ({ stage: v }),
      closeDate: v => ({ closeDate: orNull(v) }),
      closedAt: v => ({ closedAt: v ?? null }),
      lostReason: v => ({ lostReason: v ?? null }),
      order: v => ({ sortOrder: v }),
    },
    remove: 'soft',
  });

  const crmActivities = list<CrmActivity>({
    name: 'crmActivities',
    query: { sort: '-createdAt' },
    from: ((r: Rows['crmActivities']): CrmActivity => ({
      id: r.id,
      type: r.type,
      subject: r.subject,
      deal: r.dealId ?? undefined,
      company: r.companyId ?? undefined,
      contact: r.contactId ?? undefined,
      by: r.authorId ?? '',
      at: ms(r.createdAt),
      system: r.system || undefined,
      due: r.dueDate ?? undefined,
      done: r.done ?? undefined,
      body: r.body ?? undefined,
    })) as never,
    fields: { type: v => ({ type: v }), subject: v => ({ subject: v }), deal: v => ({ dealId: v ?? null }), company: v => ({ companyId: v ?? null }), contact: v => ({ contactId: v ?? null }), due: v => ({ dueDate: v ?? null }), done: v => ({ done: v ?? null }), body: v => ({ body: v ?? null }) },
    // Служебные записи («Stage changed…») создаёт сервер при смене этапа; локальные копии не отправляются
    canCreate: l => !l.system,
    // Сделка удаляется мягко (архив), её активности остаются на сервере и скрываются на клиенте — вернётся сделка, вернутся и они
    cascadeFrom: l => [['deals', l.deal]],
    remove: 'hard',
  });

  return { members, teams, statuses, projects, tasks, comments, timeLogs, files, savedViews, events, notifs, activity, companies, contacts, deals, crmActivities };
}

export type Specs = ReturnType<typeof buildSpecs>;
export type CollName = keyof Specs;

/** Порядок зависимостей: родители раньше детей (создание — по порядку, удаление — в обратном) */
export const COLL_ORDER: CollName[] = ['teams', 'members', 'statuses', 'projects', 'tasks', 'comments', 'timeLogs', 'files', 'savedViews', 'events', 'companies', 'contacts', 'deals', 'crmActivities', 'notifs', 'activity'];
