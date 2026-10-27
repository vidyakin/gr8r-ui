/* Сид: демо-воркспейс «Gr8r Studio» со всеми демо-данными фронтенда (генерация живёт в @gr8r/shared/demo —
   один источник для браузера и БД) и второй воркспейс другого пользователя для проверки изоляции арендаторов.
   Сид идёт тем же путём, что и приложение: под ролью app_user с настройками RLS (политики проверяют и его). */
import { eq, sql as dsql } from 'drizzle-orm';
import type { FieldType, Subtask } from '@gr8r/shared';
import { seed as demoWorkspace, seedCrm } from '@gr8r/shared/demo';
import type { Db, Sql } from './client';
import { withContext } from './context';
import { registerBaseUnits } from './catalog';
import { seedCatalog } from './seed-catalog';
import { seedDocuments } from './seed-documents';
import { seedFlows } from './seed-flows';
import { seedPlanning } from './seed-planning';
import { seedContracts } from './seed-contracts';
import { seedRepeatSales } from './seed-repeat-sales';
import { seedPositions } from './seed-positions';
import { seedAppointments } from './seed-appointments';
import { seedLeads } from './seed-leads';
import { ensureCostItems, ensureDocumentDefaults } from './documents';
import { ensureModuleProjects } from './modules';
import { ensureWorkOrderKind } from './work-orders';
import { ensureLeadStatuses } from './leads';
import { enqueueFieldIndex, registerSystemEntities } from './meta';
import { uuidv7 } from './uuid';
import {
  activity,
  calendarEvents,
  commentReactions,
  comments,
  companies,
  contacts,
  crmActivities,
  dealContacts,
  deals,
  entities,
  events,
  fields,
  files,
  invites,
  members,
  memberships,
  notifications,
  organizations,
  projectMembers,
  projects,
  records,
  savedViews,
  statuses,
  tasks,
  teams,
  timeLogs,
  users,
  workspaces,
} from './schema';

export const DEMO_USER = { email: 'demo@gr8r.dev', password: 'demo1234' } as const;
export const OTHER_USER = { email: 'bob@acme.test', password: 'bob12345', name: 'Bob Marley' } as const;

const hash = (pw: string) => Bun.password.hash(pw, { algorithm: 'argon2id' });
const ms = (n: number | null | undefined) => (n == null ? null : new Date(n));
const ago = (mins: number) => new Date(Date.now() - mins * 6e4);

/** «4.2 MB» → байты */
function parseSize(s: string): number {
  const m = /^([\d.]+)\s*(B|KB|MB|GB)$/i.exec(s.trim());
  if (!m) return 0;
  const k = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 }[m[2]!.toUpperCase() as 'B' | 'KB' | 'MB' | 'GB'];
  return Math.round(parseFloat(m[1]!) * k);
}

async function insertChunks<T>(rows: T[], fn: (chunk: T[]) => Promise<unknown>, size = 400) {
  for (let i = 0; i < rows.length; i += size) await fn(rows.slice(i, i + size));
}

/** Создаёт набор статусов по умолчанию для нового воркспейса (общий код сида и API) */
export const defaultStatusRows = (workspaceId: string, list: { id: string; name: string; color?: string; builtin?: boolean }[]) =>
  list.map((s, i) => ({
    workspaceId,
    key: s.id,
    name: s.name,
    color: s.color ?? `var(--st-${s.id})`,
    builtin: s.builtin ?? true,
    sortOrder: i,
  }));

/** Демо конструктора: поля «Story points» (number) и «Client» (ref → companies) у задач и сущность «Suppliers» с 8 записями.
    Возвращает поля с флагом filterable — индексы по ним создаются после коммита (CREATE INDEX CONCURRENTLY вне транзакции) */
