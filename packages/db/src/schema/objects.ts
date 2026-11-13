/* Объекты объектного учёта (задача 1268, docs/architecture/construction.md): справочник объектов, прорабы и договоры.
   Таблицы арендатора (workspace_id + RLS), связи — составные FK. Ссылки на проекты задач, склады и договоры
   добавляются в SQL-миграции, чтобы не замыкать круг импортов схем (objects ↔ work/documents/billing). */
import { sql } from 'drizzle-orm';
import { boolean, check, date, foreignKey, index, integer, jsonb, numeric, pgTable, text, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { archivedAt, createdAt, money, pk, ts, updatedAt } from './columns';
import { products, units } from './catalog';
import { companies } from './crm';
import { members, wsCol } from './people';
import { defectReasons, manufacturedItems } from './production';

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
    /** Ставка часа для заказчика (задача 1273): выручка «по часам» = подтверждённые часы смен × ставка; пусто — акт по часам не создать */
    customerHourRate: money('customer_hour_rate'),
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
    check('objects_customer_hour_rate_chk', sql`${t.customerHourRate} is null or ${t.customerHourRate} >= 0`),
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
    /** Единая наценка на себестоимость, %; null — не задана, цены строк не пересчитываются */
    markupPct: numeric('markup_pct', { precision: 7, scale: 2 }),
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
    /** Поставщик материала/субподряда: по его виду цен считается себестоимость (видят owner/admin) */
    supplierId: uuid('supplier_id'),
    /** Замок строки: заблокированная строка не пересчитывается автоматически (видят owner/admin) */
    locked: boolean('locked').notNull().default(false),
    createdAt: createdAt(),
  },
  t => [
    unique('object_estimate_items_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.estimateId], foreignColumns: [objectEstimates.workspaceId, objectEstimates.id], name: 'object_estimate_items_estimate_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.sectionId], foreignColumns: [objectEstimateSections.workspaceId, objectEstimateSections.id], name: 'object_estimate_items_section_fk' }).onDelete('set null'),
    foreignKey({ columns: [t.workspaceId, t.productId], foreignColumns: [products.workspaceId, products.id], name: 'object_estimate_items_product_fk' }).onDelete('set null'),
    foreignKey({ columns: [t.workspaceId, t.unitCode], foreignColumns: [units.workspaceId, units.code], name: 'object_estimate_items_unit_fk' }),
    foreignKey({ columns: [t.workspaceId, t.manufacturedItemId], foreignColumns: [manufacturedItems.workspaceId, manufacturedItems.id], name: 'object_estimate_items_manufactured_fk' }).onDelete('set null'),
    foreignKey({ columns: [t.workspaceId, t.supplierId], foreignColumns: [companies.workspaceId, companies.id], name: 'object_estimate_items_supplier_fk' }).onDelete('set null'),
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

/** Акт выполненных работ объекта (задача 1273, docs/architecture/construction.md): три вида — по объёмам (КС-2),
    по вехе этапа и по подтверждённым часам смен. Черновик → подписан заказчиком (принято); подписание фиксирует строки.
    «Выставлено» — счёт и документ «Акт оказания услуг», созданные из подписанного акта. */
