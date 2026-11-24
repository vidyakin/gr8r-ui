/* Добыча (подмодуль производства): взвешивания на весовой. Таблица арендатора (workspace_id + RLS). */
import { sql } from 'drizzle-orm';
import { check, foreignKey, index, numeric, pgTable, text, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { archivedAt, createdAt, pk, ts } from './columns';
import { products } from './catalog';
import { companies } from './crm';
import { fleetVehicles } from './fleet';
import { wsCol } from './tenant';

const kg = (name: string) => numeric(name, { precision: 14, scale: 3 });

export const weighings = pgTable(
  'weighings',
  {
    id: pk(),
    workspaceId: wsCol(),
    number: text('number').notNull(),
    weighedAt: ts('weighed_at').notNull().defaultNow(),
    /** out — отгрузка (вывоз), in — приёмка (ввоз) */
    direction: text('direction', { enum: ['out', 'in'] }).notNull().default('out'),
    vehicleId: uuid('vehicle_id'),
    plateNumber: text('plate_number').notNull().default(''),
    driverName: text('driver_name').notNull().default(''),
    counterpartyId: uuid('counterparty_id'),
    productId: uuid('product_id'),
    grossKg: kg('gross_kg').notNull().default('0'),
    tareKg: kg('tare_kg').notNull().default('0'),
    netKg: kg('net_kg').notNull().default('0'),
    /** Насыпная плотность, т/м³ */
    bulkDensity: numeric('bulk_density', { precision: 10, scale: 4 }),
    volumeM3: numeric('volume_m3', { precision: 14, scale: 3 }),
    waybillNumber: text('waybill_number').notNull().default(''),
    source: text('source', { enum: ['manual', 'scale_api'] }).notNull().default('manual'),
    notes: text('notes').notNull().default(''),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    archivedAt: archivedAt(),
  },
  t => [
    unique('weighings_ws_id_uq').on(t.workspaceId, t.id),
    uniqueIndex('weighings_ws_number_uq').on(t.workspaceId, t.number),
    index('weighings_ws_weighed_idx').on(t.workspaceId, t.weighedAt),
    index('weighings_ws_product_idx').on(t.workspaceId, t.productId),
    index('weighings_ws_vehicle_idx').on(t.workspaceId, t.vehicleId),
    foreignKey({ columns: [t.workspaceId, t.vehicleId], foreignColumns: [fleetVehicles.workspaceId, fleetVehicles.id], name: 'weighings_vehicle_fk' }),
    foreignKey({ columns: [t.workspaceId, t.counterpartyId], foreignColumns: [companies.workspaceId, companies.id], name: 'weighings_counterparty_fk' }),
    foreignKey({ columns: [t.workspaceId, t.productId], foreignColumns: [products.workspaceId, products.id], name: 'weighings_product_fk' }),
    check('weighings_direction_chk', sql`${t.direction} in ('out','in')`),
    check('weighings_source_chk', sql`${t.source} in ('manual','scale_api')`),
    check('weighings_weights_chk', sql`${t.tareKg} >= 0 and ${t.grossKg} >= ${t.tareKg}`),
  ],
);
