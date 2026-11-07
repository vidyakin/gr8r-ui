/* Шаблоны проектов (docs/architecture/task-modules.md, «Шаблоны проектов»): сохранить проект как шаблон и создать проект
   из шаблона с датой старта. Сроки хранятся как «день N от старта», исполнители — должностями. Права проверяют маршруты. */
import { and, asc, eq, inArray, isNull, max } from 'drizzle-orm';
import {
  dateFromDay,
  dayFromDate,
  milestonesToTemplate,
  subtasksFromTemplate,
  subtasksToTemplate,
  templateBaseDate,
  templateStatus,
  type ProjectFromTemplate,
  type TemplateMilestone,
  type TemplateSubtask,
} from '@gr8r/shared';
import type { Db } from './client';
import type { DocCtx } from './documents';
import { DomainError } from './errors';
import { recordEvent } from './events';
import { issueTaskKey } from './modules';
import { sanitizeRichText } from './rich-text';
import { activity, memberPositions, members, positions, projectMembers, projectTemplates, projectTemplateTasks, projects, statuses, tasks } from './schema';
import { uuidv7 } from './uuid';

export type ProjectTemplateRow = typeof projectTemplates.$inferSelect;
export type ProjectTemplateTaskRow = typeof projectTemplateTasks.$inferSelect;

const countSubtasks = (list: readonly TemplateSubtask[]): number => list.reduce((n, s) => n + 1 + countSubtasks(s.subtasks), 0);

async function loadTemplate(db: Db, id: string): Promise<ProjectTemplateRow> {
  const [row] = await db.select().from(projectTemplates).where(eq(projectTemplates.id, id)).limit(1);
  if (!row) throw new DomainError(404, 'not_found', 'Project template not found');
  return row;
}

/** Список шаблонов со сводкой (число задач и подзадач); enabledOnly — только не отключённые (выбор при создании проекта) */
export async function listProjectTemplates(db: Db, opts: { enabledOnly?: boolean } = {}) {
  const rows = await db
    .select()
    .from(projectTemplates)
    .where(opts.enabledOnly ? eq(projectTemplates.disabled, false) : undefined)
    .orderBy(asc(projectTemplates.name));
  if (!rows.length) return [];
  const ts = await db
    .select({ templateId: projectTemplateTasks.templateId, subtasks: projectTemplateTasks.subtasks })
    .from(projectTemplateTasks)
    .where(inArray(projectTemplateTasks.templateId, rows.map(r => r.id)));
  return rows.map(r => {
    const mine = ts.filter(t => t.templateId === r.id);
    return { ...r, taskCount: mine.length, subtaskCount: mine.reduce((n, t) => n + countSubtasks(t.subtasks), 0) };
  });
}

export async function getProjectTemplate(db: Db, id: string) {
  const template = await loadTemplate(db, id);
  const list = await db.select().from(projectTemplateTasks).where(eq(projectTemplateTasks.templateId, id)).orderBy(asc(projectTemplateTasks.sortOrder));
  return { ...template, tasks: list };
}

/** Сохранить проект как шаблон: статусы задач, вехи, задачи с подзадачами (чек-листами), сроки в днях от старта, исполнители по должностям.
    Выполненные задачи получают статус todo, подзадачи — не выполнены; зависимости задач и вложения не переносятся. */
