/* Серийные номера и изделия в ремонте (задача 1099): реестр, поиск гарантии, карточка номера, список изделий в ремонте.
   Чтение — любой участник; правка карточки номера — member и выше. Правила — packages/db/src/serials.ts и repair.ts. */
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { listRepairItems, listSerials, lookupSerial, serialCard, updateSerial } from '@gr8r/db';
import { idParam, repairItemsQuery, serialLookupQuery, serialQuery, serialUpdate } from '@gr8r/shared';
import { ctxOf, validationHook } from '../crud';
import { requireRole } from '../middleware';
import type { AppEnv } from '../types';

const write = requireRole('member');
const today = () => new Date().toISOString().slice(0, 10);

export const serialRoutes = new Hono<AppEnv>()
  // реестр: поиск по номеру и товару, фильтры по товару, складу и состоянию
  .get('/', zValidator('query', serialQuery, validationHook), async c => {
    const q = c.req.valid('query');
    return c.json(await listSerials(ctxOf(c).db, { q: q.q, productId: q.productId, warehouseId: q.warehouseId, status: q.status, limit: q.limit, offset: q.offset }));
  })
  // проверка гарантии: продан когда, кому, документ, гарантия до, действует ли
  .get('/lookup', zValidator('query', serialLookupQuery, validationHook), async c => c.json({ items: await lookupSerial(ctxOf(c).db, c.req.valid('query').serial, today()) }))
  .get('/:id', zValidator('param', idParam, validationHook), async c => c.json(await serialCard(ctxOf(c).db, c.req.valid('param').id, today())))
  .patch('/:id', write, zValidator('param', idParam, validationHook), zValidator('json', serialUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    await updateSerial(ctx.db, id, c.req.valid('json'));
    return c.json(await serialCard(ctx.db, id, today()));
  });

export const repairItemRoutes = new Hono<AppEnv>().get('/', zValidator('query', repairItemsQuery, validationHook), async c => {
  const q = c.req.valid('query');
  return c.json(await listRepairItems(ctxOf(c).db, { q: q.q, open: q.open, kindType: q.kindType, limit: q.limit, offset: q.offset }));
});
