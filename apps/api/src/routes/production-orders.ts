/* Заказы на производство и выпуск продукции: журнал заказов, карточка, снимок спецификации, создание выпуска
   (по заказу на производство или прямо из заказа покупателя) и состояние заказа. Чтение — любой участник,
   заказы и выпуски — member и выше. Правила — packages/db/src/production.ts. */
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import {
  canSeeCost,
  changeDocumentState,
  createProductionFromCustomerOrder,
  createProductionFromOrder,
  createProductionOrder,
  createProductionOrderFromCustomerOrder,
  createSemiOrders,
  createSupplierOrdersForOrder,
  deleteDocument,
  documentDetail,
  fillOrderFromBom,
  listProductionOrders,
  materialRows,
  productManufacturing,
  productionDetail,
  scheduleProductionOrder,
  setMaterialReservation,
  updateProductionOrder,
} from '@gr8r/db';
import {
  documentStateChange,
  idParam,
  materialReservationUpdate,
  productionCreate,
  productionFromCustomerOrder,
  productionOrderCreate,
  productionOrderFromCustomerOrder,
  productionOrderQuery,
  productionOrderUpdate,
  productManufacturingSet,
  semiOrdersCreate,
  supplierOrdersCreate,
} from '@gr8r/shared';
import { ctxOf, validationHook, type Ctx } from '../crud';
import { AppError } from '../errors';
import { requireRole } from '../middleware';
import type { AppEnv } from '../types';

const write = requireRole('member');
const docCtx = (ctx: Ctx) => ({ workspaceId: ctx.workspaceId, memberId: ctx.memberId, role: ctx.role });
/** Параметры строки материала заказа: заказ и строка состава */
const materialParam = z.object({ id: idParam.shape.id, componentId: idParam.shape.id });

/** Карточка заказа или выпуска: документ + производственные данные */
async function detail(ctx: Ctx, id: string) {
  const doc = await documentDetail(ctx.db, id);
  const prod = await productionDetail(ctx.db, id);
  const seeCost = canSeeCost(ctx.role);
  return {
    ...doc,
    workCenter: prod.workCenter,
    plannedStart: prod.plannedStart,
    plannedEnd: prod.plannedEnd,
    parentDocumentId: prod.parentDocumentId,
    items: prod.items,
    components: seeCost ? prod.components : prod.components.map(c => ({ ...c, plannedCost: null, actualCost: null })),
    outputs: prod.outputs,
  };
}