export async function saveProjectAsTemplate(db: Db, ctx: DocCtx, input: { projectId: string; name: string; description?: string | undefined }, today = new Date().toISOString().slice(0, 10)) {
  const [project] = await db.select().from(projects).where(eq(projects.id, input.projectId)).limit(1);
  if (!project) throw new DomainError(404, 'not_found', 'Project not found');
  const list = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.projectId, project.id), isNull(tasks.archivedAt)))
    .orderBy(asc(tasks.sortOrder), asc(tasks.createdAt));
  const known = new Set((await db.select({ key: statuses.key }).from(statuses)).map(s => s.key));
  // должность участника — первая по порядку должностей: по ней при создании проекта подберётся исполнитель
  const links = await db
    .select({ memberId: memberPositions.memberId, positionId: memberPositions.positionId })
    .from(memberPositions)
    .innerJoin(positions, eq(positions.id, memberPositions.positionId))
    .orderBy(asc(positions.sortOrder), asc(positions.name));
  const positionOfMember = new Map<string, string>();
  for (const l of links) if (!positionOfMember.has(l.memberId)) positionOfMember.set(l.memberId, l.positionId);
  const positionOf = (memberId: string) => positionOfMember.get(memberId) ?? null;

  const start = templateBaseDate(project.startDate, list.flatMap(t => [t.startDate, t.dueDate]), today);
  const [template] = await db
    .insert(projectTemplates)
    .values({
      workspaceId: ctx.workspaceId,
      name: input.name,
      description: input.description ?? project.description,
      icon: project.icon,
      color: project.color,
      durationDays: dayFromDate(start, project.dueDate),
      milestones: milestonesToTemplate(project.milestones, start),
      createdBy: ctx.memberId,
    })
    .returning();
  if (list.length) {
    await db.insert(projectTemplateTasks).values(
      list.map((t, i) => ({
        workspaceId: ctx.workspaceId,
        templateId: template!.id,
        title: t.title,
        description: t.description,
        status: templateStatus(t.status, known),
        priority: t.priority,
        startDay: dayFromDate(start, t.startDate),
        dueDay: dayFromDate(start, t.dueDate),
        planHours: t.planHours,
        positionId: t.assigneeId ? positionOf(t.assigneeId) : null,
        labels: t.labels,
        subtasks: subtasksToTemplate(t.subtasks, start, positionOf),
        sortOrder: i + 1,
      })),
    );
  }
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'project_template.created', entity: 'project_template', recordId: template!.id, actorId: ctx.memberId, payload: { record: template, projectId: project.id } });
  return { ...template!, taskCount: list.length, subtaskCount: list.reduce((n, t) => n + countSubtasks(subtasksToTemplate(t.subtasks, start, positionOf)), 0) };
}

export async function updateProjectTemplate(db: Db, ctx: DocCtx, id: string, input: { name?: string | undefined; description?: string | undefined; disabled?: boolean | undefined }) {
  await loadTemplate(db, id);
  const set: Partial<typeof projectTemplates.$inferInsert> = { updatedAt: new Date() };
  if (input.name !== undefined) set.name = input.name;
  if (input.description !== undefined) set.description = input.description;
  if (input.disabled !== undefined) set.disabled = input.disabled;
  const [row] = await db.update(projectTemplates).set(set).where(eq(projectTemplates.id, id)).returning();
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'project_template.updated', entity: 'project_template', recordId: id, actorId: ctx.memberId, payload: { changes: Object.keys(input) } });
  return row!;
}

export async function deleteProjectTemplate(db: Db, ctx: DocCtx, id: string): Promise<void> {
  await loadTemplate(db, id);
  await db.delete(projectTemplates).where(eq(projectTemplates.id, id)); // задачи шаблона — каскадом
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'project_template.deleted', entity: 'project_template', recordId: id, actorId: ctx.memberId, payload: {} });
}

/** Ключ проекта из инициалов названия (как makeKey в интерфейсе); занятый получает суффикс X */
export function projectKeyFromName(name: string, taken: ReadonlySet<string>): string {
  let k = name
    .split(/\s+/)
    .map(w => w[0] || '')
    .join('')
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, 3);
  if (k.length < 2) k = name.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase();
  if (k.length < 2) k = 'PRJ';
  while (taken.has(k.toLowerCase()) && k.length < 10) k += 'X';
  return k;
}

/** Создать проект из шаблона: задачи со сроками от даты старта, исполнители — первые активные участники с нужной должностью
    (нет такого — задача без исполнителя), статус, которого в воркспейсе больше нет, — todo. Всё в одной транзакции запроса. */