export const objectActs = pgTable(
  'object_acts',
  {
    id: pk(),
    workspaceId: wsCol(),
    objectId: uuid('object_id').notNull(),
    /** Номер акта: КС-<код объекта>-<порядковый> */
    number: text('number').notNull().default(''),
    actDate: date('act_date', { mode: 'string' }).notNull(),
    /** Отчётный период акта */
    periodFrom: date('period_from', { mode: 'string' }).notNull(),
    periodTo: date('period_to', { mode: 'string' }).notNull(),
    /** volumes — по объёмам (КС-2), milestone — по вехе этапа, hours — по подтверждённым часам смен */
    kind: text('kind', { enum: ['volumes', 'milestone', 'hours'] }).notNull().default('volumes'),
    /** Веха, по которой выставлен акт (только kind = 'milestone') */
    milestoneId: uuid('milestone_id'),
    /** draft — черновик, signed — подписан заказчиком (принято) */
    status: text('status', { enum: ['draft', 'signed'] }).notNull().default('draft'),
    signedAt: ts('signed_at'),
    signedBy: uuid('signed_by'),
    /** Счёт, выставленный из акта: составной FK (workspace_id, invoice_document_id) → documents добавляет миграция 0100 */
    invoiceDocumentId: uuid('invoice_document_id'),
    /** Документ «Акт оказания услуг»: выручка и взаиморасчёты с заказчиком (составной FK — в миграции 0100) */
    actDocumentId: uuid('act_document_id'),
    note: text('note').notNull().default(''),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    unique('object_acts_ws_id_uq').on(t.workspaceId, t.id),
    uniqueIndex('object_acts_ws_number_uq').on(t.workspaceId, t.number),
    foreignKey({ columns: [t.workspaceId, t.objectId], foreignColumns: [objects.workspaceId, objects.id], name: 'object_acts_object_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.milestoneId], foreignColumns: [objectMilestones.workspaceId, objectMilestones.id], name: 'object_acts_milestone_fk' }).onDelete('set null'),
    foreignKey({ columns: [t.workspaceId, t.signedBy], foreignColumns: [members.workspaceId, members.id], name: 'object_acts_signed_by_fk' }).onDelete('set null'),
    check('object_acts_kind_chk', sql`${t.kind} in ('volumes','milestone','hours')`),
    check('object_acts_status_chk', sql`${t.status} in ('draft','signed')`),
    check('object_acts_period_chk', sql`${t.periodFrom} <= ${t.periodTo}`),
    // подпись и её автор ставятся вместе; у акта по вехе веха обязательна
    check('object_acts_signed_chk', sql`(${t.status} = 'draft' and ${t.signedAt} is null and ${t.signedBy} is null) or (${t.status} = 'signed' and ${t.signedAt} is not null)`),
    check('object_acts_milestone_kind_chk', sql`(${t.kind} = 'milestone') = (${t.milestoneId} is not null)`),
    index('object_acts_object_idx').on(t.workspaceId, t.objectId, t.actDate),
    index('object_acts_milestone_idx').on(t.workspaceId, t.milestoneId),
  ],
);

/** Строка акта: позиция сметы (по объёмам) или строка вехи / часов. Цена — цена согласованной сметы без НДС. */
export const objectActLines = pgTable(
  'object_act_lines',
  {
    id: pk(),
    workspaceId: wsCol(),
    actId: uuid('act_id').notNull(),
    /** Позиция сметы (по объёмам): из неё берутся цена, единица и ставка НДС */
    estimateItemId: uuid('estimate_item_id'),
    sortOrder: integer('sort_order').notNull().default(0),
    name: text('name').notNull(),
    unitCode: text('unit_code').notNull().default('796'),
    qty: numeric('qty', { precision: 18, scale: 3 }).notNull(),
    /** Цена заказчику без НДС */
    price: money('price').notNull().default('0'),
    vatRate: text('vat_rate').notNull().default('20'),
    /** Сумма без НДС: количество × цена до копейки */
    amount: money('amount').notNull().default('0'),
    createdAt: createdAt(),
  },
  t => [
    unique('object_act_lines_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.actId], foreignColumns: [objectActs.workspaceId, objectActs.id], name: 'object_act_lines_act_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.estimateItemId], foreignColumns: [objectEstimateItems.workspaceId, objectEstimateItems.id], name: 'object_act_lines_item_fk' }).onDelete('set null'),
    foreignKey({ columns: [t.workspaceId, t.unitCode], foreignColumns: [units.workspaceId, units.code], name: 'object_act_lines_unit_fk' }),
    check('object_act_lines_qty_chk', sql`${t.qty} > 0 and ${t.price} >= 0 and ${t.amount} >= 0`),
    check('object_act_lines_vat_chk', sql`${t.vatRate} in ('none','0','5','7','10','20')`),
    index('object_act_lines_act_idx').on(t.actId, t.sortOrder),
    index('object_act_lines_item_idx').on(t.workspaceId, t.estimateItemId),
  ],
);

