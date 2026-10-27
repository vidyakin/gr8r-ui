/* Демо ремонта и серийных номеров (задача 1099): товар с учётом по номерам (поступление с номерами, продажа с гарантией),
   виды «Ремонт» и «Гарантийный ремонт» со своими состояниями, ремонтный и гарантийный заказ-наряды. Всё проводится
   настоящими сервисами; даты — относительно сегодняшнего дня. */
import { eq } from 'drizzle-orm';
import type { Db } from './client';
import { createDocument, ensureCostItems, postDocument, updateDocument, changeDocumentState, type DocCtx } from './documents';
import { saveRepairItem, saveCustomerMaterials } from './repair';
import { saveWorkOrderMaterials } from './work-orders';
import { documentStates, products, workOrderKinds } from './schema';

const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 864e5).toISOString().slice(0, 10);

/** Состояния ремонтных видов: принят → диагностика → в ремонте → готов → выдан / отменён */
const REPAIR_STATES: { key: string; label: string; category: 'new' | 'scheduled' | 'in_progress' | 'done' | 'delivered' | 'cancelled'; color: string }[] = [
  { key: 'accepted', label: 'Принят', category: 'new', color: 'gray' },
  { key: 'diagnostics', label: 'Диагностика', category: 'scheduled', color: 'blue' },
  { key: 'repairing', label: 'В ремонте', category: 'in_progress', color: 'amber' },
  { key: 'ready', label: 'Готов', category: 'done', color: 'green' },
  { key: 'issued', label: 'Выдан', category: 'delivered', color: 'teal' },
  { key: 'cancelled', label: 'Отменён', category: 'cancelled', color: 'red' },
];

/** Виды «Ремонт» и «Гарантийный ремонт» со своими состояниями */
export async function seedRepairKinds(db: Db, wsId: string): Promise<{ repair: string; warranty: string }> {
  const out: Record<string, string> = {};
  for (const [i, k] of [{ key: 'repair', name: 'Ремонт', type: 'repair' as const }, { key: 'warranty', name: 'Гарантийный ремонт', type: 'warranty' as const }].entries()) {
    const [kind] = await db.insert(workOrderKinds).values({ workspaceId: wsId, name: k.name, kindType: k.type, sortOrder: i + 1 }).returning({ id: workOrderKinds.id });
    await db.insert(documentStates).values(REPAIR_STATES.map((s, n) => ({ workspaceId: wsId, kindId: kind!.id, key: s.key, label: s.label, color: s.color, category: s.category, sortOrder: n })));
    out[k.key] = kind!.id;
  }
  return { repair: out.repair!, warranty: out.warranty! };
}

export async function seedRepair(db: Db, ctx: DocCtx, o: { warehouseId: string; supplierId: string; customerId: string; partProductId: string; workProductId: string }) {
  const wsId = ctx.workspaceId;
  await ensureCostItems(db, wsId);
  const kinds = await seedRepairKinds(db, wsId);
  const [phone] = await db
    .insert(products)
    .values({ workspaceId: wsId, kind: 'goods', sku: 'EL-PHN-1', name: 'Смартфон «Атлас X1»', unitCode: '796', vatRate: '20', price: '24000.00', purchasePrice: '15000.00', trackSerials: true, warrantyMonths: 12 })
    .returning({ id: products.id });
  const post = async (id: string, daysAgo: number) => {
    await updateDocument(db, ctx, id, { date: iso(daysAgo) });
    await postDocument(db, ctx, id);
  };
  // поступление пяти аппаратов с серийными номерами
  const serials = ['ATL-X1-0001', 'ATL-X1-0002', 'ATL-X1-0003', 'ATL-X1-0004', 'ATL-X1-0005'];
  const receipt = await createDocument(db, ctx, { type: 'receipt', counterpartyId: o.supplierId, warehouseId: o.warehouseId, priceIncludesVat: true, date: iso(40), lines: [{ productId: phone!.id, qty: '5', price: '15000', discountPct: '0', serials }] });
  await post(receipt, 40);
  // продажа двух аппаратов с гарантией 12 месяцев
  const sale = await createDocument(db, ctx, { type: 'realization', counterpartyId: o.customerId, warehouseId: o.warehouseId, priceIncludesVat: true, date: iso(30), lines: [{ productId: phone!.id, qty: '2', price: '24000', discountPct: '0', serials: serials.slice(0, 2) }] });
  await post(sale, 30);

  // ремонт: аппарат клиента принят на диагностику (склад не затрагивается), клиент принёс чехол
  const repair = await createDocument(db, ctx, {
    type: 'work_order',
    counterpartyId: o.customerId,
    warehouseId: o.warehouseId,
    workOrderKindId: kinds.repair,
    date: iso(2),
    comment: 'Платный ремонт: разбит экран',
    lines: [{ productId: o.workProductId, qty: '1', price: '3500', discountPct: '0' }],
  });
  await saveRepairItem(db, ctx, repair, { productId: phone!.id, serialText: serials[0], defect: 'Разбит экран, не реагирует на касания', completeness: 'Аппарат, зарядное устройство', appearance: 'Скол в левом верхнем углу', receivedAt: iso(2) });
  await saveCustomerMaterials(db, ctx, repair, [{ name: 'Защитный чехол клиента', qty: '1', comment: 'вернуть после ремонта' }]);
  await changeDocumentState(db, ctx, repair, 'diagnostics');

  // гарантийный ремонт: выручки нет, запчасть и работа — на статью «Гарантийный ремонт»
  const warranty = await createDocument(db, ctx, {
    type: 'work_order',
    counterpartyId: o.customerId,
    warehouseId: o.warehouseId,
    workOrderKindId: kinds.warranty,
    date: iso(1),
    comment: 'Гарантийный случай: заводской брак камеры',
    lines: [{ productId: o.workProductId, qty: '1', price: '0', discountPct: '0' }],
  });
  await saveRepairItem(db, ctx, warranty, { productId: phone!.id, serialText: serials[1], defect: 'Не работает основная камера', completeness: 'Аппарат', appearance: 'Без повреждений', receivedAt: iso(1) });
  await saveWorkOrderMaterials(db, ctx, warranty, [{ productId: o.partProductId, qty: '1' }]);
  await changeDocumentState(db, ctx, warranty, 'repairing');
  await changeDocumentState(db, ctx, warranty, 'ready');
  void eq;
  return { phoneId: phone!.id, repair, warranty };
}
