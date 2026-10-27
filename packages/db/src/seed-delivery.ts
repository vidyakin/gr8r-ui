/* Демо доставки (задача 1100, часть 1): два способа (свой курьер, курьерская служба) с тарифами, услуга «Доставка» в каталоге,
   веса у пары товаров, два курьера и три доставки в разных статусах (назначена, в пути, доставлена). Всё — настоящими сервисами. */
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { Db } from './client';
import { addDeliveryToDocument, assignCourier, changeDeliveryStatus, createDeliveryMethod, saveDelivery } from './delivery';
import type { DocCtx } from './documents';
import { memberIdsWithFunction } from './positions';
import { documentLines, documents, members, products } from './schema';

const iso = (daysAhead: number) => new Date(Date.now() + daysAhead * 864e5).toISOString().slice(0, 10);

export async function seedDelivery(db: Db, ctx: DocCtx, o: { carrierId: string; repairWorkOrderId: string }) {
  const wsId = ctx.workspaceId;
  // услуга «Доставка по городу» из каталога — строка документа
  const [service] = await db.select({ id: products.id }).from(products).where(and(eq(products.workspaceId, wsId), eq(products.sku, 'SV-DLV'))).limit(1);
  if (!service) return;

  const own = await createDeliveryMethod(db, ctx, { name: 'Свой курьер', kind: 'own_courier', productId: service.id, clientRate: { base: '300', perKm: '25', perKg: '5', min: '500' }, costRate: { base: '150', perKm: '15', perKg: '2', min: '250' }, freeFrom: '50000' });
  const svc = await createDeliveryMethod(db, ctx, { name: 'Курьерская служба «Быстро»', kind: 'courier_service', productId: service.id, carrierCompanyId: o.carrierId, clientRate: { base: '450', perKm: '30', perKg: '8', min: '700' }, costRate: { base: '380', perKm: '22', perKg: '6', min: '600' } });

  // курьеры: участники с должностью «Курьер» (seedPositions), без должностей — первые два активных, кроме автора
  const withFn = await memberIdsWithFunction(db, 'courier');
  const active = await db.select({ id: members.id }).from(members).where(and(eq(members.workspaceId, wsId), eq(members.status, 'active'), ne(members.id, ctx.memberId ?? ''))).orderBy(asc(members.createdAt), asc(members.id));
  const people = (withFn ? active.filter(m => withFn.has(m.id)) : active).slice(0, 2);
  const courier = people[0]?.id ?? null;

  // документы доставки: заказы покупателей и ремонтный заказ-наряд
  const orders = await db.select({ id: documents.id, status: documents.status }).from(documents).where(and(eq(documents.workspaceId, wsId), eq(documents.type, 'customer_order'), ne(documents.status, 'cancelled'))).orderBy(sql`(${documents.status} = 'draft') desc`, asc(documents.createdAt)).limit(2);
  if (!orders.length) return;

  // вес: у товаров первого заказа
  const lineProducts = await db.select({ productId: documentLines.productId }).from(documentLines).where(inArray(documentLines.documentId, orders.map(x => x.id)));
  const goods = (await db.select({ id: products.id }).from(products).where(and(inArray(products.id, [...new Set(lineProducts.map(l => l.productId))]), eq(products.kind, 'goods')))).slice(0, 2);
  for (const [i, g] of goods.entries()) await db.update(products).set({ weightKg: i === 0 ? '12.500' : '3.200' }).where(eq(products.id, g.id));

  // 1. назначена своему курьеру на сегодня, строка-услуга в черновике заказа
  const d1 = await saveDelivery(db, ctx, orders[0]!.id, { methodId: own.id, distanceKm: '14', deliveryDate: iso(0), windowFrom: '10:00', windowTo: '13:00', courierMemberId: courier, recalcWeight: true });
  if (orders[0]!.status === 'draft') await addDeliveryToDocument(db, ctx, d1.id);

  // 2. доставлена службой: расход на статью «Доставка»
  if (orders[1]) {
    const d2 = await saveDelivery(db, ctx, orders[1].id, { methodId: svc.id, distanceKm: '32', deliveryDate: iso(0), windowFrom: '14:00', windowTo: '18:00', recalcWeight: true, comment: 'Оставить на проходной' });
    await changeDeliveryStatus(db, ctx, d2.id, 'in_transit');
    await changeDeliveryStatus(db, ctx, d2.id, 'delivered');
  }

  // 3. заказ-наряд ремонта: курьер в пути; себестоимость пойдёт в себестоимость заказ-наряда после «доставлена»
  const d3 = await saveDelivery(db, ctx, o.repairWorkOrderId, { methodId: own.id, distanceKm: '8', deliveryDate: iso(0), windowFrom: '16:00', windowTo: '19:00', courierMemberId: people[1]?.id ?? courier });
  const [wo] = await db.select({ status: documents.status }).from(documents).where(eq(documents.id, o.repairWorkOrderId)).limit(1);
  if (wo?.status === 'draft') await addDeliveryToDocument(db, ctx, d3.id);
  if (d3.courierMemberId) await changeDeliveryStatus(db, ctx, d3.id, 'in_transit');
  else await assignCourier(db, ctx, d3.id, null);
}
