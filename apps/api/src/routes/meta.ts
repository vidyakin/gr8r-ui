/* Конструктор сущностей: сущности и их поля (чтение — любой участник, изменение — admin и выше).
   Удаление поля и сущности двухступенчатое и с подтверждением (DELETE …?confirm=<ключ>):
     - без purge — «мягкое»: поле/сущность скрываются и перестают принимать значения, а данные остаются в jsonb
       (записи сущности, ключ в records.data / custom) — всё можно вернуть через POST …/restore;
     - с purge=true — окончательное: значения вычищаются из jsonb, строка метаданных удаляется. */
import { zValidator } from '@hono/zod-validator';
import { and, asc, eq, isNull, max, ne, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { entities, fields, recordEvent, records, SYSTEM_TABLES } from '@gr8r/db';
import { destroyQuery, entityCreate, entityQuery, entityUpdate, fieldCreate, fieldsReorder, fieldUpdate, keyFromName, uuid, type FieldType } from '@gr8r/shared';
import { z } from 'zod';
import { ctxOf, validationHook } from '../crud';
import { AppError, badRequest, notFound } from '../errors';
import { requireRole } from '../middleware';
import { buildIndexAfterCommit, dropIndexAfterCommit } from '../meta/indexes';
import { loadEntity, loadFields, type EntityRow, type FieldRow } from '../meta/service';
import type { AppEnv } from '../types';

const admin = requireRole('admin');
const refParam = z.object({ ref: z.string().min(1).max(64) });
const fieldParam = z.object({ ref: z.string().min(1).max(64), fieldId: uuid });
const flag = (v: string | undefined) => v === 'true' || v === '1';

const target = (e: EntityRow, f: FieldRow) => ({ fieldId: f.id, key: f.key, type: f.type as FieldType, entityId: e.id, entityKey: e.key });

/** Подтверждение необратимого действия: ?confirm=<ключ> */
function requireConfirm(given: string | undefined, key: string, what: string) {
  if (given !== key) throw badRequest('confirmation_required', `Confirm deleting ${what} by passing confirm=${key}`);
}

export const entityRoutes = new Hono<AppEnv>()
  // ---- список сущностей вместе с полями (одним запросом: интерфейс строится из метаданных) ----
  .get('/', zValidator('query', entityQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const { archived } = c.req.valid('query');
    const rows = await ctx.db
      .select()
      .from(entities)
      .where(archived === 'only' ? sql`${entities.archivedAt} is not null` : archived === 'include' ? undefined : isNull(entities.archivedAt))
      .orderBy(asc(entities.kind), asc(entities.sortOrder), asc(entities.createdAt));
    const allFields = await ctx.db.select().from(fields).orderBy(asc(fields.sortOrder), asc(fields.createdAt));
    const items = rows.map(e => ({ ...e, fields: allFields.filter(f => f.entityId === e.id) }));
    return c.json({ items, total: items.length, limit: items.length, offset: 0 });
  })
  .get('/:ref', zValidator('param', refParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const e = await loadEntity(ctx, c.req.valid('param').ref, { archived: true });
    return c.json({ ...e, fields: await loadFields(ctx, e.id, { archived: true }) });
  })
  // ---- создание пользовательской сущности вместе с полем-заголовком ----
  .post('/', admin, zValidator('json', entityCreate, validationHook), async c => {
    const ctx = ctxOf(c);
    const body = c.req.valid('json');
    const key = body.key ?? keyFromName(body.name, 'entity');
    if (!/^[a-z][a-z0-9_]{1,31}$/.test(key)) throw badRequest('invalid_key', 'Cannot build an entity key from this name; pass "key" explicitly');
    const [ord] = await ctx.db.select({ m: max(entities.sortOrder) }).from(entities);
    const titleKey = keyFromName(body.titleFieldName, 'name');
    const [row] = await ctx.db
      .insert(entities)
      .values({ ...(body.id ? { id: body.id } : {}), workspaceId: ctx.workspaceId, key, name: body.name, kind: 'custom', icon: body.icon, titleField: titleKey, sortOrder: Math.max(10, Number(ord?.m ?? 0) + 1) })
      .returning();
    const [title] = await ctx.db.insert(fields).values({ workspaceId: ctx.workspaceId, entityId: row!.id, key: titleKey, name: body.titleFieldName, type: 'text', required: true, sortOrder: 0 }).returning();
    await recordEvent(ctx.db, { workspaceId: ctx.workspaceId, type: 'entity.created', entity: 'entity', recordId: row!.id, actorId: ctx.memberId, payload: { key } });
    return c.json({ ...row!, fields: [title!] }, 201);
  })
  .patch('/:ref', admin, zValidator('param', refParam, validationHook), zValidator('json', entityUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    const body = c.req.valid('json');
    const e = await loadEntity(ctx, c.req.valid('param').ref);
    if (e.kind === 'system') throw new AppError(422, 'system_entity', 'System entities cannot be changed');
    if (body.titleField) {
      const [tf] = await ctx.db.select().from(fields).where(and(eq(fields.entityId, e.id), eq(fields.key, body.titleField), isNull(fields.archivedAt))).limit(1);
      if (!tf || tf.type !== 'text') throw new AppError(422, 'invalid_title_field', 'The title field must be an existing text field');
    }
    const [row] = await ctx.db.update(entities).set({ ...body, updatedAt: new Date() }).where(eq(entities.id, e.id)).returning();
    await recordEvent(ctx.db, { workspaceId: ctx.workspaceId, type: 'entity.updated', entity: 'entity', recordId: e.id, actorId: ctx.memberId, payload: { changes: Object.keys(body) } });
    return c.json({ ...row!, fields: await loadFields(ctx, e.id, { archived: true }) });
  })
  // ---- удаление сущности: archive (по умолчанию, записи остаются) или purge=true (записи и поля удаляются) ----
  .delete('/:ref', admin, zValidator('param', refParam, validationHook), zValidator('query', destroyQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const q = c.req.valid('query');
    const e = await loadEntity(ctx, c.req.valid('param').ref, { archived: true });
    if (e.kind === 'system') throw new AppError(422, 'system_entity', 'System entities cannot be deleted');
    requireConfirm(q.confirm, e.key, `entity "${e.name}"`);
    // Нельзя удалить сущность, на которую ссылаются поля других сущностей
    const users = await ctx.db
      .select({ key: fields.key, name: fields.name, entityId: fields.entityId })
      .from(fields)
      .where(and(sql`${fields.options}->>'refEntity' = ${e.key}`, isNull(fields.archivedAt), ne(fields.entityId, e.id)));
    if (users.length) throw new AppError(422, 'entity_in_use', `Other entities refer to "${e.name}" (${users.map(u => u.name).join(', ')}). Remove those fields first`, { fields: users });
    const purge = flag(q.purge);
    if (purge) {
      const fs = await loadFields(ctx, e.id, { archived: true });
      const [{ n }] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(records).where(eq(records.entityId, e.id));
      await ctx.db.delete(entities).where(eq(entities.id, e.id)); // fields и records уходят каскадом
      for (const f of fs) dropIndexAfterCommit(c, f.id);
      await recordEvent(ctx.db, { workspaceId: ctx.workspaceId, type: 'entity.deleted', entity: 'entity', recordId: e.id, actorId: ctx.memberId, payload: { key: e.key, records: n } });
      return c.json({ id: e.id, archived: false as const, purged: true as const, records: n });
    }
    if (!e.archivedAt) {
      await ctx.db.update(entities).set({ archivedAt: new Date(), updatedAt: new Date() }).where(eq(entities.id, e.id));
      await recordEvent(ctx.db, { workspaceId: ctx.workspaceId, type: 'entity.archived', entity: 'entity', recordId: e.id, actorId: ctx.memberId, payload: { key: e.key } });
    }
    return c.json({ id: e.id, archived: true as const, purged: false as const, dataRetained: true as const });
  })
  .post('/:ref/restore', admin, zValidator('param', refParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const e = await loadEntity(ctx, c.req.valid('param').ref, { archived: true });
    const [row] = await ctx.db.update(entities).set({ archivedAt: null, updatedAt: new Date() }).where(eq(entities.id, e.id)).returning();
    await recordEvent(ctx.db, { workspaceId: ctx.workspaceId, type: 'entity.restored', entity: 'entity', recordId: e.id, actorId: ctx.memberId, payload: { key: e.key } });
    return c.json({ ...row!, fields: await loadFields(ctx, e.id, { archived: true }) });
  })

  /* ---------------- поля ---------------- */
  .get('/:ref/fields', zValidator('param', refParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const e = await loadEntity(ctx, c.req.valid('param').ref, { archived: true });
    const items = await loadFields(ctx, e.id, { archived: true });
    return c.json({ items, total: items.length, limit: items.length, offset: 0 });
  })
  .post('/:ref/fields', admin, zValidator('param', refParam, validationHook), zValidator('json', fieldCreate, validationHook), async c => {
    const ctx = ctxOf(c);
    const body = c.req.valid('json');
    const e = await loadEntity(ctx, c.req.valid('param').ref);
    const key = body.key ?? keyFromName(body.name);
    const [exists] = await ctx.db.select({ id: fields.id }).from(fields).where(and(eq(fields.entityId, e.id), eq(fields.key, key))).limit(1);
    if (exists) throw new AppError(409, 'conflict', `A field with key "${key}" already exists in ${e.name} (possibly removed — restore or purge it first)`);
    if ((body.type === 'ref' || body.type === 'refs') && body.options.refEntity) await loadEntity(ctx, body.options.refEntity); // целевая сущность должна существовать
    const [ord] = await ctx.db.select({ m: max(fields.sortOrder) }).from(fields).where(eq(fields.entityId, e.id));
    const [row] = await ctx.db
      .insert(fields)
      .values({ ...(body.id ? { id: body.id } : {}), workspaceId: ctx.workspaceId, entityId: e.id, key, name: body.name, type: body.type, required: body.required, unique: body.unique, filterable: body.filterable, options: body.options, sortOrder: Number(ord?.m ?? -1) + 1 })
      .returning();
    if (row!.filterable) buildIndexAfterCommit(c, target(e, row!));
    await recordEvent(ctx.db, { workspaceId: ctx.workspaceId, type: 'field.created', entity: 'field', recordId: row!.id, actorId: ctx.memberId, payload: { entity: e.key, key } });
    return c.json(row!, 201);
  })
  // порядок полей: перетаскивание в редакторе присылает полный список id
  .post('/:ref/fields/reorder', admin, zValidator('param', refParam, validationHook), zValidator('json', fieldsReorder, validationHook), async c => {
    const ctx = ctxOf(c);
    const e = await loadEntity(ctx, c.req.valid('param').ref);
    const { ids } = c.req.valid('json');
    const current = await loadFields(ctx, e.id, { archived: true });
    const known = new Set(current.map(f => f.id));
    if (ids.some(id => !known.has(id))) throw new AppError(422, 'invalid_reference', 'The list contains fields that do not belong to this entity');
    const rest = current.filter(f => !ids.includes(f.id)).map(f => f.id);
    const order = [...new Set([...ids, ...rest])];
    for (const [i, id] of order.entries()) await ctx.db.update(fields).set({ sortOrder: i }).where(eq(fields.id, id));
    await recordEvent(ctx.db, { workspaceId: ctx.workspaceId, type: 'field.reordered', entity: 'field', recordId: e.id, actorId: ctx.memberId, payload: { entity: e.key } });
    return c.json({ items: await loadFields(ctx, e.id, { archived: true }) });
  })
  .patch('/:ref/fields/:fieldId', admin, zValidator('param', fieldParam, validationHook), zValidator('json', fieldUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    const body = c.req.valid('json');
    const { ref, fieldId } = c.req.valid('param');
    const e = await loadEntity(ctx, ref);
    const [f] = await ctx.db.select().from(fields).where(and(eq(fields.id, fieldId), eq(fields.entityId, e.id))).limit(1).for('update');
    if (!f) throw notFound('field');
    if (f.isSystem) throw new AppError(422, 'system_field', 'Built-in fields cannot be changed');
    const options = body.options ?? f.options;
    if (body.options && (f.type === 'ref' || f.type === 'refs') && body.options.refEntity !== f.options.refEntity) throw new AppError(422, 'immutable', 'The referenced entity cannot be changed; create a new field instead');
    // Параметры проверяются теми же правилами, что и при создании (варианты select, целевая сущность…)
    const check = fieldCreate.safeParse({ name: body.name ?? f.name, type: f.type, options });
    if (!check.success) validationHook({ success: false, error: check.error });
    const [row] = await ctx.db
      .update(fields)
      .set({ ...(body.name !== undefined ? { name: body.name } : {}), ...(body.required !== undefined ? { required: body.required } : {}), ...(body.unique !== undefined ? { unique: body.unique } : {}), ...(body.filterable !== undefined ? { filterable: body.filterable } : {}), ...(body.options ? { options: body.options } : {}), updatedAt: new Date() })
      .where(eq(fields.id, f.id))
      .returning();
    if (body.filterable !== undefined && body.filterable !== f.filterable && !f.archivedAt) {
      if (body.filterable) buildIndexAfterCommit(c, target(e, row!));
      else dropIndexAfterCommit(c, f.id);
    }
    await recordEvent(ctx.db, { workspaceId: ctx.workspaceId, type: 'field.updated', entity: 'field', recordId: f.id, actorId: ctx.memberId, payload: { entity: e.key, changes: Object.keys(body) } });
    return c.json(row!);
  })
  // ---- удаление поля: подтверждение обязательно; без purge данные остаются в jsonb ----
  .delete('/:ref/fields/:fieldId', admin, zValidator('param', fieldParam, validationHook), zValidator('query', destroyQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const q = c.req.valid('query');
    const { ref, fieldId } = c.req.valid('param');
    const e = await loadEntity(ctx, ref, { archived: true });
    const [f] = await ctx.db.select().from(fields).where(and(eq(fields.id, fieldId), eq(fields.entityId, e.id))).limit(1).for('update');
    if (!f) throw notFound('field');
    if (f.isSystem) throw new AppError(422, 'system_field', 'Built-in fields cannot be deleted');
    if (f.key === e.titleField && e.kind === 'custom') throw new AppError(422, 'title_field', 'The title field cannot be deleted; choose another title field first');
    requireConfirm(q.confirm, f.key, `field "${f.name}"`);
    if (flag(q.purge)) {
      // Окончательно: значения вычищаются из jsonb (операция `- ключ`), строка поля удаляется
      const table = SYSTEM_TABLES[e.key];
      const res = table ? await ctx.db.execute(sql`update ${sql.raw(table)} set custom = custom - ${f.key}::text where jsonb_exists(custom, ${f.key}::text)`) : await ctx.db.execute(sql`update records set data = data - ${f.key}::text where entity_id = ${e.id} and jsonb_exists(data, ${f.key}::text)`);
      await ctx.db.delete(fields).where(eq(fields.id, f.id));
      dropIndexAfterCommit(c, f.id);
      await recordEvent(ctx.db, { workspaceId: ctx.workspaceId, type: 'field.deleted', entity: 'field', recordId: f.id, actorId: ctx.memberId, payload: { entity: e.key, key: f.key, cleared: res.count } });
      return c.json({ id: f.id, archived: false as const, purged: true as const, cleared: res.count });
    }
    if (!f.archivedAt) {
      await ctx.db.update(fields).set({ archivedAt: new Date(), updatedAt: new Date() }).where(eq(fields.id, f.id));
      if (f.filterable) dropIndexAfterCommit(c, f.id);
      await recordEvent(ctx.db, { workspaceId: ctx.workspaceId, type: 'field.archived', entity: 'field', recordId: f.id, actorId: ctx.memberId, payload: { entity: e.key, key: f.key } });
    }
    return c.json({ id: f.id, archived: true as const, purged: false as const, dataRetained: true as const });
  })
  .post('/:ref/fields/:fieldId/restore', admin, zValidator('param', fieldParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const { ref, fieldId } = c.req.valid('param');
    const e = await loadEntity(ctx, ref);
    const [f] = await ctx.db.select().from(fields).where(and(eq(fields.id, fieldId), eq(fields.entityId, e.id))).limit(1).for('update');
    if (!f) throw notFound('field');
    const [row] = await ctx.db.update(fields).set({ archivedAt: null, updatedAt: new Date() }).where(eq(fields.id, f.id)).returning();
    if (row!.filterable && f.archivedAt) buildIndexAfterCommit(c, target(e, row!));
    await recordEvent(ctx.db, { workspaceId: ctx.workspaceId, type: 'field.restored', entity: 'field', recordId: f.id, actorId: ctx.memberId, payload: { entity: e.key, key: f.key } });
    return c.json(row!);
  });
