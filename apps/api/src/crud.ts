/* Фабрика REST-ресурса арендатора: list (фильтры/сортировка/пагинация/поиск), get, create, patch, delete/archive, restore.
   Каждая запись пишет событие в outbox в той же транзакции. Доступ к данным — только через c.var.db (контекст арендатора + RLS):
   в запросах нет ручных фильтров по workspace_id — изоляцию гарантирует БД. */
import { zValidator } from '@hono/zod-validator';
import { and, asc, count, desc, eq, ilike, isNotNull, isNull, or, type SQL } from 'drizzle-orm';
import { getTableColumns } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { recordEvent, type Db, type Tx } from '@gr8r/db';
import { idParam, type ListQuery, type Page, type Role } from '@gr8r/shared';
import type { z } from 'zod';
import { AppError, badRequest, notFound } from './errors';
import { hasRole, requireRole } from './middleware';
import type { AppEnv } from './types';

/** Контекст, который получают хуки сущности */
export interface Ctx {
  c: Context<AppEnv>;
  db: Db;
  tx: Tx;
  workspaceId: string;
  memberId: string;
  role: Role;
}

export const ctxOf = (c: Context<AppEnv>): Ctx => ({ c, db: c.get('db'), tx: c.get('tx'), workspaceId: c.get('workspaceId'), memberId: c.get('memberId'), role: c.get('role') });

type AnyTable = PgTable & { id: PgColumn; workspaceId: PgColumn };
type Row<T extends PgTable> = T['$inferSelect'];
type AnyRec = Record<string, unknown>;

export interface CrudOptions<T extends AnyTable, CS extends z.ZodType, US extends z.ZodType, QS extends z.ZodType<ListQuery>, E extends object> {
  /** Префикс событий и имя сущности: 'task' → task.created / task.updated / task.archived / task.deleted */
  entity: string;
  table: T;
  create: CS;
  update: US;
  query: QS;
  /** Колонки, по которым разрешена сортировка (ключ = имя в query ?sort=) */
  sortable: Record<string, PgColumn>;
  defaultSort?: string;
  /** Колонки для поиска ?q= */
  search?: PgColumn[];
  /** Фильтры списка из проверенного query */
  filters?: (q: z.output<QS>, ctx: Ctx) => (SQL | undefined)[];
  /** Постоянное ограничение видимости (например, уведомления только адресату) */
  scope?: (ctx: Ctx) => SQL | undefined;
  /** Отключённые операции отвечают 405 */
  disabled?: ('create' | 'update' | 'delete')[];
  /** Минимальная роль для записи (по умолчанию member; guest — только чтение) */
  writeRole?: Role;
  /** Подготовка значений вставки (ключи, значения по умолчанию, проверки ссылок). Возвращает колонки строки без workspaceId */
  prepareCreate?: (ctx: Ctx, body: z.output<CS>) => Promise<AnyRec> | AnyRec;
  afterCreate?: (ctx: Ctx, row: Row<T>, body: z.output<CS>) => Promise<void> | void;
  /** Подготовка патча: может дополнить его (completed_at и т.п.) */
  prepareUpdate?: (ctx: Ctx, existing: Row<T>, body: z.output<US>) => Promise<AnyRec> | AnyRec;
  afterUpdate?: (ctx: Ctx, before: Row<T>, after: Row<T>, body: z.output<US>) => Promise<void> | void;
  /** Проверка перед удалением/архивированием (бросьте AppError, чтобы запретить) */
  beforeDelete?: (ctx: Ctx, row: Row<T>) => Promise<void> | void;
  afterDelete?: (ctx: Ctx, row: Row<T>) => Promise<void> | void;
  /** Дополнение строк ответа вычисляемыми полями (участники проекта, реакции…) */
  decorate?: (ctx: Ctx, rows: Row<T>[]) => Promise<(Row<T> & E)[]>;
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, m => '\\' + m);

/** Поля, не попадающие в патч/события вручную */
const SERVER_FIELDS = ['id', 'workspaceId', 'createdAt'];

/** Разница значений для события *.updated: { поле: { from, to } } */
function diff(before: AnyRec, after: AnyRec): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of Object.keys(after)) {
    if (k === 'updatedAt' || k === 'lastActivityAt') continue;
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) out[k] = { from: before[k], to: after[k] };
  }
  return out;
}

