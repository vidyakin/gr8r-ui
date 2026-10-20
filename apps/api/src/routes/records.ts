/* Записи пользовательских сущностей: /data/:entity — CRUD, фильтры/сортировка/поиск по data (jsonb) — и /data-search
   (поиск по записям всех пользовательских сущностей для палитры команд).

   Параметры списка:
     filter=ключ:оператор:значение   (повторяется; все условия через AND)
       eq, ne, gt, gte, lt, lte — сравнение (числа — numeric, даты — ISO-текст), in — список через запятую,
       contains — подстрока (текст) или элемент (multi_select / refs), empty / notempty — без значения.
     sort=ключ,-ключ2                (ключ поля, createdAt или updatedAt)
     q=текст                         (подстрока в текстовых полях и заголовке)
   Выражения строятся из ключей, проверенных по метаданным сущности и регулярке FIELD_KEY_RE (в SQL попадают только они),
   значения всегда идут параметрами. Выражение совпадает с индексом поля filterable (см. packages/db/src/meta.ts). */
import { zValidator } from '@hono/zod-validator';
import { and, asc, count, desc, eq, isNotNull, isNull, or, sql, type SQL } from 'drizzle-orm';
import { Hono } from 'hono';
import { entities, fieldExprSql, fields, recordEvent, records } from '@gr8r/db';
import { dataSearchQuery, idParam, isMultiType, isNumericType, recordCreate, recordQuery, recordUpdate, SEARCHABLE_TYPES, type FieldType, type FilterOp, FILTER_OPS } from '@gr8r/shared';
import { z } from 'zod';
import { ctxOf, validationHook } from '../crud';
import { AppError, badRequest, notFound } from '../errors';
import { hasRole, requireRole } from '../middleware';
import { loadFields, loadEntity, mergeData, validateData, type EntityRow, type FieldRow } from '../meta/service';
import type { AppEnv } from '../types';

const entityParam = z.object({ entity: z.string().min(1).max(64) });
const recordParam = z.object({ entity: z.string().min(1).max(64), id: idParam.shape.id });
const write = requireRole('member');

/** Сущность для записей: только пользовательская (системными занимаются их собственные маршруты) */
async function dataEntity(ctx: ReturnType<typeof ctxOf>, ref: string): Promise<EntityRow> {
  const e = await loadEntity(ctx, ref);
  if (e.kind === 'system') throw new AppError(422, 'system_entity', `"${e.key}" is a built-in entity: use its own endpoint and the "custom" property`);
  return e;
}

const raw = (fieldType: FieldType, key: string) => sql.raw(fieldExprSql('data', key, fieldType));

/* ---------------- фильтры ---------------- */

const TEXTY: FieldType[] = ['text', 'long_text', 'email', 'url', 'phone'];
const ORDERED: FieldType[] = ['number', 'money', 'percent', 'date', 'datetime'];
const OPS: Record<FieldType, FilterOp[]> = {
  text: ['eq', 'ne', 'contains', 'in', 'empty', 'notempty'],
  long_text: ['contains', 'empty', 'notempty'],
  email: ['eq', 'ne', 'contains', 'in', 'empty', 'notempty'],
  url: ['eq', 'ne', 'contains', 'empty', 'notempty'],
  phone: ['eq', 'ne', 'contains', 'empty', 'notempty'],
  number: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'empty', 'notempty'],
  money: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'empty', 'notempty'],
  percent: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'empty', 'notempty'],
  date: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'empty', 'notempty'],
  datetime: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'empty', 'notempty'],
  boolean: ['eq', 'ne', 'empty', 'notempty'],
  select: ['eq', 'ne', 'in', 'empty', 'notempty'],
  multi_select: ['contains', 'in', 'empty', 'notempty'],
  user: ['eq', 'ne', 'in', 'empty', 'notempty'],
  ref: ['eq', 'ne', 'in', 'empty', 'notempty'],
  refs: ['contains', 'in', 'empty', 'notempty'],
};