/** Часы смен, вошедшие в акт «по часам»: один час смены — только в одном акте (уникальность пары воркспейс + строка часов) */
export const objectActShiftHours = pgTable(
  'object_act_shift_hours',
  {
    id: pk(),
    workspaceId: wsCol(),
    actId: uuid('act_id').notNull(),
    shiftHourId: uuid('shift_hour_id').notNull(),
    createdAt: createdAt(),
  },
  t => [
    unique('object_act_shift_hours_ws_id_uq').on(t.workspaceId, t.id),
    unique('object_act_shift_hours_hour_uq').on(t.workspaceId, t.shiftHourId),
    foreignKey({ columns: [t.workspaceId, t.actId], foreignColumns: [objectActs.workspaceId, objectActs.id], name: 'object_act_shift_hours_act_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.shiftHourId], foreignColumns: [objectShiftHours.workspaceId, objectShiftHours.id], name: 'object_act_shift_hours_hour_fk' }).onDelete('cascade'),
    index('object_act_shift_hours_act_idx').on(t.actId),
  ],
);

/* Субподряд (задача 1274, docs/architecture/construction.md). Заказ субподрядчику — существующий документ supplier_order
   с object_id, отдельной таблицы у заказа нет. Акт субподрядчика — документ подрядчика с приёмкой: черновик → принят | отклонён.
   Строки акта: позиция сметы (subcontract, необязательна), предъявлено qty и принято accepted_qty; причина отклонения —
   справочник причин брака (defect_reasons). Материалы акта списываются со склада объекта при приёмке.
   Ссылки на документы (заказ, поступление, списание) объявлены в SQL-миграции 0101: schema/documents.ts импортирует объекты,
   обратный импорт замкнул бы круг. */

/** Акт субподрядчика: документ подрядчика за период с приёмкой. draft → accepted | rejected */
export const objectSubActs = pgTable(
  'object_sub_acts',
  {
    id: pk(),
    workspaceId: wsCol(),
    objectId: uuid('object_id').notNull(),
    /** Субподрядчик (companies) */
    counterpartyId: uuid('counterparty_id').notNull(),
    /** Заказ субподрядчику (документ supplier_order), необязательное основание */
    orderId: uuid('order_id'),
    /** Номер нашего акта: СА-<код объекта>-<порядковый> */
    number: text('number').notNull().default(''),
    /** Номер документа субподрядчика */
    docNumber: text('doc_number').notNull().default(''),
    /** Дата документа субподрядчика */
    docDate: date('doc_date', { mode: 'string' }).notNull(),
    periodFrom: date('period_from', { mode: 'string' }).notNull(),
    periodTo: date('period_to', { mode: 'string' }).notNull(),
    /** draft — черновик, accepted — принят, rejected — отклонён целиком с причиной */
    status: text('status', { enum: ['draft', 'accepted', 'rejected'] }).notNull().default('draft'),
    acceptedAt: ts('accepted_at'),
    acceptedBy: uuid('accepted_by'),
    rejectedAt: ts('rejected_at'),
    rejectedBy: uuid('rejected_by'),
    /** Причина отклонения акта целиком */
    rejectReason: text('reject_reason').notNull().default(''),
    /** Поступление услуг, созданное при приёмке: составной FK — в миграции 0101 */
    receiptDocumentId: uuid('receipt_document_id'),
    /** Списание материалов субподрядчику со склада объекта (если материалы указаны) */
    writeOffDocumentId: uuid('write_off_document_id'),
    note: text('note').notNull().default(''),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    unique('object_sub_acts_ws_id_uq').on(t.workspaceId, t.id),
    uniqueIndex('object_sub_acts_ws_number_uq').on(t.workspaceId, t.number),
    foreignKey({ columns: [t.workspaceId, t.objectId], foreignColumns: [objects.workspaceId, objects.id], name: 'object_sub_acts_object_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.counterpartyId], foreignColumns: [companies.workspaceId, companies.id], name: 'object_sub_acts_counterparty_fk' }),
    foreignKey({ columns: [t.workspaceId, t.acceptedBy], foreignColumns: [members.workspaceId, members.id], name: 'object_sub_acts_accepted_by_fk' }).onDelete('set null'),
    foreignKey({ columns: [t.workspaceId, t.rejectedBy], foreignColumns: [members.workspaceId, members.id], name: 'object_sub_acts_rejected_by_fk' }).onDelete('set null'),
    foreignKey({ columns: [t.workspaceId, t.createdBy], foreignColumns: [members.workspaceId, members.id], name: 'object_sub_acts_created_by_fk' }).onDelete('set null'),
    check('object_sub_acts_status_chk', sql`${t.status} in ('draft','accepted','rejected')`),
    check('object_sub_acts_period_chk', sql`${t.periodFrom} <= ${t.periodTo}`),
    // отметки приёмки и отклонения ставятся вместе со статусом
    check(
      'object_sub_acts_state_chk',
      sql`(${t.status} = 'draft' and ${t.acceptedAt} is null and ${t.rejectedAt} is null) or (${t.status} = 'accepted' and ${t.acceptedAt} is not null) or (${t.status} = 'rejected' and ${t.rejectedAt} is not null)`,
    ),
    index('object_sub_acts_object_idx').on(t.workspaceId, t.objectId, t.docDate),
    index('object_sub_acts_order_idx').on(t.workspaceId, t.orderId),
    index('object_sub_acts_counterparty_idx').on(t.workspaceId, t.counterpartyId),
  ],
);

/** Строка акта субподрядчика: предъявлено qty и принято accepted_qty (≤ qty); отклонение — с причиной брака */
export const objectSubActLines = pgTable(
  'object_sub_act_lines',
  {
    id: pk(),
    workspaceId: wsCol(),
    actId: uuid('act_id').notNull(),
    /** Позиция сметы вида subcontract (необязательна: акт может быть без сметы) */
    estimateItemId: uuid('estimate_item_id'),
    sortOrder: integer('sort_order').notNull().default(0),
    name: text('name').notNull(),
    unitCode: text('unit_code').notNull().default('796'),
    /** Предъявлено субподрядчиком */
    qty: numeric('qty', { precision: 18, scale: 3 }).notNull(),
    /** Цена субподрядчика без НДС */
    price: money('price').notNull().default('0'),
    /** Принято: только принятое идёт в поступление услуг; меньше qty — нужна причина отклонения */
    acceptedQty: numeric('accepted_qty', { precision: 18, scale: 3 }).notNull().default('0'),
    defectReasonId: uuid('defect_reason_id'),
    note: text('note').notNull().default(''),
    createdAt: createdAt(),
  },
  t => [
    unique('object_sub_act_lines_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.actId], foreignColumns: [objectSubActs.workspaceId, objectSubActs.id], name: 'object_sub_act_lines_act_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.estimateItemId], foreignColumns: [objectEstimateItems.workspaceId, objectEstimateItems.id], name: 'object_sub_act_lines_item_fk' }).onDelete('set null'),
    foreignKey({ columns: [t.workspaceId, t.defectReasonId], foreignColumns: [defectReasons.workspaceId, defectReasons.id], name: 'object_sub_act_lines_reason_fk' }).onDelete('set null'),
    foreignKey({ columns: [t.workspaceId, t.unitCode], foreignColumns: [units.workspaceId, units.code], name: 'object_sub_act_lines_unit_fk' }),
    check('object_sub_act_lines_qty_chk', sql`${t.qty} > 0 and ${t.price} >= 0 and ${t.acceptedQty} >= 0 and ${t.acceptedQty} <= ${t.qty}`),
    index('object_sub_act_lines_act_idx').on(t.actId, t.sortOrder),
    index('object_sub_act_lines_item_idx').on(t.workspaceId, t.estimateItemId),
  ],
);

/** Материалы, израсходованные субподрядчиком: при приёмке списываются со склада объекта (факт material) */
export const objectSubActMaterials = pgTable(
  'object_sub_act_materials',
  {
    id: pk(),
    workspaceId: wsCol(),
    actId: uuid('act_id').notNull(),
    productId: uuid('product_id').notNull(),
    qty: numeric('qty', { precision: 18, scale: 3 }).notNull(),
    note: text('note').notNull().default(''),
    createdAt: createdAt(),
  },
  t => [
    unique('object_sub_act_materials_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.actId], foreignColumns: [objectSubActs.workspaceId, objectSubActs.id], name: 'object_sub_act_materials_act_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.productId], foreignColumns: [products.workspaceId, products.id], name: 'object_sub_act_materials_product_fk' }),
    check('object_sub_act_materials_qty_chk', sql`${t.qty} > 0`),
    index('object_sub_act_materials_act_idx').on(t.actId),
    index('object_sub_act_materials_product_idx').on(t.workspaceId, t.productId),
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

/* Прогноз прибыли объекта (задача 1275, docs/architecture/construction.md). Ответственный (owner/admin) может заменить
   остаток прогноза — ожидаемые оставшиеся затраты — по позиции сметы или по категории затрат целиком. Правка всегда
   с причиной и автором; ровно одна цель. Уникальность по объекту и цели — частичные уникальные индексы в миграции 0102. */
export const objectForecastOverrides = pgTable(
  'object_forecast_overrides',
  {
    id: pk(),
    workspaceId: wsCol(),
    objectId: uuid('object_id').notNull(),
    /** Позиция сметы: удаление позиции удаляет и правку */
    estimateItemId: uuid('estimate_item_id'),
    /** Категория затрат, если правка на категорию целиком */
    category: text('category', { enum: ['material', 'labor', 'subcontract', 'other'] }),
    /** Новое значение остатка (ожидаемых затрат) без НДС */
    remaining: money('remaining').notNull(),
    /** Причина правки — обязательна */
    reason: text('reason').notNull(),
    /** Кто заменил оценку */
    authorId: uuid('author_id'),
    createdAt: createdAt(),
  },
  t => [
    unique('object_forecast_overrides_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.objectId], foreignColumns: [objects.workspaceId, objects.id], name: 'object_forecast_overrides_object_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.estimateItemId], foreignColumns: [objectEstimateItems.workspaceId, objectEstimateItems.id], name: 'object_forecast_overrides_item_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.authorId], foreignColumns: [members.workspaceId, members.id], name: 'object_forecast_overrides_author_fk' }).onDelete('set null'),
    // ровно одна цель: позиция сметы или категория
    check('object_forecast_overrides_target_chk', sql`((${t.estimateItemId} is null) <> (${t.category} is null))`),
    check('object_forecast_overrides_category_chk', sql`${t.category} is null or ${t.category} in ('material','labor','subcontract','other')`),
    check('object_forecast_overrides_remaining_chk', sql`${t.remaining} >= 0`),
    check('object_forecast_overrides_reason_chk', sql`btrim(${t.reason}) <> ''`),
    uniqueIndex('object_forecast_overrides_item_uq').on(t.objectId, t.estimateItemId).where(sql`${t.estimateItemId} is not null`),
    uniqueIndex('object_forecast_overrides_category_uq').on(t.objectId, t.category).where(sql`${t.category} is not null`),
    index('object_forecast_overrides_object_idx').on(t.workspaceId, t.objectId),
  ],
);

/* Сводка о ходе работ по расписанию (задача 1277, docs/architecture/construction.md).
   У объекта одна настройка: включена ли сводка, день недели и время в часовом поясе воркспейса, получатели —
   участники воркспейса (пусто — ответственный и прорабы объекта). Задача воркера object.progress_report раз в минуту
   отправляет внутренние уведомления со сводкой; last_sent_at делает повторный проход в том же окне безопасным. */
export const objectReportSchedules = pgTable(
  'object_report_schedules',
  {
    id: pk(),
    workspaceId: wsCol(),
    objectId: uuid('object_id').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    /** День недели: 1 — понедельник … 7 — воскресенье */
    weekday: integer('weekday').notNull().default(1),
    /** Время отправки «HH:MM» в часовом поясе воркспейса */
    time: text('time').notNull().default('09:00'),
    /** Получатели — участники воркспейса; пусто — ответственный и прорабы объекта (проверяет сервис) */
    recipientIds: uuid('recipient_ids')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    /** Последняя отправка: повторный проход в том же окне ничего не отправляет */
    lastSentAt: ts('last_sent_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    unique('object_report_schedules_ws_id_uq').on(t.workspaceId, t.id),
    // у объекта ровно одна настройка сводки
    unique('object_report_schedules_object_uq').on(t.workspaceId, t.objectId),
    foreignKey({ columns: [t.workspaceId, t.objectId], foreignColumns: [objects.workspaceId, objects.id], name: 'object_report_schedules_object_fk' }).onDelete('cascade'),
    check('object_report_schedules_weekday_chk', sql`${t.weekday} between 1 and 7`),
    check('object_report_schedules_time_chk', sql`${t.time} ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'`),
    index('object_report_schedules_ws_idx').on(t.workspaceId, t.enabled),
  ],
);

/* Импорт сметы из документа (docx): извлечённая из файла таблица и ИИ-разметка строк. Строку создаёт
   маршрут /estimates/import/document, разметку делает задача воркера estimate.ai_extract (без ключа ИИ —
   сразу done с ai_result = null, фронт показывает сопоставление колонок по table). estimate_id без FK:
   строка импорта — журнал, переживает удаление сметы. */
export const estimateImports = pgTable(
  'estimate_imports',
  {
    id: pk(),
    workspaceId: wsCol(),
    /** Смета, в которую импортируют */
    estimateId: uuid('estimate_id'),
    fileName: text('file_name').notNull(),
    status: text('status', { enum: ['ready', 'pending', 'done', 'failed'] }).notNull().default('pending'),
    /** Извлечённая из документа таблица: {header, rows} */
    table: jsonb('table').notNull(),
    /** Разметка ИИ (packages/shared, estimateAiResult): mapping + строки сметы; null — ИИ не настроен или не справился */
    aiResult: jsonb('ai_result'),
    /** Почему ИИ не дал результат (фронт показывает fallback и предупреждение) */
    aiError: text('ai_error'),
    /** Подсказка пользователя для ИИ («возьми только раздел ЭМ») — уходит в промпт разметки */
    hint: text('hint'),
    /** Метаданные документа: pageCount/pdfType (pdf), selectedPages */
    meta: jsonb('meta'),
    /** Исходный markdown постранично (pdf-inspector) для просмотра «документ как его видит разбор» */
    source: jsonb('source'),
    error: text('error'),
    createdAt: createdAt(),
    finishedAt: ts('finished_at'),
  },
  t => [
    unique('estimate_imports_ws_id_uq').on(t.workspaceId, t.id),
    index('estimate_imports_ws_created_idx').on(t.workspaceId, t.createdAt),
  ],
);
