/* Переработка: заказы на переработку (заказы покупателей с видом операции «Переработка»), остатки давальцев,
   акт услуги по отчёту о переработке, передача сырья переработчику и отчёт переработчика.
   Правила — packages/db/src/tolling.ts и customer-stock.ts. Чтение — любой участник, документы — member и выше. */
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import {
  canSeeCost,
  createProcessorReport,
  createProcessorTransfer,
  createServiceAct,
  customerStockRows,
  documentDetail,
  listProcessingOrders,
  processingOrderCost,
  processingOrderContext,
  productionDetail,
  setComponentOwner,
} from '@gr8r/db';
import { customerBalanceQuery, idParam, materialOwnerUpdate, processingOrderQuery, processorReportCreate } from '@gr8r/shared';
import { ctxOf, validationHook, type Ctx } from '../crud';
import { requireRole } from '../middleware';
import type { AppEnv } from '../types';

const write = requireRole('member');
const docCtx = (ctx: Ctx) => ({ workspaceId: ctx.workspaceId, memberId: ctx.memberId, role: ctx.role });

/** Производственные данные документа (изготовитель, позиции, состав) — как у заказов на производство */
async function productionSide(ctx: Ctx, id: string) {
  const prod = await productionDetail(ctx.db, id);
  const seeCost = canSeeCost(ctx.role);
  return {
    workCenter: prod.workCenter,
    plannedStart: prod.plannedStart,
    plannedEnd: prod.plannedEnd,
    items: prod.items,
    components: seeCost ? prod.components : prod.components.map(c => ({ ...c, plannedCost: null, actualCost: null })),
    outputs: prod.outputs,
  };
}

/** Экран «Documents of processing»: заказы на переработку, остатки давальцев и акт услуги по отчёту */
export const tollingRoutes = new Hono<AppEnv>()
  // отчёт «Stock received for processing»: остатки давальцев по складу, товару, давальцу и заказу
  .get('/balances', zValidator('query', customerBalanceQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const items = await customerStockRows(ctx.db, c.req.valid('query'));
    return c.json({ items, total: items.length });
  })
  // заказы на переработку: заказы покупателей с видом операции «Переработка»
  .get('/orders', zValidator('query', processingOrderQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const q = c.req.valid('query');
    const list = await listProcessingOrders(ctx.db, { status: q.status, q: q.q, limit: q.limit, offset: q.offset });
    const seeCost = canSeeCost(ctx.role);
    const items = [];
    for (const row of list.items) {
      // накопленная себестоимость услуги переработки — только у проведённых заказов
      const cost = row.status === 'posted' ? await processingOrderCost(ctx.db, row.id) : null;
      items.push({ ...row, serviceCost: cost === null ? null : seeCost ? cost : null });
    }
    return c.json({ items, total: list.total, limit: q.limit, offset: q.offset });
  })
  // карточка заказа на переработку: давалец, склад и накопленная себестоимость услуги
  .get('/orders/:id', zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const detail = await documentDetail(ctx.db, c.req.valid('param').id);
    const processing = await processingOrderContext(ctx.db, detail.id);
    const seeCost = canSeeCost(ctx.role);
    const cost = detail.status === 'posted' ? await processingOrderCost(ctx.db, detail.id) : null;
    return c.json({ ...detail, ownerName: processing.counterpartyName, serviceCost: cost === null ? null : seeCost ? cost : null });
  })
  // акт услуги по отчёту о переработке
  .post('/reports/:id/act', write, zValidator('param', idParam, validationHook), zValidator('json', z.object({ date: z.string().optional() }).default({}), validationHook), async c => {
    const ctx = ctxOf(c);
    const id = await createServiceAct(ctx.db, docCtx(ctx), c.req.valid('param').id, { date: c.req.valid('json').date });
    return c.json(await documentDetail(ctx.db, id), 201);
  });

/** Передача своего сырья переработчику: обычное перемещение на склад контрагента (товар едет по своей средней) */
export const processorTransferRoutes = new Hono<AppEnv>().post(
  '/:id/processing-transfer',
  write,
  zValidator('param', idParam, validationHook),
  zValidator('json', z.object({ date: z.string().optional(), comment: z.string().max(5000).optional() }).default({}), validationHook),
  async c => {
    const ctx = ctxOf(c);
    const body = c.req.valid('json');
    const id = await createProcessorTransfer(ctx.db, docCtx(ctx), c.req.valid('param').id, { date: body.date, comment: body.comment });
    return c.json(await documentDetail(ctx.db, id), 201);
  },
);

/** Отчёт переработчика: выпуск на складе переработчика — материалы, услуга переработчика и продукция */
export const processorReportRoutes = new Hono<AppEnv>().post(
  '/',
  write,
  zValidator('json', processorReportCreate, validationHook),
  async c => {
    const ctx = ctxOf(c);
    const body = c.req.valid('json');
    const id = await createProcessorReport(ctx.db, docCtx(ctx), {
      itemId: body.itemId,
      qty: body.qty,
      processorWarehouseId: body.processorWarehouseId,
      warehouseId: body.warehouseId,
      workCenterId: body.workCenterId ?? null,
      date: body.date,
      comment: body.comment,
      basedOnId: body.basedOnId ?? null,
      services: body.services?.map(s => ({ productId: s.productId, qty: s.qty, price: s.price })),
      materials: body.materials?.map(m => ({ productId: m.productId, qty: m.qty })),
    });
    return c.json({ ...(await documentDetail(ctx.db, id)), ...(await productionSide(ctx, id)) }, 201);
  },
);

/** Признак «чей материал» у строки состава заказа на производство (в выпуске можно смешать своё и давальческое) */
export const componentOwnerRoutes = new Hono<AppEnv>().patch(
  '/:id/components/:componentId',
  write,
  zValidator('param', z.object({ id: idParam.shape.id, componentId: idParam.shape.id }), validationHook),
  zValidator('json', materialOwnerUpdate, validationHook),
  async c => {
    const ctx = ctxOf(c);
    const { id, componentId } = c.req.valid('param');
    await setComponentOwner(ctx.db, docCtx(ctx), id, componentId, c.req.valid('json').ownerKind);
    return c.json({ ...(await documentDetail(ctx.db, id)), ...(await productionSide(ctx, id)) });
  },
);