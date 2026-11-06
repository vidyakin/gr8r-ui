/* Объекты объектного учёта (задача 1268, docs/architecture/construction.md): справочник объектов, прорабы и договоры.
   Таблицы арендатора (workspace_id + RLS), связи — составные FK. Ссылки на проекты задач, склады и договоры
   добавляются в SQL-миграции, чтобы не замыкать круг импортов схем (objects ↔ work/documents/billing). */
import { sql } from 'drizzle-orm';
import { check, date, foreignKey, index, integer, jsonb, numeric, pgTable, text, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { archivedAt, createdAt, money, pk, ts, updatedAt } from './columns';
import { products, units } from './catalog';
import { companies } from './crm';
import { members, wsCol } from './people';
import { manufacturedItems } from './production';

export const objects = pgTable(
  'objects',
  {
    id: pk(),
    workspaceId: wsCol(),
    /** Код объекта: уникален в воркспейсе (без учёта регистра, среди неархивных) */
    number: text('number').notNull(),
    name: text('name').notNull(),
    /** Основной заказчик */
    customerId: uuid('customer_id'),
    address: text('address').notNull().default(''),
    startDate: date('start_date', { mode: 'string' }),
    dueDate: date('due_date', { mode: 'string' }),
    status: text('status', { enum: ['planning', 'active', 'hold', 'done', 'closed'] }).notNull().default('planning'),
    /** Ответственный участник */
    managerId: uuid('manager_id'),
    /** Способ выручки: акты, вехи, часы */
    revenueMode: text('revenue_mode', { enum: ['acts', 'milestones', 'hours'] }).notNull().default('acts'),
    /** Процент накладных от прямых затрат */
    overheadPct: numeric('overhead_pct', { precision: 5, scale: 2 }).notNull().default('0'),
    /** Контроль бюджета (задача 1270): none — не контролировать, warn — предупредить, block — запретить проведение */
    budgetPolicy: text('budget_policy', { enum: ['none', 'warn', 'block'] }).notNull().default('warn'),
    /** Как считать процент выполнения (задача 1272): по закрытым задачам, среднему прогрессу, весам, объёмам сметы, вручную */
    progressMode: text('progress_mode', { enum: ['tasks_closed', 'tasks_avg', 'task_weights', 'estimate_volume', 'manual'] })
      .notNull()
      .default('tasks_closed'),
    /** Ручной процент выполнения 0–100 (только для режима manual) */
    progressManual: numeric('progress_manual', { precision: 5, scale: 2 }),
    /** Свой проект задач (график, Гант): составной FK (workspace_id, project_id) → projects добавляет миграция */
    projectId: uuid('project_id'),
    /** Склад объекта (необязательно): составной FK (workspace_id, warehouse_id) → warehouses добавляет миграция */
    warehouseId: uuid('warehouse_id'),
    note: text('note').notNull().default(''),
    archivedAt: archivedAt(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    unique('objects_ws_id_uq').on(t.workspaceId, t.id),
    uniqueIndex('objects_ws_number_uq')
      .on(t.workspaceId, sql`lower(${t.number})`)
      .where(sql`${t.archivedAt} is null`),
    foreignKey({ columns: [t.workspaceId, t.customerId], foreignColumns: [companies.workspaceId, companies.id], name: 'objects_customer_fk' }),
    foreignKey({ columns: [t.workspaceId, t.managerId], foreignColumns: [members.workspaceId, members.id], name: 'objects_manager_fk' }),
    check('objects_status_chk', sql`${t.status} in ('planning','active','hold','done','closed')`),
    check('objects_revenue_mode_chk', sql`${t.revenueMode} in ('acts','milestones','hours')`),
    check('objects_overhead_chk', sql`${t.overheadPct} >= 0 and ${t.overheadPct} <= 100`),
    check('objects_budget_policy_chk', sql`${t.budgetPolicy} in ('none','warn','block')`),
    check('objects_progress_mode_chk', sql`${t.progressMode} in ('tasks_closed','tasks_avg','task_weights','estimate_volume','manual')`),
    check('objects_progress_manual_chk', sql`${t.progressManual} is null or (${t.progressManual} >= 0 and ${t.progressManual} <= 100)`),
    index('objects_ws_status_idx').on(t.workspaceId, t.status),
  ],
);

/** Прорабы объекта (назначенные участники) */
export const objectForemen = pgTable(
  'object_foremen',
  {
    workspaceId: wsCol(),
    objectId: uuid('object_id').notNull(),
    memberId: uuid('member_id').notNull(),
    createdAt: createdAt(),
  },
  t => [
    unique('object_foremen_ws_id_uq').on(t.workspaceId, t.objectId, t.memberId),
    foreignKey({ columns: [t.workspaceId, t.objectId], foreignColumns: [objects.workspaceId, objects.id], name: 'object_foremen_object_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.memberId], foreignColumns: [members.workspaceId, members.id], name: 'object_foremen_member_fk' }).onDelete('cascade'),
    index('object_foremen_object_idx').on(t.objectId),
  ],
);

/** Договоры объекта: ссылки на общий справочник contracts (составной FK добавляет миграция) */
export const objectContracts = pgTable(
  'object_contracts',
  {
    workspaceId: wsCol(),
    objectId: uuid('object_id').notNull(),
    contractId: uuid('contract_id').notNull(),
    createdAt: createdAt(),
  },
  t => [
    unique('object_contracts_ws_id_uq').on(t.workspaceId, t.objectId, t.contractId),
    foreignKey({ columns: [t.workspaceId, t.objectId], foreignColumns: [objects.workspaceId, objects.id], name: 'object_contracts_object_fk' }).onDelete('cascade'),
    index('object_contracts_object_idx').on(t.objectId),
  ],
);

/** Смета объекта (задача 1269): у объекта одна основная смета (kind = 'main') и любое число допработ (kind = 'change').
    Согласованная смета — снимок цен и норм: состав больше не правится (сервис отвечает 422 estimate_approved). */
export const objectEstimates = pgTable(
  'object_estimates',
  {
    id: pk(),
    workspaceId: wsCol(),
    objectId: uuid('object_id').notNull(),
    number: text('number').notNull().default(''),
    name: text('name').notNull(),
    status: text('status', { enum: ['draft', 'approved'] }).notNull().default('draft'),
    approvedAt: ts('approved_at'),
    /** Кто согласовал смету */
    approvedBy: uuid('approved_by'),
    /** Основная смета, к которой относится дополнение (у основной — null) */
    parentId: uuid('parent_id'),
    /** main — основная смета объекта, change — дополнение (допработы) */
    kind: text('kind', { enum: ['main', 'change'] }).notNull().default('main'),
    /** Статус допработ: draft | approved | rejected (у основной сметы — null) */
    changeStatus: text('change_status', { enum: ['draft', 'approved', 'rejected'] }),
    note: text('note').notNull().default(''),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    unique('object_estimates_ws_id_uq').on(t.workspaceId, t.id),
    // у объекта ровно одна основная смета
    uniqueIndex('object_estimates_main_uq')
      .on(t.workspaceId, t.objectId)
      .where(sql`${t.kind} = 'main'`),
    foreignKey({ columns: [t.workspaceId, t.objectId], foreignColumns: [objects.workspaceId, objects.id], name: 'object_estimates_object_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.approvedBy], foreignColumns: [members.workspaceId, members.id], name: 'object_estimates_approved_by_fk' }).onDelete('set null'),
    foreignKey({ columns: [t.workspaceId, t.parentId], foreignColumns: [t.workspaceId, t.id], name: 'object_estimates_parent_fk' }).onDelete('cascade'),
    check('object_estimates_status_chk', sql`${t.status} in ('draft','approved')`),
    check('object_estimates_kind_chk', sql`${t.kind} in ('main','change')`),
    check(
      'object_estimates_change_status_chk',
      sql`(${t.kind} = 'main' and ${t.changeStatus} is null and ${t.parentId} is null) or (${t.kind} = 'change' and ${t.parentId} is not null and ${t.changeStatus} in ('draft','approved','rejected'))`,
    ),
    index('object_estimates_object_idx').on(t.workspaceId, t.objectId),
  ],
);

/** Раздел сметы (раздел работ): позиции группируются по разделам */
export const objectEstimateSections = pgTable(
  'object_estimate_sections',
  {
    id: pk(),
    workspaceId: wsCol(),
    estimateId: uuid('estimate_id').notNull(),
    name: text('name').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
  },
  t => [
    unique('object_estimate_sections_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.estimateId], foreignColumns: [objectEstimates.workspaceId, objectEstimates.id], name: 'object_estimate_sections_estimate_fk' }).onDelete('cascade'),
    index('object_estimate_sections_estimate_idx').on(t.estimateId, t.sortOrder),
  ],
);

/** Позиция сметы: объём и единица, цена заказчику без НДС, плановая внутренняя стоимость и норма часов */
export const objectEstimateItems = pgTable(
  'object_estimate_items',
  {
    id: pk(),
    workspaceId: wsCol(),
    estimateId: uuid('estimate_id').notNull(),
    /** Раздел: пусто — позиция вне разделов */
    sectionId: uuid('section_id'),
    sortOrder: integer('sort_order').notNull().default(0),
    kind: text('kind', { enum: ['work', 'material', 'panel', 'subcontract', 'other'] }).notNull().default('work'),
    name: text('name').notNull(),
    /** Товар каталога (для материалов и субподряда): из него создаётся заказ поставщику */
    productId: uuid('product_id'),
    unitCode: text('unit_code').notNull().default('796'),
    qty: numeric('qty', { precision: 18, scale: 3 }).notNull().default('0'),
    /** Цена заказчику без НДС */
    price: money('price').notNull().default('0'),
    vatRate: text('vat_rate').notNull().default('20'),
    /** Плановая внутренняя стоимость единицы (видна owner/admin) */
    costPrice: money('cost_price').notNull().default('0'),
    /** Норма часов на единицу (для работ) */
    laborHours: numeric('labor_hours', { precision: 18, scale: 3 }).notNull().default('0'),
    /** Выполненный объём (задача 1272): факт выполнения, вводится вручную; позже обновляет сменный отчёт (1271) */
    doneQty: numeric('done_qty', { precision: 18, scale: 3 }).notNull().default('0'),
    /** Изделие производства (для щитов): из него создаётся заказ на производство */
    manufacturedItemId: uuid('manufactured_item_id'),
    note: text('note').notNull().default(''),
    createdAt: createdAt(),
  },
  t => [
    unique('object_estimate_items_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.estimateId], foreignColumns: [objectEstimates.workspaceId, objectEstimates.id], name: 'object_estimate_items_estimate_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.sectionId], foreignColumns: [objectEstimateSections.workspaceId, objectEstimateSections.id], name: 'object_estimate_items_section_fk' }).onDelete('set null'),
    foreignKey({ columns: [t.workspaceId, t.productId], foreignColumns: [products.workspaceId, products.id], name: 'object_estimate_items_product_fk' }).onDelete('set null'),
    foreignKey({ columns: [t.workspaceId, t.unitCode], foreignColumns: [units.workspaceId, units.code], name: 'object_estimate_items_unit_fk' }),
    foreignKey({ columns: [t.workspaceId, t.manufacturedItemId], foreignColumns: [manufacturedItems.workspaceId, manufacturedItems.id], name: 'object_estimate_items_manufactured_fk' }).onDelete('set null'),
    check('object_estimate_items_kind_chk', sql`${t.kind} in ('work','material','panel','subcontract','other')`),
    check('object_estimate_items_vat_chk', sql`${t.vatRate} in ('none','0','5','7','10','20')`),
    check('object_estimate_items_amounts_chk', sql`${t.qty} >= 0 and ${t.price} >= 0 and ${t.costPrice} >= 0 and ${t.laborHours} >= 0`),
    check('object_estimate_items_done_qty_chk', sql`${t.doneQty} >= 0 and ${t.doneQty} <= ${t.qty}`),
    index('object_estimate_items_estimate_idx').on(t.estimateId, t.sortOrder),
    index('object_estimate_items_section_idx').on(t.sectionId),
    index('object_estimate_items_product_idx').on(t.productId),
  ],
);

/** Вехи объекта (задача 1272): этап (выполнение) или аванс (деньги вперёд, не выполнение).
    Сумма вехи — фиксированная сумма или процент стоимости договора (согласованная смета и согласованные допработы).
    Выполнено и принято заказчиком — разные отметки: принято только после выполнено.
    «Выставлено» и «Оплачено» здесь не хранятся — их даст задача 1273 (акты и счета). */
export const objectMilestones = pgTable(
  'object_milestones',
  {
    id: pk(),
    workspaceId: wsCol(),
    objectId: uuid('object_id').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    name: text('name').notNull(),
    dueDate: date('due_date', { mode: 'string' }),
    /** stage — этап (выполнение), advance — аванс (деньги вперёд, не выполнение) */
    kind: text('kind', { enum: ['stage', 'advance'] }).notNull().default('stage'),
    /** Фиксированная сумма без НДС; ровно одно из amount/pct */
    amount: money('amount'),
    /** Процент стоимости договора; ровно одно из amount/pct */
    pct: numeric('pct', { precision: 5, scale: 2 }),
    /** Выполнено */
    doneAt: ts('done_at'),
    /** Принято заказчиком (только если выполнено) */
    acceptedAt: ts('accepted_at'),
    note: text('note').notNull().default(''),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    unique('object_milestones_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.objectId], foreignColumns: [objects.workspaceId, objects.id], name: 'object_milestones_object_fk' }).onDelete('cascade'),
    check('object_milestones_kind_chk', sql`${t.kind} in ('stage','advance')`),
    // сумма вехи: фиксированная сумма или процент стоимости договора, но не оба и не ничего
    check('object_milestones_amount_chk', sql`((${t.amount} is null) <> (${t.pct} is null)) and (${t.amount} is null or ${t.amount} >= 0) and (${t.pct} is null or (${t.pct} >= 0 and ${t.pct} <= 100))`),
    // принято заказчиком только после того, как выполнено
    check('object_milestones_accepted_chk', sql`${t.acceptedAt} is null or ${t.doneAt} is not null`),
    index('object_milestones_object_idx').on(t.workspaceId, t.objectId, t.sortOrder),
  ],
);

/** Смена прораба (задача 1271): итог часов бригады за дату на объекте. Черновик → подтверждена;
    правка подтверждённой — только admin/owner с причиной и записью в журнал. Уникальна (объект, дата, прораб). */
export const objectShifts = pgTable(
  'object_shifts',
  {
    id: pk(),
    workspaceId: wsCol(),
    objectId: uuid('object_id').notNull(),
    workDate: date('work_date', { mode: 'string' }).notNull(),
    /** Прораб, ведущий смену */
    foremanId: uuid('foreman_id').notNull(),
    /** draft — черновик, confirmed — подтверждена: часы и объёмы пошли в факт объекта */
    status: text('status', { enum: ['draft', 'confirmed'] }).notNull().default('draft'),
    confirmedBy: uuid('confirmed_by'),
    confirmedAt: ts('confirmed_at'),
    note: text('note').notNull().default(''),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    unique('object_shifts_ws_id_uq').on(t.workspaceId, t.id),
    unique('object_shifts_object_date_uq').on(t.objectId, t.workDate, t.foremanId),
    foreignKey({ columns: [t.workspaceId, t.objectId], foreignColumns: [objects.workspaceId, objects.id], name: 'object_shifts_object_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.foremanId], foreignColumns: [members.workspaceId, members.id], name: 'object_shifts_foreman_fk' }),
    foreignKey({ columns: [t.workspaceId, t.confirmedBy], foreignColumns: [members.workspaceId, members.id], name: 'object_shifts_confirmed_by_fk' }).onDelete('set null'),
    foreignKey({ columns: [t.workspaceId, t.createdBy], foreignColumns: [members.workspaceId, members.id], name: 'object_shifts_created_by_fk' }).onDelete('set null'),
    check('object_shifts_status_chk', sql`${t.status} in ('draft','confirmed')`),
    check('object_shifts_confirmed_chk', sql`(${t.status} = 'draft' and ${t.confirmedAt} is null and ${t.confirmedBy} is null) or (${t.status} = 'confirmed' and ${t.confirmedAt} is not null)`),
    index('object_shifts_object_idx').on(t.workspaceId, t.objectId, t.workDate),
    index('object_shifts_foreman_idx').on(t.workspaceId, t.foremanId, t.workDate),
  ],
);

/** Часы работника в смене с распределением по позиции сметы вида work (пусто — часы без позиции).
    Стоимость часа и сумма строки — снимок при подтверждении: новая ставка прошлые затраты не меняет.
    Нет ни почасовой ставки, ни оклада — cost_rate и cost_amount пустые (пробел, не ноль). */
export const objectShiftHours = pgTable(
  'object_shift_hours',
  {
    id: pk(),
    workspaceId: wsCol(),
    shiftId: uuid('shift_id').notNull(),
    memberId: uuid('member_id').notNull(),
    estimateItemId: uuid('estimate_item_id'),
    hours: numeric('hours', { precision: 6, scale: 2 }).notNull(),
    costRate: money('cost_rate'),
    costAmount: money('cost_amount'),
    note: text('note').notNull().default(''),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    unique('object_shift_hours_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.shiftId], foreignColumns: [objectShifts.workspaceId, objectShifts.id], name: 'object_shift_hours_shift_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.memberId], foreignColumns: [members.workspaceId, members.id], name: 'object_shift_hours_member_fk' }),
    foreignKey({ columns: [t.workspaceId, t.estimateItemId], foreignColumns: [objectEstimateItems.workspaceId, objectEstimateItems.id], name: 'object_shift_hours_item_fk' }).onDelete('set null'),
    check('object_shift_hours_hours_chk', sql`${t.hours} > 0 and ${t.hours} <= 24`),
    check('object_shift_hours_cost_chk', sql`(${t.costRate} is null or ${t.costRate} >= 0) and (${t.costAmount} is null or ${t.costAmount} >= 0)`),
    index('object_shift_hours_shift_idx').on(t.workspaceId, t.shiftId),
    index('object_shift_hours_member_idx').on(t.workspaceId, t.memberId),
  ],
);

/** Сменный отчёт объёмов: выполненный объём по позиции сметы, один раз на бригаду (не на работника).
    При подтверждении смены прибавляется к object_estimate_items.done_qty, при отмене — вычитается. */
export const objectShiftVolumes = pgTable(
  'object_shift_volumes',
  {
    id: pk(),
    workspaceId: wsCol(),
    shiftId: uuid('shift_id').notNull(),
    estimateItemId: uuid('estimate_item_id').notNull(),
    qty: numeric('qty', { precision: 18, scale: 3 }).notNull(),
    createdAt: createdAt(),
  },
  t => [
    unique('object_shift_volumes_ws_id_uq').on(t.workspaceId, t.id),
    unique('object_shift_volumes_shift_item_uq').on(t.shiftId, t.estimateItemId),
    foreignKey({ columns: [t.workspaceId, t.shiftId], foreignColumns: [objectShifts.workspaceId, objectShifts.id], name: 'object_shift_volumes_shift_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.estimateItemId], foreignColumns: [objectEstimateItems.workspaceId, objectEstimateItems.id], name: 'object_shift_volumes_item_fk' }).onDelete('cascade'),
    check('object_shift_volumes_qty_chk', sql`${t.qty} > 0`),
    index('object_shift_volumes_shift_idx').on(t.workspaceId, t.shiftId),
  ],
);

/** Журнал смены: кто, когда, что было → что стало и почему (правка подтверждённой — только admin/owner) */
export const objectShiftLog = pgTable(
  'object_shift_log',
  {
    id: pk(),
    workspaceId: wsCol(),
    shiftId: uuid('shift_id').notNull(),
    authorId: uuid('author_id'),
    at: ts('at').notNull().defaultNow(),
    action: text('action').notNull(),
    before: jsonb('before'),
    after: jsonb('after'),
    reason: text('reason').notNull().default(''),
  },
  t => [
    foreignKey({ columns: [t.workspaceId, t.shiftId], foreignColumns: [objectShifts.workspaceId, objectShifts.id], name: 'object_shift_log_shift_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.authorId], foreignColumns: [members.workspaceId, members.id], name: 'object_shift_log_author_fk' }).onDelete('set null'),
    index('object_shift_log_shift_idx').on(t.workspaceId, t.shiftId, t.at),
  ],
);