async function seedMeta(db: Db, wsId: string, sys: Map<string, string>, creator: string | null) {
  const taskEntity = sys.get('task')!;
  await db.insert(fields).values([
    { workspaceId: wsId, entityId: taskEntity, key: 'story_points', name: 'Story points', type: 'number', filterable: true, options: { min: 0, max: 100 }, sortOrder: 0 },
    { workspaceId: wsId, entityId: taskEntity, key: 'client', name: 'Client', type: 'ref', options: { refEntity: 'company' }, sortOrder: 1 },
  ]);

  const supplierEntity = uuidv7();
  await db.insert(entities).values({ id: supplierEntity, workspaceId: wsId, key: 'suppliers', name: 'Suppliers', kind: 'custom', icon: 'truck', titleField: 'name', sortOrder: 10 });
  const choice = (value: string, color: string) => ({ value, label: value, color });
  const supplierFields = [
    { key: 'name', name: 'Name', type: 'text', required: true, options: {} },
    { key: 'category', name: 'Category', type: 'select', filterable: true, options: { choices: [choice('Hardware', 'blue'), choice('Software', 'violet'), choice('Logistics', 'amber'), choice('Materials', 'teal'), choice('Services', 'green')] } },
    { key: 'rating', name: 'Rating', type: 'number', filterable: true, options: { min: 0, max: 5 } },
    { key: 'contact_email', name: 'Contact email', type: 'email', options: {} },
    { key: 'website', name: 'Website', type: 'url', options: {} },
    { key: 'notes', name: 'Notes', type: 'long_text', options: {} },
  ] as const;
  const inserted = await db
    .insert(fields)
    .values(supplierFields.map((f, i) => ({ workspaceId: wsId, entityId: supplierEntity, sortOrder: i, ...f, options: f.options as never })))
    .returning({ id: fields.id, key: fields.key, type: fields.type, filterable: fields.filterable });
  const rows: [string, string, number, string, string, string][] = [
    ['Northwind Components', 'Hardware', 4.5, 'sales@northwind.example', 'https://northwind.example', 'Main source of PCBs and connectors. Net 30.'],
    ['Cloudline Hosting', 'Software', 4.8, 'support@cloudline.example', 'https://cloudline.example', 'Managed Kubernetes and object storage.'],
    ['Fastlane Freight', 'Logistics', 3.9, 'dispatch@fastlane.example', 'https://fastlane.example', 'Pallet shipping across the EU. Occasional delays at customs.'],
    ['Green Pack Materials', 'Materials', 4.2, 'orders@greenpack.example', 'https://greenpack.example', 'Recycled packaging, minimum order 500 units.'],
    ['Pixel Foundry', 'Services', 4.7, 'hello@pixelfoundry.example', 'https://pixelfoundry.example', 'Contract illustration and motion design.'],
    ['Ironside Metalworks', 'Materials', 3.5, 'quotes@ironside.example', 'https://ironside.example', 'Custom brackets; lead time 3 weeks.'],
    ['Lumen Displays', 'Hardware', 4.1, 'b2b@lumen.example', 'https://lumen.example', 'Touch panels for kiosks.'],
    ['Quill Legal', 'Services', 4.9, 'desk@quill.example', 'https://quill.example', 'Contracts and compliance reviews.'],
  ];
  await db.insert(records).values(
    rows.map(([name, category, rating, contact_email, website, notes], i) => ({
      workspaceId: wsId,
      entityId: supplierEntity,
      data: { name, category, rating, contact_email, website, notes },
      createdBy: creator,
      createdAt: ago(600 - i * 20),
    })),
  );
  const taskFields = await db.select({ id: fields.id, key: fields.key, type: fields.type, filterable: fields.filterable }).from(fields).where(eq(fields.entityId, taskEntity));
  return [
    ...taskFields.filter(f => f.filterable).map(f => ({ fieldId: f.id, key: f.key, type: f.type as FieldType, entityId: taskEntity, entityKey: 'task' })),
    ...inserted.filter(f => f.filterable).map(f => ({ fieldId: f.id, key: f.key, type: f.type as FieldType, entityId: supplierEntity, entityKey: 'suppliers' })),
  ];
}

