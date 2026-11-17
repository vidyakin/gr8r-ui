/* Демо согласования (задача 1199): маршрут «Заказ поставщику от 100 000 ₽» (руководитель → бухгалтерия) и один процесс в работе.
   Запускается после документов и должностей: сами демо-документы маршрутом не останавливаются (проверку делает HTTP-проведение). */
import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from './client';
import { createRoute, startApproval } from './approvals';
import { createDocument, type DocCtx } from './documents';
import { createPosition } from './positions';
import { memberPositions, members, products, warehouses } from './schema';

export async function seedApprovals(db: Db, ctx: DocCtx, co: { supplier: string }): Promise<void> {
  const ws = ctx.workspaceId;
  // «Бухгалтерия» — должность; держатель — второй по порядку сотрудник без автора (менеджер): к его должностям она добавляется
  const accountants = await createPosition(db, ctx, { name: 'Бухгалтерия', functions: [], sections: ['finance'], sortOrder: 6 });
  const people = await db.select({ id: members.id }).from(members).where(eq(members.workspaceId, ws));
  const holder = people.find(p => p.id !== ctx.memberId);
  if (holder) await db.insert(memberPositions).values({ workspaceId: ws, memberId: holder.id, positionId: accountants.id }).onConflictDoNothing();

  await createRoute(db, ctx, {
    name: 'Заказ поставщику от 100 000 ₽',
    targetKind: 'document',
    documentType: 'supplier_order',
    amountFrom: '100000',
    required: true,
    sortOrder: 1,
    steps: [
      { name: 'Руководитель', mode: 'sequential', dueHours: 24, participants: [{ memberId: ctx.memberId! }] },
      { name: 'Бухгалтерия', mode: 'parallel', dueHours: 48, participants: [{ positionId: accountants.id }] },
    ],
  });

  // черновик заказа поставщику на сумму выше порога — уже отправлен на согласование (идёт первый этап)
  const [wh] = await db.select({ id: warehouses.id }).from(warehouses).where(eq(warehouses.workspaceId, ws)).limit(1);
  const [oak] = await db.select({ id: products.id, purchasePrice: products.purchasePrice }).from(products).where(and(eq(products.workspaceId, ws), inArray(products.sku, ['MT-OAK-5050']))).limit(1);
  if (!wh || !oak) return;
  const order = await createDocument(db, ctx, {
    type: 'supplier_order',
    counterpartyId: co.supplier,
    warehouseId: wh.id,
    date: new Date().toISOString().slice(0, 10),
    comment: 'Дополнительная партия дуба на согласовании',
    lines: [{ productId: oak.id, qty: '400', price: oak.purchasePrice, discountPct: '0' }],
  });
  await startApproval(db, ctx, { kind: 'document', id: order });
}