export const productionOrderRoutes = new Hono<AppEnv>()
  // способ пополнения товара и спецификация по умолчанию (путь конкретный — раньше /:id)
  .get('/product-settings', async c => {
    const ctx = ctxOf(c);
    return c.json({ items: await ctx.db.select().from(productManufacturing) });
  })
  .post('/product-settings', write, zValidator('json', productManufacturingSet, validationHook), async c => {
    const ctx = ctxOf(c);
    const body = c.req.valid('json');
    const [row] = await ctx.db
      .insert(productManufacturing)
      .values({ workspaceId: ctx.workspaceId, productId: body.productId, replenishment: body.replenishment, defaultItemId: body.defaultItemId ?? null })
      .onConflictDoUpdate({ target: [productManufacturing.workspaceId, productManufacturing.productId], set: { replenishment: body.replenishment, defaultItemId: body.defaultItemId ?? null, updatedAt: new Date() } })
      .returning();
    return c.json(row!, 201);
  })
  // журнал заказов на производство: состояние и плановые сроки
  .get('/', zValidator('query', productionOrderQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const q = c.req.valid('query');
    const list = await listProductionOrders(ctx.db, ctx.workspaceId, { state: q.state, from: q.from, to: q.to, q: q.q, limit: q.limit, offset: q.offset });
    return c.json({ ...list, limit: q.limit, offset: q.offset });
  })
  // карточка заказа или выпуска
  .get('/:id', zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await detail(ctx, c.req.valid('param').id));
  })
  .post('/', write, zValidator('json', productionOrderCreate, validationHook), async c => {
    const ctx = ctxOf(c);
    const body = c.req.valid('json');
    const id = await createProductionOrder(ctx.db, docCtx(ctx), {
      ...(body.id ? { id: body.id } : {}),
      workCenterId: body.workCenterId,
      warehouseId: body.warehouseId,
      targetWarehouseId: body.targetWarehouseId,
      date: body.date,
      plannedStart: body.plannedStart,
      plannedEnd: body.plannedEnd,
      comment: body.comment,
      parentDocumentId: body.parentDocumentId,
      items: body.items.map(i => ({ itemId: i.itemId, qty: i.qty, customerOrderLineId: i.customerOrderLineId, params: i.params })),
    });
    return c.json(await detail(ctx, id), 201);
  })
  .patch('/:id', write, zValidator('param', idParam, validationHook), zValidator('json', productionOrderUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    const body = c.req.valid('json');
    await updateProductionOrder(ctx.db, docCtx(ctx), c.req.valid('param').id, {
      workCenterId: body.workCenterId,
      warehouseId: body.warehouseId,
      targetWarehouseId: body.targetWarehouseId,
      date: body.date,
      plannedStart: body.plannedStart,
      plannedEnd: body.plannedEnd,
      comment: body.comment,
      parentDocumentId: body.parentDocumentId,
      items: body.items?.map(i => ({ itemId: i.itemId, qty: i.qty, customerOrderLineId: i.customerOrderLineId, params: i.params })),
    });
    return c.json(await detail(ctx, c.req.valid('param').id));
  })
  .delete('/:id', write, zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    const doc = await documentDetail(ctx.db, id);
    if (doc.type !== 'production_order') throw new AppError(422, 'invalid_type', 'This is not a production order');
    await deleteDocument(ctx.db, docCtx(ctx), id);
    return c.json({ id, deleted: true as const });
  })
  // снимок спецификации в заказ
  .post('/:id/fill-from-bom', write, zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    await fillOrderFromBom(ctx.db, docCtx(ctx), c.req.valid('param').id);
    return c.json(await detail(ctx, c.req.valid('param').id));
  })
  // обеспечение материалов заказа: покрытие по строкам состава и расшифровки (резервы, размещение, к поступлению)
  .get('/:id/materials', zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const id = c.req.valid('param').id;
    await documentDetail(ctx.db, id); // чужой заказ — 404
    const items = await materialRows(ctx.db, id);
    return c.json({ items });
  })
  // правка резерва строки материала: сколько в резерв и на каком складе
  .patch('/:id/materials/:componentId/reservation', write, zValidator('param', materialParam, validationHook), zValidator('json', materialReservationUpdate, validationHook), async c => {
    const ctx = ctxOf(c);
    const { id, componentId } = c.req.valid('param');
    const body = c.req.valid('json');
    await documentDetail(ctx.db, id); // чужой заказ — 404
    await setMaterialReservation(ctx.db, ctx.workspaceId, id, componentId, { qty: body.qty, warehouseId: body.warehouseId });
    return c.json({ items: await materialRows(ctx.db, id) });
  })
  // дочерние заказы на полуфабрикаты по дефициту
  .post('/:id/semi-orders', write, zValidator('param', idParam, validationHook), zValidator('json', semiOrdersCreate, validationHook), async c => {
    const ctx = ctxOf(c);
    const res = await createSemiOrders(ctx.db, docCtx(ctx), c.req.valid('param').id, { date: c.req.valid('json').date });
    return c.json(res, 201);
  })
  // заказы поставщику по не обеспеченным материалам (размещение)
  .post('/:id/supplier-orders', write, zValidator('param', idParam, validationHook), zValidator('json', supplierOrdersCreate, validationHook), async c => {
    const ctx = ctxOf(c);
    const body = c.req.valid('json');
    const res = await createSupplierOrdersForOrder(ctx.db, docCtx(ctx), c.req.valid('param').id, { date: body.date, supplierId: body.supplierId ?? null, comment: body.comment });
    return c.json(res, 201);
  })
  // выпуск по заказу на производство
  .post('/:id/production', write, zValidator('param', idParam, validationHook), zValidator('json', productionCreate, validationHook), async c => {
    const ctx = ctxOf(c);
    const body = c.req.valid('json');
    const id = await createProductionFromOrder(ctx.db, docCtx(ctx), c.req.valid('param').id, {
      date: body.date,
      workCenterId: body.workCenterId,
      warehouseId: body.warehouseId,
      targetWarehouseId: body.targetWarehouseId,
      lines: body.lines.map(l => ({ orderItemId: l.orderItemId, stageId: l.stageId ?? null, qty: l.qty })),
    });
    return c.json(await detail(ctx, id), 201);
  })
  // автопланирование: операции расставляются от даты старта по порядку этапов в пределах свободной мощности
  .post('/:id/schedule', write, zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const res = await scheduleProductionOrder(ctx.db, docCtx(ctx), c.req.valid('param').id);
    return c.json(res);
  })
  // состояние заказа (отдельно от проведения)
  .post('/:id/state', write, zValidator('param', idParam, validationHook), zValidator('json', documentStateChange, validationHook), async c => {
    const ctx = ctxOf(c);
    await changeDocumentState(ctx.db, docCtx(ctx), c.req.valid('param').id, c.req.valid('json').state);
    return c.json(await detail(ctx, c.req.valid('param').id));
  })
  // выпуск прямо из заказа покупателя
  .post('/production', write, zValidator('json', productionFromCustomerOrder, validationHook), async c => {
    const ctx = ctxOf(c);
    const body = c.req.valid('json');
    const id = await createProductionFromCustomerOrder(ctx.db, docCtx(ctx), {
      customerOrderId: body.customerOrderId,
      date: body.date,
      workCenterId: body.workCenterId,
      warehouseId: body.warehouseId,
      targetWarehouseId: body.targetWarehouseId,
      lines: body.lines.map(l => ({ customerOrderLineId: l.customerOrderLineId, stageId: l.stageId ?? null, qty: l.qty })),
    });
    return c.json(await detail(ctx, id), 201);
  })
  // заказ на производство по заказу покупателя: строки, у которых товар производится
  .post('/from-customer-order', write, zValidator('json', productionOrderFromCustomerOrder, validationHook), async c => {
    const ctx = ctxOf(c);
    const body = c.req.valid('json');
    const id = await createProductionOrderFromCustomerOrder(ctx.db, docCtx(ctx), {
      customerOrderId: body.customerOrderId,
      date: body.date,
      workCenterId: body.workCenterId,
      warehouseId: body.warehouseId,
      targetWarehouseId: body.targetWarehouseId,
    });
    return c.json(await detail(ctx, id), 201);
  });