export function crud<T extends AnyTable, CS extends z.ZodType, US extends z.ZodType, QS extends z.ZodType<ListQuery>, E extends object = {}>(
  o: CrudOptions<T, CS, US, QS, E>,
) {
  const table = o.table as unknown as AnyTable & Record<string, PgColumn>;
  const cols = getTableColumns(table) as Record<string, PgColumn>;
  const hasArchive = 'archivedAt' in cols;
  const hasUpdated = 'updatedAt' in cols;
  const off = (op: 'create' | 'update' | 'delete') => {
    if (o.disabled?.includes(op)) throw new AppError(405, 'method_not_allowed', `Operation "${op}" is not supported for ${o.entity}`);
  };
  const write = requireRole(o.writeRole ?? 'member');
  const decorate = async (ctx: Ctx, rows: Row<T>[]): Promise<(Row<T> & E)[]> => (o.decorate ? o.decorate(ctx, rows) : (rows as (Row<T> & E)[]));

  const parseSort = (sort: string | undefined): SQL[] => {
    const parts = (sort ?? o.defaultSort ?? '-createdAt').split(',').filter(Boolean);
    const out: SQL[] = [];
    for (const p of parts) {
      const desc_ = p.startsWith('-');
      const col = o.sortable[desc_ ? p.slice(1) : p];
      if (!col) throw badRequest('invalid_sort', `Cannot sort by "${p.replace(/^-/, '')}". Allowed: ${Object.keys(o.sortable).join(', ')}`);
      out.push(desc_ ? desc(col) : asc(col));
    }
    out.push(desc(table.id)); // стабильный порядок страниц
    return out;
  };

  const baseWhere = (ctx: Ctx, q: ListQuery & AnyRec): SQL | undefined => {
    const conds: (SQL | undefined)[] = [o.scope?.(ctx), ...(o.filters?.(q as z.output<QS>, ctx) ?? [])];
    if (q.q && o.search?.length) conds.push(or(...o.search.map(col => ilike(col, `%${escapeLike(q.q!)}%`))));
    if (hasArchive) {
      if (q.archived === 'exclude') conds.push(isNull(cols.archivedAt));
      else if (q.archived === 'only') conds.push(isNotNull(cols.archivedAt));
    }
    return and(...conds);
  };

  const byId = (ctx: Ctx, id: string) => and(eq(table.id, id), o.scope?.(ctx));

  const app = new Hono<AppEnv>()
    // ---- список ----
    .get('/', zValidator('query', o.query, validationHook), async c => {
      const ctx = ctxOf(c);
      const q = c.req.valid('query' as never) as ListQuery & AnyRec;
      const where = baseWhere(ctx, q);
      const rows = (await ctx.db.select().from(table).where(where).orderBy(...parseSort(q.sort)).limit(q.limit).offset(q.offset)) as Row<T>[];
      const [{ n }] = await ctx.db.select({ n: count() }).from(table).where(where);
      const page: Page<Row<T> & E> = { items: await decorate(ctx, rows), total: n, limit: q.limit, offset: q.offset };
      return c.json(page);
    })
    // ---- одна запись ----
    .get('/:id', zValidator('param', idParam, validationHook), async c => {
      const ctx = ctxOf(c);
      const { id } = c.req.valid('param');
      const [row] = (await ctx.db.select().from(table).where(byId(ctx, id)).limit(1)) as Row<T>[];
      if (!row) throw notFound(o.entity);
      return c.json((await decorate(ctx, [row]))[0]!);
    })
    // ---- создание ----
    .post('/', write, zValidator('json', o.create, validationHook), async c => {
      off('create');
      const ctx = ctxOf(c);
      const body = c.req.valid('json' as never) as z.output<CS>;
      const base = { ...(body as AnyRec) };
      const values: AnyRec = { ...base, ...(o.prepareCreate ? await o.prepareCreate(ctx, body) : {}), workspaceId: ctx.workspaceId };
      for (const k of Object.keys(values)) if (values[k] === undefined || !(k in cols)) delete values[k]; // не-колонки (members, contactIds…) обрабатывают хуки
      const [row] = (await ctx.db.insert(table).values(values as never).returning()) as Row<T>[];
      await recordEvent(ctx.db, { workspaceId: ctx.workspaceId, type: `${o.entity}.created`, entity: o.entity, recordId: (row as AnyRec).id as string, actorId: ctx.memberId, payload: { record: row } });
      await o.afterCreate?.(ctx, row!, body);
      return c.json((await decorate(ctx, [row!]))[0]!, 201);
    })
    // ---- изменение ----
    .patch('/:id', write, zValidator('param', idParam, validationHook), zValidator('json', o.update, validationHook), async c => {
      off('update');
      const ctx = ctxOf(c);
      const { id } = c.req.valid('param');
      const body = c.req.valid('json' as never) as z.output<US>;
      const [existing] = (await ctx.db.select().from(table).where(byId(ctx, id)).limit(1).for('update')) as Row<T>[];
      if (!existing) throw notFound(o.entity);
      const patch: AnyRec = { ...(body as AnyRec), ...(o.prepareUpdate ? await o.prepareUpdate(ctx, existing, body) : {}) };
      for (const k of Object.keys(patch)) if (patch[k] === undefined || SERVER_FIELDS.includes(k) || !(k in cols)) delete patch[k];
      let after = existing;
      if (Object.keys(patch).length) {
        if (hasUpdated) patch.updatedAt = new Date();
        [after] = (await ctx.db.update(table).set(patch as never).where(eq(table.id, id)).returning()) as Row<T>[];
      }
      const changes = diff(existing as AnyRec, after as AnyRec);
      if (Object.keys(changes).length) {
        await recordEvent(ctx.db, { workspaceId: ctx.workspaceId, type: `${o.entity}.updated`, entity: o.entity, recordId: id, actorId: ctx.memberId, payload: { changes } });
      }
      await o.afterUpdate?.(ctx, existing, after!, body);
      return c.json((await decorate(ctx, [after!]))[0]!);
    })
    // ---- удаление: мягкое (archived_at) или ?hard=true (только admin) ----
    .delete('/:id', write, zValidator('param', idParam, validationHook), async c => {
      off('delete');
      const ctx = ctxOf(c);
      const { id } = c.req.valid('param');
      const hard = ['true', '1'].includes(c.req.query('hard') ?? '') || !hasArchive;
      if (hard && hasArchive && !hasRole(c, 'admin')) throw new AppError(403, 'forbidden', 'Permanent deletion requires the admin role');
      const [existing] = (await ctx.db.select().from(table).where(byId(ctx, id)).limit(1).for('update')) as Row<T>[];
      if (!existing) throw notFound(o.entity);
      await o.beforeDelete?.(ctx, existing);
      if (hard) {
        await ctx.db.delete(table).where(eq(table.id, id));
        await recordEvent(ctx.db, { workspaceId: ctx.workspaceId, type: `${o.entity}.deleted`, entity: o.entity, recordId: id, actorId: ctx.memberId, payload: {} });
        await o.afterDelete?.(ctx, existing);
        return c.json({ id, deleted: true as const, archived: false as const });
      }
      if (!(existing as AnyRec).archivedAt) {
        await ctx.db.update(table).set({ archivedAt: new Date(), ...(hasUpdated ? { updatedAt: new Date() } : {}) } as never).where(eq(table.id, id));
        await recordEvent(ctx.db, { workspaceId: ctx.workspaceId, type: `${o.entity}.archived`, entity: o.entity, recordId: id, actorId: ctx.memberId, payload: {} });
        await o.afterDelete?.(ctx, existing);
      }
      return c.json({ id, deleted: false as const, archived: true as const });
    })
    // ---- восстановление из архива ----
    .post('/:id/restore', write, zValidator('param', idParam, validationHook), async c => {
      const ctx = ctxOf(c);
      const { id } = c.req.valid('param');
      if (!hasArchive) throw new AppError(405, 'method_not_allowed', `${o.entity} cannot be archived`);
      const [existing] = (await ctx.db.select().from(table).where(byId(ctx, id)).limit(1).for('update')) as Row<T>[];
      if (!existing) throw notFound(o.entity);
      let row = existing;
      if ((existing as AnyRec).archivedAt) {
        [row] = (await ctx.db.update(table).set({ archivedAt: null, ...(hasUpdated ? { updatedAt: new Date() } : {}) } as never).where(eq(table.id, id)).returning()) as Row<T>[];
        await recordEvent(ctx.db, { workspaceId: ctx.workspaceId, type: `${o.entity}.restored`, entity: o.entity, recordId: id, actorId: ctx.memberId, payload: {} });
      }
      return c.json((await decorate(ctx, [row!]))[0]!);
    });

  return app;
}

/** Ошибки zod → единый формат 400 */
export function validationHook(result: { success: boolean; error?: { issues: ReadonlyArray<{ path: PropertyKey[]; message: string }> } }) {
  if (!result.success) {
    const issues = result.error!.issues.map(i => ({ path: i.path.map(String).join('.'), message: i.message }));
    throw new AppError(400, 'validation_error', issues[0] ? `${issues[0].path || 'request'}: ${issues[0].message}` : 'Invalid request', { issues });
  }
}