function filterCondition(spec: string, byKey: Map<string, FieldRow>): SQL {
  const i = spec.indexOf(':');
  const j = i < 0 ? -1 : spec.indexOf(':', i + 1);
  const key = i < 0 ? spec : spec.slice(0, i);
  const op = (j < 0 ? spec.slice(i + 1) : spec.slice(i + 1, j)) as FilterOp;
  const value = j < 0 ? '' : spec.slice(j + 1);
  const f = byKey.get(key);
  if (!f) throw badRequest('invalid_filter', `Unknown field "${key}" in filter`);
  if (!(FILTER_OPS as readonly string[]).includes(op)) throw badRequest('invalid_filter', `Unknown operator "${op}"; allowed: ${FILTER_OPS.join(', ')}`);
  const type = f.type as FieldType;
  if (!OPS[type].includes(op)) throw badRequest('invalid_filter', `Operator "${op}" is not supported for ${type} field "${key}"`);
  const multi = isMultiType(type);
  const expr = raw(type, key);
  const jsonExpr = sql.raw(`(data->'${key}')`);

  if (op === 'empty') return multi ? sql`(${jsonExpr} is null or ${jsonExpr} = '[]'::jsonb)` : sql`${expr} is null`;
  if (op === 'notempty') return multi ? sql`(${jsonExpr} is not null and ${jsonExpr} <> '[]'::jsonb)` : sql`${expr} is not null`;
  if (value === '') throw badRequest('invalid_filter', `Filter "${key}:${op}" needs a value`);

  /** Значение сравнения в типе поля */
  const typed = (v: string): SQL => {
    if (isNumericType(type)) {
      if (!Number.isFinite(Number(v))) throw badRequest('invalid_filter', `"${v}" is not a number (field "${key}")`);
      return sql`${v}::numeric`;
    }
    if (type === 'boolean' && v !== 'true' && v !== 'false') throw badRequest('invalid_filter', `Field "${key}" expects true or false`);
    if (ORDERED.includes(type) && (type === 'date' ? !/^\d{4}-\d{2}-\d{2}$/.test(v) : !/^\d{4}-\d{2}-\d{2}T/.test(v))) throw badRequest('invalid_filter', `"${v}" is not a valid ${type} (field "${key}")`);
    return sql`${v}::text`;
  };
  const list = () => value.split(',').map(s => s.trim()).filter(Boolean);

  if (multi) {
    // Элемент массива: data->'k' @> '["v"]'
    const anyOf = (vals: string[]) => or(...vals.map(v => sql`${jsonExpr} @> ${JSON.stringify([v])}::jsonb`))!;
    return op === 'in' ? anyOf(list()) : anyOf([value]);
  }
  switch (op) {
    case 'eq':
      return sql`${expr} = ${typed(value)}`;
    case 'ne':
      return sql`(${expr} is distinct from ${typed(value)})`;
    case 'gt':
      return sql`${expr} > ${typed(value)}`;
    case 'gte':
      return sql`${expr} >= ${typed(value)}`;
    case 'lt':
      return sql`${expr} < ${typed(value)}`;
    case 'lte':
      return sql`${expr} <= ${typed(value)}`;
    case 'in':
      return sql`${expr} in (${sql.join(list().map(typed), sql`, `)})`;
    case 'contains':
      return TEXTY.includes(type) ? sql`${expr} ilike ${'%' + value.replace(/[\\%_]/g, m => '\\' + m) + '%'}` : sql`false`;
    default:
      throw badRequest('invalid_filter', `Unsupported operator "${op}"`);
  }
}

const likeAny = (cols: SQL[], q: string) => or(...cols.map(c => sql`${c} ilike ${'%' + q.replace(/[\\%_]/g, m => '\\' + m) + '%'}`))!;

