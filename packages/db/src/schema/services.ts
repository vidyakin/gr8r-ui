/* Заказ-наряд: настраиваемые состояния, материалы к списанию и назначения (исполнители — задачи модуля services).
   Все таблицы арендаторские (workspace_id + RLS), связи внутри арендатора — составные внешние ключи (workspace_id, id). */
import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, numeric, pgTable, primaryKey, text, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, pk, ts, updatedAt } from './columns';
import { products } from './catalog';
import { documentLines, documents, warehouses, workOrderKinds } from './documents';
import { tasks } from './work';
import { wsCol } from './people';
import { workCenters } from './production';

export const documentStates = pgTable(
  'document_states',
  {
    id: pk(),
    workspaceId: wsCol(),
    /** Тип документа, у которого состояния настраивает воркспейс (пока только заказ-наряд) */
    documentType: text('document_type').notNull().default('work_order'),
    /** Вид заказ-наряда: у каждого вида свой упорядоченный набор состояний */
    kindId: uuid('kind_id').notNull(),
    /** Ключ состояния: в нём хранится documents.state */
    key: text('key').notNull(),
    label: text('label').notNull(),
    /** Токен цвета состояния */
    color: text('color').notNull().default('gray'),
    /** Категория состояния: по ней решается, что происходит с заказом (продажа при «done») */
    category: text('category', { enum: ['new', 'scheduled', 'in_progress', 'done', 'delivered', 'cancelled'] }).notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    unique('document_states_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.kindId], foreignColumns: [workOrderKinds.workspaceId, workOrderKinds.id], name: 'document_states_kind_fk' }).onDelete('cascade'),
    uniqueIndex('document_states_kind_key_uq').on(t.workspaceId, t.kindId, t.key),
    check('document_states_category_chk', sql`${t.category} in ('new','scheduled','in_progress','done','delivered','cancelled')`),
    index('document_states_kind_idx').on(t.workspaceId, t.kindId, t.sortOrder),
  ],
);

/** Материалы заказ-наряда: израсходованы на работу, отдельно от продаваемых строк */
export const workOrderMaterials = pgTable(
  'work_order_materials',
  {
    id: pk(),
    workspaceId: wsCol(),
    documentId: uuid('document_id').notNull(),
    productId: uuid('product_id').notNull(),
    qty: numeric('qty', { precision: 18, scale: 3 }).notNull(),
    unitCode: text('unit_code').notNull().default('796'),
    /** Склад списания: пусто — склад документа */
    warehouseId: uuid('warehouse_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    unique('work_order_materials_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.documentId], foreignColumns: [documents.workspaceId, documents.id], name: 'work_order_materials_document_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.productId], foreignColumns: [products.workspaceId, products.id], name: 'work_order_materials_product_fk' }),
    foreignKey({ columns: [t.workspaceId, t.warehouseId], foreignColumns: [warehouses.workspaceId, warehouses.id], name: 'work_order_materials_warehouse_fk' }),
    check('work_order_materials_qty_chk', sql`${t.qty} > 0`),
    index('work_order_materials_document_idx').on(t.documentId),
  ],
);

/** Способы выставления строки работы заказ-наряда: по норме (количество × цена) или по фактическим часам */
export const workOrderLines = pgTable(
  'work_order_lines',
  {
    workspaceId: wsCol(),
    /** Строка заказ-наряда (работа) */
    lineId: uuid('line_id').notNull(),
    /** Заказ-наряд */
    documentId: uuid('document_id').notNull(),
    /** Способ выставления: norm или hours */
    billing: text('billing', { enum: ['norm', 'hours'] }).notNull().default('norm'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    primaryKey({ columns: [t.workspaceId, t.lineId] }),
    foreignKey({ columns: [t.workspaceId, t.documentId], foreignColumns: [documents.workspaceId, documents.id], name: 'work_order_lines_document_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.lineId], foreignColumns: [documentLines.workspaceId, documentLines.id], name: 'work_order_lines_line_fk' }).onDelete('cascade'),
    check('work_order_lines_billing_chk', sql`${t.billing} in ('norm','hours')`),
    index('work_order_lines_document_idx').on(t.documentId),
  ],
);

/** Назначения заказ-наряда: исполнитель — задача модуля services (время пишется на неё, как у обычных задач) */
export const workOrderAssignments = pgTable(
  'work_order_assignments',
  {
    id: pk(),
    workspaceId: wsCol(),
    documentId: uuid('document_id').notNull(),
    /** Задача-назначение: её ключ, статус и время живут в tasks */
    taskId: uuid('task_id').notNull(),
    /** Строка заказ-наряда (работа), к которой относится назначение */
    lineId: uuid('line_id'),
    /** Участок (work_center): пусто — участок не назначен */
    workCenterId: uuid('work_center_id'),
    /** Плановые часы: пусто — норма работы (этап 2) */
    plannedHours: numeric('planned_hours', { precision: 10, scale: 3 }),
    /** Интервал работы по часам: начало (timestamptz) */
    startAt: ts('start_at'),
    /** Интервал работы по часам: конец (timestamptz) */
    endAt: ts('end_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    unique('work_order_assignments_ws_id_uq').on(t.workspaceId, t.id),
    unique('work_order_assignments_task_uq').on(t.taskId),
    foreignKey({ columns: [t.workspaceId, t.documentId], foreignColumns: [documents.workspaceId, documents.id], name: 'work_order_assignments_document_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.taskId], foreignColumns: [tasks.workspaceId, tasks.id], name: 'work_order_assignments_task_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.lineId], foreignColumns: [documentLines.workspaceId, documentLines.id], name: 'work_order_assignments_line_fk' }),
    foreignKey({ columns: [t.workspaceId, t.workCenterId], foreignColumns: [workCenters.workspaceId, workCenters.id], name: 'work_order_assignments_work_center_fk' }),
    check('work_order_assignments_interval_chk', sql`${t.endAt} is null or ${t.startAt} is null or ${t.endAt} > ${t.startAt}`),
    index('work_order_assignments_document_idx').on(t.documentId),
  ],
);
