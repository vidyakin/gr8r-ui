/* Модули задач: у каждого модуля (production, services) в воркспейсе есть свой системный проект.
   Задача модуля обязана лежать в проекте того же модуля — иначе её не найти ни в одном списке.
   Системный проект создаётся лениво: при первом обращении к модулю (создание задачи, проверка). */
import { and, eq, sql } from 'drizzle-orm';
import type { ProjectColor, TaskModule } from '@gr8r/shared';
import type { Db } from './client';
import { DomainError } from './errors';
import { projects } from './schema';

/** Модули со системным проектом (у general проекты пользовательские) */
export const MODULE_PROJECTS = {
  production: { key: 'PROD', name: 'Production', icon: 'factory', color: 'violet', description: 'Tasks of the production module: operations, work orders and releases.' },
  services: { key: 'SERV', name: 'Services', icon: 'wrench', color: 'teal', description: 'Tasks of the services module: orders, works and acts.' },
} as const satisfies Record<Exclude<TaskModule, 'general'>, { key: string; name: string; icon: string; color: ProjectColor; description: string }>;

export type ModuleProjectKey = keyof typeof MODULE_PROJECTS;

/** Системный проект модуля; создаётся, если его ещё нет. Ключ проекта уникален в воркспейсе — занятый ключ обходим суффиксом. */
export async function ensureModuleProject(db: Db, workspaceId: string, module: ModuleProjectKey): Promise<string> {
  const [found] = await db.select({ id: projects.id }).from(projects).where(and(eq(projects.workspaceId, workspaceId), eq(projects.module, module))).limit(1);
  if (found) return found.id;
  const meta = MODULE_PROJECTS[module];
  for (let i = 0; i < 20; i++) {
    const key = i === 0 ? meta.key : `${meta.key}${i + 1}`;
    const [row] = await db
      .insert(projects)
      .values({ workspaceId, key, name: meta.name, icon: meta.icon, color: meta.color, status: 'active', module, description: meta.description, sortOrder: 1000 })
      .onConflictDoNothing()
      .returning({ id: projects.id });
    if (row) return row.id;
  }
  throw new DomainError(422, 'module_project_unavailable', `Cannot create the ${module} project: too many projects use the same key`);
}

/** Системные проекты всех модулей */
export async function ensureModuleProjects(db: Db, workspaceId: string): Promise<void> {
  for (const module of Object.keys(MODULE_PROJECTS) as ModuleProjectKey[]) await ensureModuleProject(db, workspaceId, module);
}

/** Модуль проекта (у обычных проектов — general) */
export async function projectModule(db: Db, projectId: string): Promise<TaskModule> {
  const [row] = await db.select({ module: projects.module }).from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!row) throw new DomainError(422, 'invalid_reference', 'Project not found');
  return row.module;
}

/** Модуль задачи должен совпадать с модулем её проекта */
export function assertTaskModule(taskModule: TaskModule, projectModule: TaskModule): void {
  if (taskModule !== projectModule) throw new DomainError(422, 'module_mismatch', `A task of the ${taskModule} module must be in a project of the same module`);
}

/** Ключ задачи (SERV-3): счётчик проекта увеличивается атомарно (строка блокируется до конца транзакции),
    поэтому ключи не повторяются и идут подряд. Ключ принадлежит проекту: SERV-1 — первая задача модуля services */
export async function issueTaskKey(db: Db, projectId: string): Promise<string> {
  const [p] = await db
    .update(projects)
    .set({ taskCounter: sql`${projects.taskCounter} + 1`, lastActivityAt: new Date() })
    .where(eq(projects.id, projectId))
    .returning({ key: projects.key, n: projects.taskCounter });
  if (!p) throw new DomainError(422, 'invalid_reference', 'Project not found');
  return `${p.key}-${p.n}`;
}
