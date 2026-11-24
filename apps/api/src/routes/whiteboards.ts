/* Интерактивные доски (whiteboards): мультиарендный CRUD API с RLS и журналом событий. */
import { zValidator } from '@hono/zod-validator';
import { and, desc, eq, ilike, sql, type SQL } from 'drizzle-orm';
import { Hono } from 'hono';
import { isUuid, recordEvent, whiteboards } from '@erp/db';
import { idParam, whiteboardCreateBody, whiteboardPatchBody } from '@erp/shared';
import { escapeLike, validationHook } from '../crud';
import { notFound } from '../errors';
import { requireRole } from '../middleware';
import type { AppEnv } from '../types';

export const whiteboardRoutes = new Hono<AppEnv>()
  .get('/', async c => {
    const q = c.req.query('q')?.trim();
    const entityType = c.req.query('entityType')?.trim();
    const entityId = c.req.query('entityId')?.trim();
    const limit = Math.min(200, Math.max(1, Number(c.req.query('limit')) || 50));
    const conds: (SQL | undefined)[] = [
      entityType ? eq(whiteboards.entityType, entityType) : undefined,
      entityId && isUuid(entityId) ? eq(whiteboards.entityId, entityId) : undefined,
      q ? ilike(whiteboards.title, `%${escapeLike(q)}%`) : undefined,
    ];
    const items = await c.var.db
      .select({
        id: whiteboards.id,
        title: whiteboards.title,
        entityType: whiteboards.entityType,
        entityId: whiteboards.entityId,
        elementCount: sql<number>`jsonb_array_length(${whiteboards.elements})::int`,
        createdBy: whiteboards.createdBy,
        createdAt: whiteboards.createdAt,
        updatedAt: whiteboards.updatedAt,
      })
      .from(whiteboards)
      .where(and(...conds))
      .orderBy(desc(whiteboards.updatedAt))
      .limit(limit);
    return c.json({ items });
  })
  .post('/', requireRole('member'), zValidator('json', whiteboardCreateBody, validationHook), async c => {
    const body = c.req.valid('json');
    const [row] = await c.var.db
      .insert(whiteboards)
      .values({
        workspaceId: c.var.workspaceId,
        title: body.title,
        entityType: body.entityType ?? null,
        entityId: body.entityId ?? null,
        elements: (body.elements ?? []) as Record<string, unknown>[],
        viewport: body.viewport ?? { x: 0, y: 0, zoom: 1 },
        createdBy: c.var.memberId,
      })
      .returning();
    await recordEvent(c.var.db, {
      workspaceId: c.var.workspaceId,
      type: 'whiteboard.created',
      entity: 'whiteboard',
      recordId: row!.id,
      actorId: c.var.memberId,
      payload: { title: row!.title },
    });
    return c.json(row!, 201);
  })
  .get('/:id', zValidator('param', idParam, validationHook), async c => {
    const { id } = c.req.valid('param');
    const [row] = await c.var.db.select().from(whiteboards).where(eq(whiteboards.id, id)).limit(1);
    if (!row) throw notFound('Whiteboard');
    return c.json(row);
  })
  .patch('/:id', requireRole('member'), zValidator('param', idParam, validationHook), zValidator('json', whiteboardPatchBody, validationHook), async c => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const patch: Partial<typeof whiteboards.$inferInsert> = { updatedAt: new Date() };
    if (body.title !== undefined) patch.title = body.title;
    if (body.entityType !== undefined) patch.entityType = body.entityType;
    if (body.entityId !== undefined) patch.entityId = body.entityId;
    if (body.elements !== undefined) patch.elements = body.elements as Record<string, unknown>[];
    if (body.viewport !== undefined) patch.viewport = body.viewport;

    const [row] = await c.var.db.update(whiteboards).set(patch).where(eq(whiteboards.id, id)).returning();
    if (!row) throw notFound('Whiteboard');
    await recordEvent(c.var.db, {
      workspaceId: c.var.workspaceId,
      type: 'whiteboard.updated',
      entity: 'whiteboard',
      recordId: row.id,
      actorId: c.var.memberId,
      payload: { changes: Object.keys(body) },
    });
    return c.json(row);
  })
  .delete('/:id', requireRole('member'), zValidator('param', idParam, validationHook), async c => {
    const { id } = c.req.valid('param');
    const [deleted] = await c.var.db.delete(whiteboards).where(eq(whiteboards.id, id)).returning({ id: whiteboards.id });
    if (!deleted) throw notFound('Whiteboard');
    await recordEvent(c.var.db, {
      workspaceId: c.var.workspaceId,
      type: 'whiteboard.deleted',
      entity: 'whiteboard',
      recordId: deleted.id,
      actorId: c.var.memberId,
    });
    return c.json({ ok: true as const });
  });