export async function createProjectFromTemplate(db: Db, ctx: DocCtx, templateId: string, input: ProjectFromTemplate) {
  const template = await loadTemplate(db, templateId);
  if (template.disabled) throw new DomainError(422, 'template_disabled', 'The project template is disabled');
  const list = await db.select().from(projectTemplateTasks).where(eq(projectTemplateTasks.templateId, templateId)).orderBy(asc(projectTemplateTasks.sortOrder));
  const known = new Set((await db.select({ key: statuses.key }).from(statuses)).map(s => s.key));

  const holders = await db
    .select({ positionId: memberPositions.positionId, memberId: memberPositions.memberId })
    .from(memberPositions)
    .innerJoin(members, eq(members.id, memberPositions.memberId))
    .where(eq(members.status, 'active'))
    .orderBy(asc(members.createdAt), asc(members.id));
  const memberOfPosition = new Map<string, string>();
  for (const h of holders) if (!memberOfPosition.has(h.positionId)) memberOfPosition.set(h.positionId, h.memberId);
  const memberOf = (positionId: string) => memberOfPosition.get(positionId) ?? null;

  const key = input.key ?? projectKeyFromName(input.name, new Set((await db.select({ key: projects.key }).from(projects)).map(p => p.key.toLowerCase())));
  const [{ m } = { m: 0 }] = await db.select({ m: max(projects.sortOrder) }).from(projects);
  const start = input.startDate;
  const [project] = await db
    .insert(projects)
    .values({
      workspaceId: ctx.workspaceId,
      key,
      name: input.name,
      icon: input.icon ?? template.icon,
      color: (input.color ?? template.color) as (typeof projects.$inferInsert)['color'],
      teamId: input.teamId ?? null,
      leadId: input.leadId ?? null,
      startDate: start,
      dueDate: dateFromDay(start, template.durationDays),
      description: input.description ?? template.description,
      milestones: (template.milestones as TemplateMilestone[]).map(x => ({ name: x.name, date: dateFromDay(start, x.day)! })),
      createdBy: ctx.memberId,
      sortOrder: Number(m ?? 0) + 1,
    })
    .returning();
  const people = new Map<string, string>();
  if (ctx.memberId) people.set(ctx.memberId, 'admin');
  if (input.leadId && !people.has(input.leadId)) people.set(input.leadId, 'edit');
  if (people.size) await db.insert(projectMembers).values([...people].map(([memberId, permission]) => ({ workspaceId: ctx.workspaceId, projectId: project!.id, memberId, permission })));
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'project.created', entity: 'project', recordId: project!.id, actorId: ctx.memberId, payload: { record: project, templateId } });
  await db.insert(activity).values({ workspaceId: ctx.workspaceId, actorId: ctx.memberId, verb: 'created project', projectId: project!.id, extra: `from template ${template.name}` });

  let order = 0;
  for (const t of list) {
    const taskKey = await issueTaskKey(db, project!.id);
    const [row] = await db
      .insert(tasks)
      .values({
        workspaceId: ctx.workspaceId,
        key: taskKey,
        projectId: project!.id,
        module: 'general',
        title: t.title,
        description: sanitizeRichText(t.description),
        status: templateStatus(t.status, known),
        priority: t.priority,
        assigneeId: t.positionId ? memberOf(t.positionId) : null,
        startDate: dateFromDay(start, t.startDay),
        dueDate: dateFromDay(start, t.dueDay),
        planHours: t.planHours,
        labels: t.labels,
        subtasks: subtasksFromTemplate(t.subtasks, start, memberOf, uuidv7),
        sortOrder: ++order,
        createdBy: ctx.memberId,
      })
      .returning();
    await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'task.created', entity: 'task', recordId: row!.id, actorId: ctx.memberId, payload: { record: row } });
  }
  return { project: project!, taskCount: list.length };
}
