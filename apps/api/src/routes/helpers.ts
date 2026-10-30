import { and, eq, exists, inArray, max, not, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { activity, favorites, members, notifications, resolveAttribution, tasks, users, type AttributionState } from '@gr8r/db';
import { notifyEnabled } from '@gr8r/shared';
import type { Ctx } from '../crud';
import { AppError } from '../errors';

/** Запись в ленту активности (в той же транзакции, что и изменение) */
export async function addActivity(ctx: Ctx, a: { verb: string; taskId?: string | null; projectId?: string | null; extra?: string }) {
  await ctx.db.insert(activity).values({ workspaceId: ctx.workspaceId, actorId: ctx.memberId, verb: a.verb, taskId: a.taskId ?? null, projectId: a.projectId ?? null, extra: a.extra ?? '' });
}

/** Личный переключатель уведомления внутри приложения (Настройки → Уведомления) по типу; типы без переключателя приходят всегда.
    Автоматизации (воркер, insertNotification) — явное действие сценария, переключатели на них не действуют */
const PREF_OF_TYPE: Partial<Record<'mention' | 'assign' | 'comment' | 'update', string>> = { assign: 'assign_self', update: 'assign_status' };

/** Уведомление участнику; себе не отправляется; учитывает личные настройки получателя */
export async function notify(ctx: Ctx, n: { to: string | null | undefined; type: 'mention' | 'assign' | 'comment' | 'update'; text: string; snippet?: string; taskId?: string | null; projectId?: string | null }) {
  if (!n.to || n.to === ctx.memberId) return;
  const key = PREF_OF_TYPE[n.type];
  if (key) {
    const [r] = await ctx.db.select({ prefs: users.prefs }).from(members).innerJoin(users, eq(users.id, members.userId)).where(eq(members.id, n.to)).limit(1);
    if (r && !notifyEnabled(r.prefs, key)) return;
  }
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
  body: { sourceId?: string | null | undefined; campaignId?: string | null | undefined; source?: string | undefined; referrerCompanyId?: string | null | undefined; referrerContactId?: string | null | undefined },
  existing?: AttributionState,
) {
  const byId = body.sourceId !== undefined || body.campaignId !== undefined;
  if (!byId && body.source === undefined && body.referrerCompanyId === undefined && body.referrerContactId === undefined) return {};
  return resolveAttribution(ctx.db, ctx.workspaceId, { sourceId: body.sourceId, campaignId: body.campaignId, sourceName: byId ? undefined : body.source, referrerCompanyId: body.referrerCompanyId, referrerContactId: body.referrerContactId }, existing);
}


/* ---- Личное избранное: хранится по участнику (favorites), а не флагом на записи ---- */
export type FavEntity = 'project' | 'task';

/** Какие из записей в избранном у текущего участника */
export async function favoriteSet(ctx: Ctx, entity: FavEntity, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await ctx.db
    .select({ id: favorites.recordId })
    .from(favorites)
    .where(and(eq(favorites.memberId, ctx.memberId), eq(favorites.entity, entity), inArray(favorites.recordId, ids)));
  return new Set(rows.map(r => r.id));
}

/** Поставить или снять избранное текущего участника */
export async function setFavorite(ctx: Ctx, entity: FavEntity, recordId: string, on: boolean | undefined): Promise<void> {
  if (on === undefined) return;
  if (on) await ctx.db.insert(favorites).values({ workspaceId: ctx.workspaceId, memberId: ctx.memberId, entity, recordId }).onConflictDoNothing();
  else await ctx.db.delete(favorites).where(and(eq(favorites.memberId, ctx.memberId), eq(favorites.entity, entity), eq(favorites.recordId, recordId)));
}

/** Условие списка «только избранное / без избранного» для текущего участника */
export function favoriteFilter(ctx: Ctx, entity: FavEntity, idCol: PgColumn, want: boolean | undefined): SQL | undefined {
  if (want === undefined) return undefined;
  const sub = ctx.db.select({ one: favorites.recordId }).from(favorites).where(and(eq(favorites.memberId, ctx.memberId), eq(favorites.entity, entity), eq(favorites.recordId, idCol)));
  return want ? exists(sub) : not(exists(sub));
}
