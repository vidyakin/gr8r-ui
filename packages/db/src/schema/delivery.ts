/* Доставка (задача 1100, docs/architecture/delivery.md): способы доставки (справочник) и доставки документов.
   Таблицы арендатора (workspace_id + RLS). Одна доставка на документ; при «на основании» заказа доставка переходит
   к реализации (document_id меняется), у заказа остаётся ссылка origin_document_id. */
import { sql } from 'drizzle-orm';
import { check, date, foreignKey, index, jsonb, numeric, pgTable, text, time, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { archivedAt, createdAt, money, pk, updatedAt } from './columns';
import { products } from './catalog';
import { companies } from './crm';
import { costItems, documentLines, documents } from './documents';
import { members, wsCol } from './people';

/** Тариф: база, за км, за кг, минимум; строки — деньги и числа с точностью decimal */
export interface DeliveryRate {
  base: string;
  perKm: string;
  perKg: string;
  min: string;
}

export const deliveryMethods = pgTable(
  'delivery_methods',
  {
    id: pk(),
    workspaceId: wsCol(),
    name: text('name').notNull(),
    kind: text('kind', { enum: ['own_courier', 'courier_service', 'third_party'] }).notNull().default('own_courier'),
    /** Услуга каталога «Доставка» — строка документа */
    productId: uuid('product_id'),
    /** Перевозчик (компания) — для службы и стороннего */
    carrierCompanyId: uuid('carrier_company_id'),
    /** Тариф для клиента */
    clientRate: jsonb('client_rate').$type<DeliveryRate>().notNull().default({ base: '0', perKm: '0', perKg: '0', min: '0' }),
    /** Тариф себестоимости */
    costRate: jsonb('cost_rate').$type<DeliveryRate>().notNull().default({ base: '0', perKm: '0', perKg: '0', min: '0' }),
    /** Бесплатно для клиента от суммы документа без НДС; пусто — не бывает бесплатной */
    freeFrom: money('free_from'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  t => [
    unique('delivery_methods_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.productId], foreignColumns: [products.workspaceId, products.id], name: 'delivery_methods_product_fk' }),
    foreignKey({ columns: [t.workspaceId, t.carrierCompanyId], foreignColumns: [companies.workspaceId, companies.id], name: 'delivery_methods_carrier_fk' }),
    check('delivery_methods_kind_chk', sql`${t.kind} in ('own_courier','courier_service','third_party')`),
    check('delivery_methods_free_chk', sql`${t.freeFrom} is null or ${t.freeFrom} >= 0`),
    uniqueIndex('delivery_methods_ws_name_uq').on(t.workspaceId, sql`lower(${t.name})`).where(sql`${t.archivedAt} is null`),
  ],
);

export const deliveries = pgTable(
  'deliveries',
  {
    id: pk(),
    workspaceId: wsCol(),
    /** Документ-владелец: заказ покупателя, реализация или заказ-наряд (одна доставка на документ) */
    documentId: uuid('document_id').notNull(),
    /** Заказ, из которого доставка перешла в реализацию («ссылка» у заказа) */
    originDocumentId: uuid('origin_document_id'),
    methodId: uuid('method_id'),
    address: text('address').notNull().default(''),
    contactName: text('contact_name').notNull().default(''),
    contactPhone: text('contact_phone').notNull().default(''),
    deliveryDate: date('delivery_date', { mode: 'string' }),
    windowFrom: time('window_from'),
    windowTo: time('window_to'),
    distanceKm: numeric('distance_km', { precision: 12, scale: 3 }).notNull().default('0'),
    /** Координаты адреса (задача 1213): геокодер в фоне при сохранении или ввод вручную; источник и итог геокодирования */
    lat: numeric('lat', { precision: 9, scale: 6 }),
    lon: numeric('lon', { precision: 9, scale: 6 }),
    geoSource: text('geo_source', { enum: ['manual', 'geocoder'] }),
    geoStatus: text('geo_status', { enum: ['pending', 'ok', 'approx', 'not_found', 'error'] }),
    weightKg: numeric('weight_kg', { precision: 18, scale: 3 }).notNull().default('0'),
    /** Цена для клиента и наша себестоимость: посчитаны по тарифу, можно поправить */
    price: money('price').notNull().default('0'),
    ourCost: money('our_cost').notNull().default('0'),
    courierMemberId: uuid('courier_member_id'),
    carrierCompanyId: uuid('carrier_company_id'),
    status: text('status', { enum: ['new', 'assigned', 'in_transit', 'delivered', 'failed'] }).notNull().default('new'),
    comment: text('comment').notNull().default(''),
    /** Строка-услуга «Доставка» в документе (после «Добавить в документ») */
    lineId: uuid('line_id'),
    /** Расход в финансовый результат: статья «Доставка», сумма и день (пишется при «доставлена», снимается при откате) */
    expenseCostItemId: uuid('expense_cost_item_id'),
    expenseAmount: money('expense_amount'),
    expensedAt: date('expensed_at', { mode: 'string' }),
    deliveredAt: date('delivered_at', { mode: 'string' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    unique('deliveries_ws_id_uq').on(t.workspaceId, t.id),
    uniqueIndex('deliveries_document_uq').on(t.documentId),
    foreignKey({ columns: [t.workspaceId, t.documentId], foreignColumns: [documents.workspaceId, documents.id], name: 'deliveries_document_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.originDocumentId], foreignColumns: [documents.workspaceId, documents.id], name: 'deliveries_origin_fk' }).onDelete('set null'),
    foreignKey({ columns: [t.workspaceId, t.methodId], foreignColumns: [deliveryMethods.workspaceId, deliveryMethods.id], name: 'deliveries_method_fk' }),
    foreignKey({ columns: [t.workspaceId, t.courierMemberId], foreignColumns: [members.workspaceId, members.id], name: 'deliveries_courier_fk' }),
    foreignKey({ columns: [t.workspaceId, t.carrierCompanyId], foreignColumns: [companies.workspaceId, companies.id], name: 'deliveries_carrier_fk' }),
    foreignKey({ columns: [t.workspaceId, t.lineId], foreignColumns: [documentLines.workspaceId, documentLines.id], name: 'deliveries_line_fk' }).onDelete('set null'),
    foreignKey({ columns: [t.workspaceId, t.expenseCostItemId], foreignColumns: [costItems.workspaceId, costItems.id], name: 'deliveries_expense_item_fk' }),
    check('deliveries_status_chk', sql`${t.status} in ('new','assigned','in_transit','delivered','failed')`),
    check('deliveries_amounts_chk', sql`${t.price} >= 0 and ${t.ourCost} >= 0 and ${t.distanceKm} >= 0 and ${t.weightKg} >= 0`),
    index('deliveries_date_idx').on(t.workspaceId, t.deliveryDate),
    index('deliveries_courier_idx').on(t.courierMemberId),
    index('deliveries_method_idx').on(t.methodId),
  ],
);
