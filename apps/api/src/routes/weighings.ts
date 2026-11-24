/* Взвешивания (подмодуль «Добыча», весовая): журнал, ручной ввод и приём из мостов весов (агентский токен).
   Нетто = брутто − тара; объём = нетто (т) / насыпная плотность (т/м³). Читает любой участник, правит member и выше. */
import { zValidator } from '@hono/zod-validator';
import { and, desc, eq, gte, ilike, isNull, lte, or, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { companies, fleetVehicles, products, recordEvent, weighings } from '@erp/db';
import { idParam, weighingCreateBody, weighingListQuery, weighingPatchBody } from '@erp/shared';
import { ctxOf, escapeLike, validationHook } from '../crud';
import { notFound } from '../errors';
import { requireRole } from '../middleware';
import type { AppEnv } from '../types';

const write = requireRole('member');

/** Нетто в кг и объём в м³ (3 знака); без плотности объём не считается */
export function weighingMath(grossKg: number, tareKg: number, bulkDensity?: number | null) {
  const netKg = Number((grossKg - tareKg).toFixed(3));
  const volumeM3 = bulkDensity && bulkDensity > 0 ? Number((netKg / 1000 / bulkDensity).toFixed(3)) : null;
  return { netKg, volumeM3 };
}

type Db = ReturnType<typeof ctxOf>['db'];

async function productDensity(db: Db, productId?: string | null): Promise<number | null> {
  if (!productId) return null;
  const [p] = await db.select({ d: products.bulkDensity }).from(products).where(eq(products.id, productId)).limit(1);
  return p?.d == null ? null : Number(p.d);
}

async function nextWeighingNumber(db: Db): Promise<string> {
  const [r] = await db.select({ n: sql<number>`coalesce(max(nullif(regexp_replace(${weighings.number}, '\\D', '', 'g'), '')::int), 0)::int` }).from(weighings);
  return `W-${String((r?.n ?? 0) + 1).padStart(4, '0')}`;
}

const str = (v: number | null | undefined) => (v == null ? null : String(v));

export const weighingRoutes = new Hono<AppEnv>()
  .get('/', zValidator('query', weighingListQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const q = c.req.valid('query');
    const term = q.q ? `%${escapeLike(q.q)}%` : null;
    const where = and(
      isNull(weighings.archivedAt),
      q.direction ? eq(weighings.direction, q.direction) : undefined,
      q.from ? gte(weighings.weighedAt, new Date(q.from)) : undefined,
      q.to ? lte(weighings.weighedAt, new Date(q.to)) : undefined,
      q.productId ? eq(weighings.productId, q.productId) : undefined,
      q.vehicleId ? eq(weighings.vehicleId, q.vehicleId) : undefined,
      term ? or(ilike(weighings.number, term), ilike(weighings.plateNumber, term), ilike(weighings.driverName, term), ilike(weighings.waybillNumber, term)) : undefined,
    );
    const items = await ctx.db
      .select({ w: weighings, productName: products.name, counterpartyName: companies.name, vehiclePlate: fleetVehicles.plate })
      .from(weighings)
      .leftJoin(products, eq(products.id, weighings.productId))
      .leftJoin(companies, eq(companies.id, weighings.counterpartyId))
      .leftJoin(fleetVehicles, eq(fleetVehicles.id, weighings.vehicleId))
      .where(where)
      .orderBy(desc(weighings.weighedAt), desc(weighings.number))
      .limit(q.limit ?? 200);
    const [s] = await ctx.db
      .select({ count: sql<number>`count(*)::int`, totalNetKg: sql<string>`coalesce(sum(${weighings.netKg}), 0)`, totalVolumeM3: sql<string>`coalesce(sum(${weighings.volumeM3}), 0)` })
      .from(weighings)
      .where(where);
    return c.json({
      items: items.map(r => ({ ...r.w, productName: r.productName, counterpartyName: r.counterpartyName, vehiclePlate: r.vehiclePlate })),
      summary: { count: s?.count ?? 0, totalNetKg: Number(s?.totalNetKg ?? 0), totalVolumeM3: Number(s?.totalVolumeM3 ?? 0) },
    });
  })
  .post('/', write, zValidator('json', weighingCreateBody, validationHook), async c => {
    const ctx = ctxOf(c);
    const b = c.req.valid('json');
    const density = b.bulkDensity ?? (await productDensity(ctx.db, b.productId));
    const { netKg, volumeM3 } = weighingMath(b.grossKg, b.tareKg, density);
    const [row] = await ctx.db
      .insert(weighings)
      .values({
        workspaceId: ctx.workspaceId,
        number: await nextWeighingNumber(ctx.db),
        weighedAt: b.weighedAt ? new Date(b.weighedAt) : new Date(),
        direction: b.direction,
        vehicleId: b.vehicleId ?? null,
        plateNumber: b.plateNumber ?? '',
        driverName: b.driverName ?? '',
        counterpartyId: b.counterpartyId ?? null,
        productId: b.productId ?? null,
        grossKg: String(b.grossKg),
        tareKg: String(b.tareKg),
        netKg: String(netKg),
        bulkDensity: str(density),
        volumeM3: str(volumeM3),
        waybillNumber: b.waybillNumber ?? '',
        source: b.source ?? 'manual',
        notes: b.notes ?? '',
        createdBy: ctx.memberId,
      })
      .returning();
    await recordEvent(ctx.db, { workspaceId: ctx.workspaceId, type: 'weighing.created', entity: 'weighing', recordId: row!.id, actorId: ctx.memberId, payload: { number: row!.number, netKg } });
    return c.json({ item: row }, 201);
  })
  .patch('/:id', write, zValidator('param', idParam, validationHook), zValidator('json', weighingPatchBody, validationHook), async c => {
    const ctx = ctxOf(c);
    const { id } = c.req.valid('param');
    const b = c.req.valid('json');
    const [cur] = await ctx.db.select().from(weighings).where(and(eq(weighings.id, id), isNull(weighings.archivedAt))).limit(1);
    if (!cur) throw notFound('weighing');
    const gross = b.grossKg ?? Number(cur.grossKg);
    const tare = b.tareKg ?? Number(cur.tareKg);
    if (gross < tare) return c.json({ error: { code: 'validation_error', message: 'grossKg must be >= tareKg', issues: [{ path: 'grossKg', message: 'grossKg must be >= tareKg' }] } }, 400);
    const productId = b.productId !== undefined ? b.productId : cur.productId;
    const density = b.bulkDensity !== undefined ? b.bulkDensity : b.productId !== undefined ? await productDensity(ctx.db, productId) : cur.bulkDensity == null ? null : Number(cur.bulkDensity);
    const { netKg, volumeM3 } = weighingMath(gross, tare, density);
    const set: Partial<typeof weighings.$inferInsert> = { grossKg: String(gross), tareKg: String(tare), netKg: String(netKg), bulkDensity: str(density), volumeM3: str(volumeM3) };
    if (b.weighedAt) set.weighedAt = new Date(b.weighedAt);
    if (b.direction) set.direction = b.direction;
    if (b.vehicleId !== undefined) set.vehicleId = b.vehicleId;
    if (b.counterpartyId !== undefined) set.counterpartyId = b.counterpartyId;
    if (b.productId !== undefined) set.productId = b.productId;
    if (b.plateNumber !== undefined) set.plateNumber = b.plateNumber;
    if (b.driverName !== undefined) set.driverName = b.driverName;
    if (b.waybillNumber !== undefined) set.waybillNumber = b.waybillNumber;
    if (b.source) set.source = b.source;
    if (b.notes !== undefined) set.notes = b.notes;
    const [row] = await ctx.db.update(weighings).set(set).where(eq(weighings.id, id)).returning();
    await recordEvent(ctx.db, { workspaceId: ctx.workspaceId, type: 'weighing.updated', entity: 'weighing', recordId: id, actorId: ctx.memberId, payload: { changes: Object.keys(b) } });
    return c.json({ item: row });
  })
  .delete('/:id', write, zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const { id } = c.req.valid('param');
    const [row] = await ctx.db.update(weighings).set({ archivedAt: new Date() }).where(and(eq(weighings.id, id), isNull(weighings.archivedAt))).returning({ id: weighings.id, number: weighings.number });
    if (!row) throw notFound('weighing');
    await recordEvent(ctx.db, { workspaceId: ctx.workspaceId, type: 'weighing.deleted', entity: 'weighing', recordId: id, actorId: ctx.memberId, payload: { number: row.number } });
    return c.json({ ok: true });
  });