/** Поля, по которым работает поиск q: заголовок и текстовые поля */
const searchCols = (e: EntityRow, defs: FieldRow[]) =>
  defs.filter(f => SEARCHABLE_TYPES.includes(f.type as FieldType) || f.key === e.titleField).map(f => sql.raw(`(data->>'${f.key}')`));

function orderBy(sort: string | undefined, byKey: Map<string, FieldRow>): SQL[] {
  const out: SQL[] = [];
  for (const p of (sort ?? 'createdAt').split(',').filter(Boolean)) {
    const dsc = p.startsWith('-');
    const key = dsc ? p.slice(1) : p;
    if (key === 'createdAt' || key === 'updatedAt') out.push(dsc ? desc(records[key]) : asc(records[key]));
    else {
      const f = byKey.get(key);
      if (!f) throw badRequest('invalid_sort', `Cannot sort by "${key}": unknown field`);
      out.push(sql`${raw(f.type as FieldType, key)} ${sql.raw(dsc ? 'desc' : 'asc')} nulls last`);
    }
  }
  out.push(asc(records.id)); // стабильный порядок страниц
  return out;
}

const recordsRoutes = new Hono<AppEnv>()
  // ---- список ----
  .get('/:entity', zValidator('param', entityParam, validationHook), zValidator('query', recordQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const e = await dataEntity(ctx, c.req.valid('param').entity);
    const q = c.req.valid('query');
    const defs = await loadFields(ctx, e.id);
    const byKey = new Map(defs.map(f => [f.key, f]));
    const conds: (SQL | undefined)[] = [eq(records.entityId, e.id), ...q.filter.map(s => filterCondition(s, byKey))];
    if (q.q) conds.push(likeAny(searchCols(e, defs), q.q));
    if (q.archived === 'exclude') conds.push(isNull(records.archivedAt));
    else if (q.archived === 'only') conds.push(isNotNull(records.archivedAt));
    const where = and(...conds);
    const items = await ctx.db.select().from(records).where(where).orderBy(...orderBy(q.sort, byKey)).limit(q.limit).offset(q.offset);
    const [{ n }] = await ctx.db.select({ n: count() }).from(records).where(where);
    return c.json({ items, total: n, limit: q.limit, offset: q.offset });
  })
  .get('/:entity/:id', zValidator('param', recordParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const p = c.req.valid('param');
    const e = await dataEntity(ctx, p.entity);
    const [row] = await ctx.db.select().from(records).where(and(eq(records.id, p.id), eq(records.entityId, e.id))).limit(1);
    if (!row) throw notFound('record');
    return c.json(row);
  })
  // ---- создание ----
  .post('/:entity', write, zValidator('param', entityParam, validationHook), zValidator('json', recordCreate, validationHook), async c => {
    const ctx = ctxOf(c);
    const e = await dataEntity(ctx, c.req.valid('param').entity);
    const body = c.req.valid('json');
    const data = await validateData(ctx, e, await loadFields(ctx, e.id), body.data, 'create');
    const [row] = await ctx.db
      .insert(records)
      .values({ ...(body.id ? { id: body.id } : {}), workspaceId: ctx.workspaceId, entityId: e.id, data, createdBy: ctx.memberId })
      .returning();
    await recordEvent(ctx.db, { workspaceId: ctx.workspaceId, type: 'record.created', entity: 'record', recordId: row!.id, actorId: ctx.memberId, payload: { entityKey: e.key, data } });
    return c.json(row!, 201);
  })
  // ---- изменение: data сливается с имеющимся, null очищает поле ----
  .patch('/:entity/:id', write, zValidator('param', recordParam, validationHook), zValidator('json', recordUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    const p = c.req.valid('param');
    const e = await dataEntity(ctx, p.entity);
    const [existing] = await ctx.db.select().from(records).where(and(eq(records.id, p.id), eq(records.entityId, e.id))).limit(1).for('update');
    if (!existing) throw notFound('record');
    const patch = await validateData(ctx, e, await loadFields(ctx, e.id), c.req.valid('json').data, 'patch', existing.id);
    const data = mergeData(existing.data, patch);
    const [row] = await ctx.db.update(records).set({ data, updatedAt: new Date() }).where(eq(records.id, existing.id)).returning();
    await recordEvent(ctx.db, { workspaceId: ctx.workspaceId, type: 'record.updated', entity: 'record', recordId: existing.id, actorId: ctx.memberId, payload: { entityKey: e.key, changes: patch } });
    return c.json(row!);
  })
  // ---- удаление: архив или ?hard=true (admin) ----
  .delete('/:entity/:id', write, zValidator('param', recordParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const p = c.req.valid('param');
    const e = await dataEntity(ctx, p.entity);
    const hard = ['true', '1'].includes(c.req.query('hard') ?? '');
    if (hard && !hasRole(c, 'admin')) throw new AppError(403, 'forbidden', 'Permanent deletion requires the admin role');
    const [existing] = await ctx.db.select().from(records).where(and(eq(records.id, p.id), eq(records.entityId, e.id))).limit(1).for('update');
    if (!existing) throw notFound('record');
    if (hard) {
      await ctx.db.delete(records).where(eq(records.id, existing.id));
      await recordEvent(ctx.db, { workspaceId: ctx.workspaceId, type: 'record.deleted', entity: 'record', recordId: existing.id, actorId: ctx.memberId, payload: { entityKey: e.key } });
      return c.json({ id: existing.id, deleted: true as const, archived: false as const });
    }
    if (!existing.archivedAt) {
      await ctx.db.update(records).set({ archivedAt: new Date(), updatedAt: new Date() }).where(eq(records.id, existing.id));
      await recordEvent(ctx.db, { workspaceId: ctx.workspaceId, type: 'record.archived', entity: 'record', recordId: existing.id, actorId: ctx.memberId, payload: { entityKey: e.key } });
    }
    return c.json({ id: existing.id, deleted: false as const, archived: true as const });
  })
  .post('/:entity/:id/restore', write, zValidator('param', recordParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const p = c.req.valid('param');
    const e = await dataEntity(ctx, p.entity);
    const [row] = await ctx.db.update(records).set({ archivedAt: null, updatedAt: new Date() }).where(and(eq(records.id, p.id), eq(records.entityId, e.id))).returning();
    if (!row) throw notFound('record');
    await recordEvent(ctx.db, { workspaceId: ctx.workspaceId, type: 'record.restored', entity: 'record', recordId: row.id, actorId: ctx.memberId, payload: { entityKey: e.key } });
    return c.json(row);
  });

