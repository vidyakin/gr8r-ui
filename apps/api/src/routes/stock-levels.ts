/* Нормы запаса товара (мин./макс.): вкладка «Stock levels» в карточке товара и общий расчёт потребностей.
   Чтение — любой участник; нормы меняет member и выше (как у соседних маршрутов производства). */
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { listStockLevels, maskCost, setStockLevels, supplierHistory } from '@gr8r/db';
import { stockLevelsQuery, stockLevelsSet } from '@gr8r/shared';
import { ctxOf, validationHook } from '../crud';
import { requireRole } from '../middleware';
import type { AppEnv } from '../types';

const write = requireRole('member');

export const stockLevelRoutes = new Hono<AppEnv>()
  .get('/', zValidator('query', stockLevelsQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const { productId } = c.req.valid('query');
    return c.json({ items: await listStockLevels(ctx.db, productId) });
  })
  // нормы товара заменяются целиком: строка без склада — норма по компании
  .put('/', write, zValidator('json', stockLevelsSet, validationHook), async c => {
    const ctx = ctxOf(c);
    const body = c.req.valid('json');
    return c.json({ items: await setStockLevels(ctx.db, ctx, body.productId, body.rows) });
  })
  // поставщики, у которых товар покупали: цена и дата последнего поступления (цены маскируются по роли)
  .get('/suppliers', zValidator('query', stockLevelsQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const { productId } = c.req.valid('query');
    const items = await supplierHistory(ctx.db, productId);
    return c.json({ items: items.map(i => ({ ...i, price: maskCost(i.price, ctx.role) })) });
  });