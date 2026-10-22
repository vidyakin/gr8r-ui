/* Планирование загрузки: справочник ключевых ресурсов (оборудование), потребность в ресурсах (норматив у товара)
   и закладка «Ресурсы» документа (заказ на производство, заказ-наряд). Таблицы арендатора (workspace_id + RLS). */
import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, numeric, pgTable, primaryKey, text, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { archivedAt, createdAt, pk, ts, updatedAt } from './columns';
import { products } from './catalog';
import { documentLines, documents } from './documents';
import { wsCol } from './people';
import { workCenters } from './production';
import { workCalendars } from './calendars';

/** Ключевой ресурс: оборудование или прочий ресурс, который занимает время работы */
export const resources = pgTable(
  'resources',
  {
    id: pk(),
    workspaceId: wsCol(),
    code: text('code').notNull().default(''),
    name: text('name').notNull(),
    /** Вид ресурса: equipment — оборудование, other — прочий */
    kind: text('kind', { enum: ['equipment', 'other'] }).notNull().default('equipment'),
    /** Участок, в котором ресурс работает */
    workCenterId: uuid('work_center_id'),
    /** Сколько единиц ресурса доступно одновременно */
    capacityUnits: integer('capacity_units').notNull().default(1),
    /** Рабочий график ресурса */
    calendarId: uuid('calendar_id'),
    note: text('note').notNull().default(''),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  t => [
    unique('resources_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.workCenterId], foreignColumns: [workCenters.workspaceId, workCenters.id], name: 'resources_work_center_fk' }),
    foreignKey({ columns: [t.workspaceId, t.calendarId], foreignColumns: [workCalendars.workspaceId, workCalendars.id], name: 'resources_calendar_fk' }),
    check('resources_capacity_chk', sql`${t.capacityUnits} > 0`),
    uniqueIndex('resources_ws_name_uq').on(t.workspaceId, sql`lower(${t.name})`).where(sql`${t.archivedAt} is null`),
    index('resources_ws_idx').on(t.workspaceId),
  ],
);

/** Норматив потребности в ресурсе: у операции или работы — сколько часов ресурса на единицу */
export const productResources = pgTable(
  'product_resources',
  {
    workspaceId: wsCol(),
    /** Товар каталога (операция или работа) */
    productId: uuid('product_id').notNull(),
    /** Ресурс */
    resourceId: uuid('resource_id').notNull(),
    /** Часов ресурса на единицу продукции */
    hoursPerUnit: numeric('hours_per_unit', { precision: 10, scale: 3 }).notNull().default('0'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    primaryKey({ columns: [t.workspaceId, t.productId, t.resourceId] }),
    foreignKey({ columns: [t.workspaceId, t.productId], foreignColumns: [products.workspaceId, products.id], name: 'product_resources_product_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.resourceId], foreignColumns: [resources.workspaceId, resources.id], name: 'product_resources_resource_fk' }).onDelete('cascade'),
    check('product_resources_hours_chk', sql`${t.hoursPerUnit} >= 0`),
    index('product_resources_resource_idx').on(t.workspaceId, t.resourceId),
  ],
);

/** Ресурсы документа: закладка «Ресурсы» заказа на производство и заказ-наряда */
export const documentResources = pgTable(
  'document_resources',
  {
    id: pk(),
    workspaceId: wsCol(),
    /** Документ (заказ на производство, заказ-наряд) */
    documentId: uuid('document_id').notNull(),
    /** Строка документа, к которой относится ресурс */
    lineId: uuid('line_id'),
    /** Ресурс */
    resourceId: uuid('resource_id').notNull(),
    /** Начало интервала работы ресурса */
    startAt: ts('start_at'),
    /** Конец интервала */
    endAt: ts('end_at'),
    /** Часы работы ресурса */
    hours: numeric('hours', { precision: 10, scale: 3 }).notNull().default('0'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    unique('document_resources_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.documentId], foreignColumns: [documents.workspaceId, documents.id], name: 'document_resources_document_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.lineId], foreignColumns: [documentLines.workspaceId, documentLines.id], name: 'document_resources_line_fk' }),
    foreignKey({ columns: [t.workspaceId, t.resourceId], foreignColumns: [resources.workspaceId, resources.id], name: 'document_resources_resource_fk' }),
    check('document_resources_hours_chk', sql`${t.hours} >= 0`),
    index('document_resources_document_idx').on(t.workspaceId, t.documentId, t.sortOrder),
    index('document_resources_resource_idx').on(t.workspaceId, t.resourceId),
  ],
);