/** Демо-воркспейс: все данные фронтенда (задачи, проекты, комментарии, CRM…) */
async function seedDemoWorkspace(db: Db, wsId: string, ownerUserId: string, userIds: Map<string, string>, inviteToken: string) {
  const d = demoWorkspace();
  const crm = seedCrm();
  const ids = new Map<string, string>(); // старый id фронтенда → uuid v7
  const U = (old: string) => {
    let v = ids.get(old);
    if (!v) ids.set(old, (v = uuidv7()));
    return v;
  };
  const Uo = (old?: string | null) => (old ? U(old) : null);

  await db.insert(workspaces).values({ id: wsId, name: d.ws.name, slug: d.ws.url, color: d.ws.c, brand: d.ws.brand ?? false, createdBy: ownerUserId });
  await db.insert(memberships).values(
    d.members
      .filter(m => userIds.has(m.id))
      .map(m => ({ workspaceId: wsId, userId: userIds.get(m.id)!, role: m.role.toLowerCase() as 'owner' })),
  );

  // Команды
  const teamId = new Map<string, string>();
  await db.insert(teams).values(
    d.teams.map((t, i) => {
      const id = uuidv7();
      teamId.set(t.id, id);
      return { id, workspaceId: wsId, key: t.id, name: t.name, icon: t.icon, color: t.c, description: t.desc, sortOrder: i };
    }),
  );

  // Участники (профили)
  await db.insert(members).values(
    d.members.map(m => ({
      id: U(m.id),
      workspaceId: wsId,
      userId: userIds.get(m.id) ?? null,
      email: m.id === 'm1' ? DEMO_USER.email : m.email,
      name: m.name,
      title: m.title,
      color: m.c,
      teamId: teamId.get(m.team) ?? null,
      role: m.role.toLowerCase() as 'owner',
      status: m.status,
      tz: m.tz,
      lastSeenAt: m.last == null ? null : ago(m.last),
    })),
  );
  // Приглашённые без аккаунта получают инвайт (токен в сиде не выводится: он нужен только для целостности данных)
  for (const m of d.members.filter(x => x.status === 'invited')) {
    await db.insert(invites).values({
      workspaceId: wsId,
      email: m.email,
      role: m.role.toLowerCase() as 'guest',
      tokenHash: new Bun.CryptoHasher('sha256').update(inviteToken + m.id).digest('hex'),
      invitedBy: ownerUserId,
      expiresAt: new Date(Date.now() + 14 * 864e5),
    });
  }

  // Статусы (колонки доски)
  await db.insert(statuses).values(defaultStatusRows(wsId, d.statuses));

  // Проекты
  const maxNum = new Map<string, number>();
  for (const t of d.tasks) {
    const n = parseInt(t.key.split('-').pop()!, 10);
    maxNum.set(t.project, Math.max(maxNum.get(t.project) ?? 0, n));
  }
  await db.insert(projects).values(
    d.projects.map(p => ({
      id: U(p.id),
      workspaceId: wsId,
      key: p.key,
      name: p.name,
      icon: p.icon,
      color: p.color,
      status: p.status,
      teamId: teamId.get(p.team) ?? null,
      leadId: U(p.lead),
      startDate: p.start,
      dueDate: p.due,
      fav: p.fav,
      isPrivate: !!p.private,
      access: p.private ? ('private' as const) : (p.access ?? ('workspace' as const)),
      description: p.desc,
      milestones: p.milestones,
      taskCounter: maxNum.get(p.id) ?? 0,
      sortOrder: d.projOrder.indexOf(p.id),
      lastActivityAt: ago(p.last),
      archivedAt: ms(p.archivedAt),
    })),
  );
  await db.insert(projectMembers).values(
    d.projects.flatMap(p => p.members.map(m => ({ workspaceId: wsId, projectId: U(p.id), memberId: U(m), permission: p.perms?.[m] ?? (m === p.lead ? 'admin' : 'edit') }))),
  );

  // Конструктор сущностей: системные сущности, пользовательские поля задач, сущность «Suppliers»
  const sysEntity = await registerSystemEntities(db, wsId);
  const metaFields = await seedMeta(db, wsId, sysEntity, d.me ? U(d.me) : null);
  // Каталог и производство: категории, товары, услуги, участки, изделия со спецификациями
  await seedCatalog(db, wsId);
  // Планирование загрузки: графики, праздники, ключевые ресурсы
  await seedPlanning(db, wsId);
  const taskCustom = (_id: string, i: number): Record<string, unknown> => ({
    story_points: [1, 2, 3, 5, 8, 13][i % 6],
    ...(i % 4 === 0 ? { client: U(crm.companies[i % crm.companies.length]!.id) } : {}),
  });

  // Задачи. В подзадачах id участников (assignee) тоже переводим в uuid
  const mapSubs = (list: Subtask[]): Subtask[] => list.map(s => ({ ...s, assignee: s.assignee ? U(s.assignee) : s.assignee, subtasks: mapSubs(s.subtasks) }));
  await insertChunks(d.tasks, chunk =>
    db.insert(tasks).values(
      chunk.map(t => ({
        id: U(t.id),
        workspaceId: wsId,
        key: t.key,
        projectId: U(t.project),
        title: t.title,
        status: t.status,
        assigneeId: Uo(t.assignee),
        priority: t.priority,
        dueDate: t.due,
        startDate: t.start,
        labels: t.labels,
        subtasks: mapSubs(t.subtasks),
        deps: t.deps.map(U),
        description: t.desc,
        planHours: t.planHours == null ? null : String(t.planHours),
        prevStatus: t.prevStatus ?? null,
        sortOrder: t.order,
        fav: t.fav,
        recur: t.recur,
        custom: taskCustom(t.id, d.tasks.indexOf(t)),
        createdAt: new Date(t.created),
        updatedAt: new Date(t.updated),
        completedAt: ms(t.completedAt),
        archivedAt: ms(t.archivedAt),
      })),
    ),
  );

  // Комментарии и реакции
  await db.insert(comments).values(d.comments.map(c => ({ id: U(c.id), workspaceId: wsId, taskId: U(c.task), authorId: U(c.by), body: c.text, createdAt: new Date(c.at), updatedAt: new Date(c.at) })));
  const reactions = d.comments.flatMap(c => Object.entries(c.re).flatMap(([emoji, by]) => by.map(m => ({ workspaceId: wsId, commentId: U(c.id), memberId: U(m), emoji }))));
  if (reactions.length) await db.insert(commentReactions).values(reactions);

  // Активность, уведомления
  await db.insert(activity).values(d.activity.map(a => ({ workspaceId: wsId, actorId: U(a.by), verb: a.verb, taskId: Uo(a.task), projectId: Uo(a.project), extra: a.extra, createdAt: new Date(a.at) })));
  await db.insert(notifications).values(
    d.notifs.map(n => ({ workspaceId: wsId, recipientId: U(d.me), type: n.type, actorId: Uo(n.by), taskId: Uo(n.task), projectId: Uo(n.project), text: n.text, snippet: n.snippet, read: n.read, createdAt: new Date(n.at) })),
  );

  // Файлы (метаданные), учёт времени, виды, события календаря
  await db.insert(files).values(
    d.files.map(f => ({ workspaceId: wsId, projectId: U(f.project), taskId: Uo(f.task), name: f.name, kind: f.type, sizeBytes: parseSize(f.size), uploadedBy: U(f.by), createdAt: new Date(f.at) })),
  );
  await db.insert(timeLogs).values(
    d.timeLogs.map(l => ({ workspaceId: wsId, taskId: U(l.task), subId: l.sub ?? null, memberId: U(l.by), hours: String(l.hours), logDate: l.date, note: l.note })),
  );
  await db.insert(savedViews).values(d.savedViews.map(v => ({ workspaceId: wsId, projectId: U(v.project), ownerId: U(d.me), name: v.name, type: v.type, filters: v.filters })));
  await db.insert(calendarEvents).values(d.events.map(e => ({ workspaceId: wsId, projectId: Uo(e.project), title: e.title, eventDate: e.date, eventTime: e.time, createdBy: U(d.me) })));

  // CRM
  await db.insert(companies).values(crm.companies.map(c => ({ id: U(c.id), workspaceId: wsId, name: c.name, industry: c.industry, size: c.size, ownerId: U(c.owner), website: c.website, city: c.city, createdAt: new Date(c.created) })));
  await db.insert(contacts).values(crm.contacts.map(c => ({ id: U(c.id), workspaceId: wsId, companyId: U(c.company), name: c.name, title: c.title, email: c.email, phone: c.phone, ownerId: U(c.owner), createdAt: new Date(c.created) })));
  await db.insert(deals).values(
    crm.deals.map(x => ({
      id: U(x.id),
      workspaceId: wsId,
      name: x.name,
      companyId: U(x.company),
      ownerId: U(x.owner),
      amount: x.amount.toFixed(2),
      stage: x.stage,
      closeDate: x.closeDate,
      closedAt: x.closedAt ?? null,
      lostReason: x.lostReason ?? null,
      sortOrder: x.order,
      createdAt: new Date(x.created),
    })),
  );
  await db.insert(dealContacts).values(crm.deals.flatMap(x => x.contacts.map(c => ({ workspaceId: wsId, dealId: U(x.id), contactId: U(c) }))));
  await insertChunks(crm.activities, chunk =>
    db.insert(crmActivities).values(
      chunk.map(a => ({
        workspaceId: wsId,
        type: a.type,
        subject: a.subject,
        dealId: Uo(a.deal),
        companyId: Uo(a.company),
        contactId: Uo(a.contact),
        authorId: U(a.by),
        system: !!a.system,
        dueDate: a.due ?? null,
        done: a.done ?? null,
        body: a.body ?? null,
        createdAt: new Date(a.at),
      })),
    ),
  );

  // Должности и виды номенклатуры (до доставки и записи, которые берут из них курьеров и специалистов)
  await seedPositions(db, { workspaceId: wsId, memberId: U(d.me), role: 'owner' });
  // Документы и склад: организация, склады, реквизиты, цепочки закупок и продаж (проводятся настоящими сервисами)
  const docs = await seedDocuments(db, wsId, U(d.me), { atlas: U('co8'), northwind: U('co1'), quanta: U('co4'), skyline: U('co10') });
  // Договоры и тарифные планы: договор обслуживания демо-клиента
  const [demoOrg] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.workspaceId, wsId)).limit(1);
  await seedContracts(db, wsId, demoOrg!.id, U('co4'), docs.workOrder);
  await ensureCostItems(db, wsId);
  // Модули задач: системные проекты производства и услуг
  await ensureModuleProjects(db, wsId);
  // Заказ-наряды: вид по умолчанию и его состояния
  await ensureWorkOrderKind(db, wsId);

  // Автоматизации: две демо-flow (задача → Review, сделка → Won)
  await seedFlows(db, wsId, U(d.me), U('p1'));

  // Повторные продажи и план продаж на текущий год
  await seedRepeatSales(db, { workspaceId: wsId, memberId: U(d.me), role: 'owner' }, { first: U('co1'), second: U('co8') });

  // Запись на приём: специалисты с графиками, услуги массажа, записи этой недели и незакрытый день
  await seedAppointments(db, { workspaceId: wsId, memberId: U(d.me), role: 'owner' });

  // Лиды: статусы, форма сайта, лиды с касаниями и один сконвертированный (задача 1175)
  await seedLeads(db, wsId, U(d.me));

  await db.insert(events).values({ workspaceId: wsId, type: 'workspace.seeded', entity: 'workspace', recordId: wsId, actorId: U(d.me), payload: { tasks: d.tasks.length, deals: crm.deals.length, documents: docs.documents } });
  return { tasks: d.tasks.length, projects: d.projects.length, deals: crm.deals.length, metaFields };
}

