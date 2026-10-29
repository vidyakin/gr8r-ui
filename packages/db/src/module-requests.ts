/* Заявки арендатора на модули («Нужно больше?», задача 1208, docs/architecture/licensing.md). Арендатор создаёт заявку и видит свои
   (таблица module_requests под RLS), оператор читает все и ведёт статус функциями app_operator_requests / app_operator_set_request.
   Если у установки задан OPERATOR_LEAD_HOOK_URL, воркер дублирует заявку лидом в вебхук лидов (задача module_request.notify, с повтором). */
import { desc, eq, sql as dsql } from 'drizzle-orm';
import type { ModuleRequestBody, ModuleRequestRow, OperatorModuleRequest, RequestStatus } from '@gr8r/shared';
import type { Db, Sql } from './client';
import { call } from './licensing';
import { recordEvent } from './events';
import { jobs } from './schema';
import { moduleRequests } from './schema/licensing';

export const MODULE_REQUEST_JOB = 'module_request.notify';

const view = (r: typeof moduleRequests.$inferSelect): ModuleRequestRow => ({
  id: r.id,
  modules: r.modules,
  comment: r.comment,
  contact: r.contact,
  status: r.status as RequestStatus,
  createdAt: r.createdAt.toISOString(),
});

/** Создать заявку текущего арендатора и поставить в очередь дублирование в вебхук оператора (в той же транзакции) */
export async function createModuleRequest(db: Db, ctx: { workspaceId: string; memberId: string }, body: ModuleRequestBody): Promise<ModuleRequestRow> {
  const [row] = await db
    .insert(moduleRequests)
    .values({ workspaceId: ctx.workspaceId, requestedBy: ctx.memberId, modules: [...new Set(body.modules)], comment: body.comment || null, contact: body.contact })
    .returning();
  await db.insert(jobs).values({ workspaceId: ctx.workspaceId, type: MODULE_REQUEST_JOB, payload: { requestId: row!.id } });
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'module_request.created', entity: 'module_request', recordId: row!.id, actorId: ctx.memberId, payload: { modules: row!.modules } });
  return view(row!);
}

/** Заявки текущего арендатора, новые первыми */
export async function listMyModuleRequests(db: Db): Promise<ModuleRequestRow[]> {
  return (await db.select().from(moduleRequests).orderBy(desc(moduleRequests.createdAt)).limit(100)).map(view);
}

/** Заявка для воркера: сама заявка, название и владелец арендатора (под app_worker) */
export async function loadRequestForHook(db: Db, id: string) {
  const rows = (await db.execute(dsql`
    select r.id, r.modules, r.comment, r.contact, r.hook_sent_at as "hookSentAt", w.name as "workspaceName", w.slug as "workspaceSlug",
           (select m.name from members m where m.workspace_id = r.workspace_id and m.id = r.requested_by) as "requestedBy"
    from module_requests r join workspaces w on w.id = r.workspace_id where r.id = ${id}::uuid`)) as unknown as {
    id: string;
    modules: string[];
    comment: string | null;
    contact: string;
    hookSentAt: string | null;
    workspaceName: string;
    workspaceSlug: string;
    requestedBy: string | null;
  }[];
  return rows[0] ?? null;
}

export async function markRequestHookSent(db: Db, id: string): Promise<void> {
  await db.update(moduleRequests).set({ hookSentAt: new Date() }).where(eq(moduleRequests.id, id));
}

/* ---- Оператор ---- */

export const listOperatorRequests = (sql: Sql, userId: string, status: RequestStatus | null): Promise<OperatorModuleRequest[]> =>
  call(sql, userId, async tx => (await tx`select app_operator_requests(${status}::text) as r`)[0]!.r as OperatorModuleRequest[]);

export const setOperatorRequestStatus = (sql: Sql, userId: string, id: string, status: RequestStatus, note: string | null): Promise<unknown> =>
  call(sql, userId, async tx => (await tx`select app_operator_set_request(${id}::uuid, ${status}::text, ${note}::text) as r`)[0]!.r);
