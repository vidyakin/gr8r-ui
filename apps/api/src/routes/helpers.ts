import { and, inArray, max, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { activity, notifications, resolveAttribution, tasks } from '@gr8r/db';
import type { Ctx } from '../crud';
import { AppError } from '../errors';

/** Запись в ленту активности (в той же транзакции, что и изменение) */
export async function addActivity(ctx: Ctx, a: { verb: string; taskId?: string | null; projectId?: string | null; extra?: string }) {
  await ctx.db.insert(activity).values({ workspaceId: ctx.workspaceId, actorId: ctx.memberId, verb: a.verb, taskId: a.taskId ?? null, projectId: a.projectId ?? null, extra: a.extra ?? '' });
}

/** Уведомление участнику; себе не отправляется */
export async function notify(ctx: Ctx, n: { to: string | null | undefined; type: 'mention' | 'assign' | 'comment' | 'update'; text: string; snippet?: string; taskId?: string | null; projectId?: string | null }) {
  if (!n.to || n.to === ctx.memberId) return;
  await ctx.db.insert(notifications).values({
    workspaceId: ctx.workspaceId,
    recipientId: n.to,
    type: n.type,
    actorId: ctx.memberId,
    taskId: n.taskId ?? null,
    projectId: n.projectId ?? null,
    text: n.text,
    snippet: n.snippet ?? '',
  });
}

type AnyPgTable = PgTable;

/** Следующее значение sort_order: max + 1 в пределах условия */
export async function nextOrder(ctx: Ctx, table: AnyPgTable & { sortOrder: PgColumn }, where?: SQL): Promise<number> {
  const [r] = await ctx.db.select({ m: max(table.sortOrder) }).from(table as PgTable).where(where);
  return Number(r?.m ?? 0) + 1;
}

/** Все id должны быть задачами этого воркспейса (RLS скрывает чужие) */
export async function assertTasksExist(ctx: Ctx, ids: string[]) {
  if (!ids.length) return;
  const unique = [...new Set(ids)];
  const found = await ctx.db.select({ id: tasks.id }).from(tasks).where(and(inArray(tasks.id, unique)));
  if (found.length !== unique.length) throw new AppError(422, 'invalid_reference', 'One or more dependencies refer to tasks that do not exist');
}

/** Источник и кампания записи (задача 1177): {} — в теле нет ни одного из полей; текст `source` ищет источник по названию */
export async function attributionPatch(
  ctx: Ctx,
  body: { sourceId?: string | null | undefined; campaignId?: string | null | undefined; source?: string | undefined },
  existing?: { sourceId: string | null; campaignId: string | null },
) {
  const byId = body.sourceId !== undefined || body.campaignId !== undefined;
  if (!byId && body.source === undefined) return {};
  return resolveAttribution(ctx.db, ctx.workspaceId, { sourceId: body.sourceId, campaignId: body.campaignId, sourceName: byId ? undefined : body.source }, existing);
}