/** Второй арендатор: маленький, чтобы проверять, что демо-пользователь его не видит */
async function seedOtherWorkspace(db: Db, wsId: string, userId: string) {
  const memberId = uuidv7();
  const projectId = uuidv7();
  const companyId = uuidv7();
  await db.insert(workspaces).values({ id: wsId, name: 'Acme Corp', slug: 'acme', color: '#C54B78', createdBy: userId });
  await db.insert(memberships).values({ workspaceId: wsId, userId, role: 'owner' });
  await db.insert(members).values({ id: memberId, workspaceId: wsId, userId, email: OTHER_USER.email, name: OTHER_USER.name, title: 'Founder', color: '#C54B78', role: 'owner' });
  await registerSystemEntities(db, wsId);
  await ensureLeadStatuses(db, wsId);
  await registerBaseUnits(db, wsId);
  await ensureDocumentDefaults(db, wsId, 'Acme Corp');
  await ensureCostItems(db, wsId);
  await ensureModuleProjects(db, wsId);
  await ensureWorkOrderKind(db, wsId);
  await db.insert(statuses).values(defaultStatusRows(wsId, [{ id: 'todo', name: 'To Do' }, { id: 'progress', name: 'In Progress' }, { id: 'done', name: 'Done' }]));
  await db.insert(projects).values({ id: projectId, workspaceId: wsId, key: 'ACM', name: 'Acme Secret Project', icon: 'lock', color: 'rose', status: 'active', leadId: memberId, taskCounter: 3, description: 'Private data of another tenant' });
  await db.insert(tasks).values(
    ['Secret roadmap', 'Confidential pricing', 'Internal memo'].map((title, i) => ({ workspaceId: wsId, key: `ACM-${i + 1}`, projectId, title, status: 'todo', assigneeId: memberId, priority: 5 + i, sortOrder: i })),
  );
  await db.insert(companies).values({ id: companyId, workspaceId: wsId, name: 'Acme Customer Ltd', ownerId: memberId });
  await db.insert(deals).values({ workspaceId: wsId, name: 'Acme secret deal', companyId, ownerId: memberId, amount: '1000000.00', stage: 'negotiation' });
}