export { recordsRoutes };

/* ---------------- поиск по записям (палитра команд) ---------------- */
export const dataSearchRoutes = new Hono<AppEnv>().get('/', zValidator('query', dataSearchQuery, validationHook), async c => {
  const ctx = ctxOf(c);
  const { q, limit } = c.req.valid('query');
  const list = await ctx.db.select().from(entities).where(and(eq(entities.kind, 'custom'), isNull(entities.archivedAt))).orderBy(asc(entities.sortOrder), asc(entities.createdAt));
  const items: { entityKey: string; entityName: string; icon: string; id: string; title: string }[] = [];
  for (const e of list) {
    const defs = await ctx.db.select().from(fields).where(and(eq(fields.entityId, e.id), isNull(fields.archivedAt)));
    const cols = searchCols(e, defs);
    if (!cols.length) continue;
    const rows = await ctx.db
      .select({ id: records.id, title: sql<string>`coalesce(${sql.raw(`(data->>'${e.titleField}')`)}, '')` })
      .from(records)
      .where(and(eq(records.entityId, e.id), isNull(records.archivedAt), likeAny(cols, q)))
      .orderBy(asc(records.createdAt))
      .limit(limit);
    for (const r of rows) items.push({ entityKey: e.key, entityName: e.name, icon: e.icon, id: r.id, title: r.title });
  }
  return c.json({ items });
});