export async function runSeed(sql: Sql, log: (msg: string) => void = console.log) {
  const exists = await withContext(sql, {}, async db => (await db.select({ id: users.id }).from(users).where(eq(dsql`lower(${users.email})`, DEMO_USER.email)).limit(1))[0]);
  if (exists) {
    log('[seed] demo data already present — run `bun run db:reset` to start from scratch');
    return;
  }
  const t0 = performance.now();

  // Пользователи: по одному на активного участника демо-воркспейса (общий пароль) + владелец второго воркспейса
  const demo = demoWorkspace();
  const userIds = new Map<string, string>(); // id участника фронтенда → user id
  const demoHash = await hash(DEMO_USER.password);
  const userRows = demo.members
    .filter(m => m.status === 'active')
    .map(m => {
      const id = uuidv7();
      userIds.set(m.id, id);
      return { id, email: m.id === 'm1' ? DEMO_USER.email : m.email, passwordHash: demoHash, name: m.name };
    });
  const otherUserId = uuidv7();
  await withContext(sql, {}, async db => {
    await db.insert(users).values(userRows);
    await db.insert(users).values({ id: otherUserId, email: OTHER_USER.email, passwordHash: await hash(OTHER_USER.password), name: OTHER_USER.name });
  });

  // Каждый воркспейс — в своей транзакции с контекстом арендатора
  const demoWs = uuidv7();
  const stats = await withContext(sql, { userId: userIds.get('m1'), workspaceId: demoWs }, db => seedDemoWorkspace(db, demoWs, userIds.get('m1')!, userIds, uuidv7()));
  const otherWs = uuidv7();
  await withContext(sql, { userId: otherUserId, workspaceId: otherWs }, db => seedOtherWorkspace(db, otherWs, otherUserId));

  // Индексы по полям с флагом filterable строит воркер (DDL у API и сида нет): ставим задачи в очередь
  await withContext(sql, { workspaceId: demoWs }, async db => {
    for (const t of stats.metaFields) await enqueueFieldIndex(db, demoWs, 'create', t.fieldId);
  });

  log(`[seed] done in ${Math.round(performance.now() - t0)} ms: demo workspace (${stats.projects} projects, ${stats.tasks} tasks, ${stats.deals} deals) + Acme workspace`);
  log(`[seed] demo login: ${DEMO_USER.email} / ${DEMO_USER.password}; other tenant: ${OTHER_USER.email} / ${OTHER_USER.password}`);
}
