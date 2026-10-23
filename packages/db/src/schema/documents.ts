/* Документы продаж и закупок, организации, склады, банковские счета, остатки и движения. Таблицы арендатора (workspace_id + RLS).
   Связи — составные внешние ключи (workspace_id, id): запись одного арендатора не сошлётся на запись другого. */
import { sql } from 'drizzle-orm';
import { bigint, boolean, check, customType, date, foreignKey, index, integer, jsonb, numeric, pgTable, primaryKey, text, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import type { FileRef } from '@gr8r/shared';
import { archivedAt, createdAt, money, pk, ts, updatedAt } from './columns';
import { products, units } from './catalog';
import { companies } from './crm';
import { members, wsCol } from './people';

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

export const organizations = pgTable(
  'organizations',
  {
    id: pk(),
    workspaceId: wsCol(),
    name: text('name').notNull(),
    fullName: text('full_name').notNull().default(''),
    kind: text('kind', { enum: ['legal', 'sole_proprietor', 'individual'] }).notNull().default('legal'),
    inn: text('inn').notNull().default(''),
    kpp: text('kpp').notNull().default(''),
    ogrn: text('ogrn').notNull().default(''),
    legalAddress: text('legal_address').notNull().default(''),
    actualAddress: text('actual_address').notNull().default(''),
    phone: text('phone').notNull().default(''),
    email: text('email').notNull().default(''),
    directorName: text('director_name').notNull().default(''),
    directorTitle: text('director_title').notNull().default('Генеральный директор'),
    accountantName: text('accountant_name').notNull().default(''),
    taxSystem: text('tax_system', { enum: ['osn', 'usn'] }).notNull().default('osn'),
    defaultVatRate: text('default_vat_rate').notNull().default('20'),
    /** Печать и подписи: пока ссылка и метаданные ({ name, url, size?, mimeType? }); загрузка файлов — с хранилищем S3 */
    stampFile: jsonb('stamp_file').$type<FileRef>(),
    directorSignatureFile: jsonb('director_signature_file').$type<FileRef>(),
    accountantSignatureFile: jsonb('accountant_signature_file').$type<FileRef>(),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  t => [
    unique('organizations_ws_id_uq').on(t.workspaceId, t.id),
    check('organizations_kind_chk', sql`${t.kind} in ('legal','sole_proprietor','individual')`),
    check('organizations_tax_chk', sql`${t.taxSystem} in ('osn','usn')`),
    check('organizations_vat_chk', sql`${t.defaultVatRate} in ('none','0','5','7','10','20')`),
    // одна организация по умолчанию на воркспейс
    uniqueIndex('organizations_default_uq').on(t.workspaceId).where(sql`${t.isDefault} and ${t.archivedAt} is null`),
  ],
);

/** Банковские счета компании CRM или собственной организации (ровно одно из двух) */
export const bankAccounts = pgTable(
  'bank_accounts',
  {
    id: pk(),
    workspaceId: wsCol(),
    companyId: uuid('company_id'),
    organizationId: uuid('organization_id'),
    bik: text('bik').notNull(),
    account: text('account').notNull(),
    corrAccount: text('corr_account').notNull().default(''),
    bankName: text('bank_name').notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    note: text('note').notNull().default(''),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    unique('bank_accounts_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.companyId], foreignColumns: [companies.workspaceId, companies.id], name: 'bank_accounts_company_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.organizationId], foreignColumns: [organizations.workspaceId, organizations.id], name: 'bank_accounts_org_fk' }).onDelete('cascade'),
    check('bank_accounts_owner_chk', sql`(${t.companyId} is null) <> (${t.organizationId} is null)`),
    index('bank_accounts_company_idx').on(t.companyId),
    index('bank_accounts_org_idx').on(t.organizationId),
  ],
);

export const warehouses = pgTable(
  'warehouses',
  {
    id: pk(),
    workspaceId: wsCol(),
    name: text('name').notNull(),
    code: text('code').notNull().default(''),
    address: text('address').notNull().default(''),
    /** Вид склада: обычный склад, склад-цех участка, служебный склад «в пути» */
    kind: text('kind', { enum: ['warehouse', 'workshop', 'transit'] }).notNull().default('warehouse'),
    /** Склад контрагента: место хранения на стороне контрагента (склад переработчика) */
    counterpartyId: uuid('counterparty_id'),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  t => [
    unique('warehouses_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.counterpartyId], foreignColumns: [companies.workspaceId, companies.id], name: 'warehouses_counterparty_fk' }),
    uniqueIndex('warehouses_default_uq').on(t.workspaceId).where(sql`${t.isDefault} and ${t.archivedAt} is null`),
    uniqueIndex('warehouses_ws_name_uq').on(t.workspaceId, sql`lower(${t.name})`).where(sql`${t.archivedAt} is null`),
  ],
);

/** Статьи затрат и доходов: корреспонденция списаний и оприходований */
export const costItems = pgTable(
  'cost_items',
  {
    id: pk(),
    workspaceId: wsCol(),
    name: text('name').notNull(),
    /** Статья затрат (expense) или доходов (income) */
    kind: text('kind', { enum: ['expense', 'income'] }).notNull().default('expense'),
    /** Ключ системной статьи (Брак, Недостача…): свои статьи имеют null */
    systemKey: text('system_key'),
    /** Способ распределения косвенной затраты при закрытии периода: не распределять, по объёму выпуска, по прямым затратам, по часам работ */
    distributionMethod: text('distribution_method', { enum: ['none', 'output_qty', 'direct_costs', 'work_hours'] }).notNull().default('none'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  t => [
    unique('cost_items_ws_id_uq').on(t.workspaceId, t.id),
    check('cost_items_kind_chk', sql`${t.kind} in ('expense','income')`),
    check('cost_items_distribution_chk', sql`${t.distributionMethod} in ('none','output_qty','direct_costs','work_hours')`),
    uniqueIndex('cost_items_ws_name_uq').on(t.workspaceId, sql`lower(${t.name})`).where(sql`${t.archivedAt} is null`),
    uniqueIndex('cost_items_system_uq').on(t.workspaceId, t.systemKey).where(sql`${t.systemKey} is not null`),
  ],
);

/** Виды заказ-нарядов: у каждого вида свой набор состояний (таблица document_states) */
export const workOrderKinds = pgTable(
  'work_order_kinds',
  {
    id: pk(),
    workspaceId: wsCol(),
    name: text('name').notNull(),
    /** Вид по умолчанию: его получают новые заказ-наряды */
    isDefault: boolean('is_default').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    unique('work_order_kinds_ws_id_uq').on(t.workspaceId, t.id),
    uniqueIndex('work_order_kinds_ws_name_uq').on(t.workspaceId, sql`lower(${t.name})`),
    // вид по умолчанию — один на воркспейс
    uniqueIndex('work_order_kinds_default_uq').on(t.workspaceId).where(sql`${t.isDefault}`),
  ],
);

export const documents = pgTable(
  'documents',
  {
    id: pk(),
    workspaceId: wsCol(),
    type: text('type').notNull(),
    /** «СЧ-2026-00042»; присваивается при первом проведении и больше не меняется (черновик, ни разу не проведённый, номера не имеет) */
    number: text('number'),
    numberYear: integer('number_year'),
    numberSeq: integer('number_seq'),
    date: date('date', { mode: 'string' }).notNull(),
    dueDate: date('due_date', { mode: 'string' }),
    status: text('status', { enum: ['draft', 'posted', 'cancelled'] }).notNull().default('draft'),
    /** Состояние документа отдельно от проведения (у типов без состояний — null) */
    state: text('state'),
    /** Вид операции внутреннего документа */
    operation: text('operation'),
    organizationId: uuid('organization_id').notNull(),
    counterpartyId: uuid('counterparty_id'),
    warehouseId: uuid('warehouse_id'),
    /** Склад-получатель (перемещение между складами) */
    targetWarehouseId: uuid('target_warehouse_id'),
    /** Статья затрат или доходов (списание, оприходование) */
    costItemId: uuid('cost_item_id'),
    /** Договор (составной внешний ключ (workspace_id, contract_id) → contracts добавляется миграцией) */
    contractId: uuid('contract_id'),
    /** Вид заказ-наряда (только у work_order): у каждого вида свои состояния */
    workOrderKindId: uuid('work_order_kind_id'),
    /** Причина отмены заказ-наряда (состояние категории «cancelled») */
    cancelReason: text('cancel_reason'),
    /** Получатель имущества в эксплуатацию: участник воркспейса */
    inUseMemberId: uuid('in_use_member_id'),
    /** Получатель имущества в эксплуатацию: участок (внешний ключ не ставим: схема участков ссылается на документы) */
    inUseWorkCenterId: uuid('in_use_work_center_id'),
    /** Участок-получатель списания (стоимость уходит в косвенные затраты участка): внешний ключ не ставим (см. inUseWorkCenterId) */
    workCenterId: uuid('work_center_id'),
    /** Заказ на переработку (заказ покупателя с видом операции «Переработка»): по нему берётся давалец */
    tollingOrderId: uuid('tolling_order_id'),
    currency: text('currency').notNull().default('RUB'),
    /** Цены «НДС в т.ч.» (true) или «НДС сверху» (false) */
    priceIncludesVat: boolean('price_includes_vat').notNull().default(true),
    amountNet: money('amount_net').notNull().default('0'),
    vatTotal: money('vat_total').notNull().default('0'),
    total: money('total').notNull().default('0'),
    basedOnId: uuid('based_on_id'),
    responsibleId: uuid('responsible_id'),
    comment: text('comment').notNull().default(''),
    custom: jsonb('custom').$type<Record<string, unknown>>().notNull().default({}),
    postedAt: ts('posted_at'),
    postedBy: uuid('posted_by'),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    unique('documents_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.organizationId], foreignColumns: [organizations.workspaceId, organizations.id], name: 'documents_org_fk' }),
    foreignKey({ columns: [t.workspaceId, t.counterpartyId], foreignColumns: [companies.workspaceId, companies.id], name: 'documents_counterparty_fk' }),
    foreignKey({ columns: [t.workspaceId, t.warehouseId], foreignColumns: [warehouses.workspaceId, warehouses.id], name: 'documents_warehouse_fk' }),
    foreignKey({ columns: [t.workspaceId, t.targetWarehouseId], foreignColumns: [warehouses.workspaceId, warehouses.id], name: 'documents_target_warehouse_fk' }),
    foreignKey({ columns: [t.workspaceId, t.costItemId], foreignColumns: [costItems.workspaceId, costItems.id], name: 'documents_cost_item_fk' }),
    foreignKey({ columns: [t.workspaceId, t.workOrderKindId], foreignColumns: [workOrderKinds.workspaceId, workOrderKinds.id], name: 'documents_work_order_kind_fk' }),
    foreignKey({ columns: [t.workspaceId, t.inUseMemberId], foreignColumns: [members.workspaceId, members.id], name: 'documents_in_use_member_fk' }),
    foreignKey({ columns: [t.workspaceId, t.basedOnId], foreignColumns: [t.workspaceId, t.id], name: 'documents_based_on_fk' }).onDelete('set null'),
    foreignKey({ columns: [t.workspaceId, t.responsibleId], foreignColumns: [members.workspaceId, members.id], name: 'documents_responsible_fk' }),
    foreignKey({ columns: [t.workspaceId, t.tollingOrderId], foreignColumns: [t.workspaceId, t.id], name: 'documents_tolling_order_fk' }).onDelete('set null'),
    check('documents_type_chk', sql`${t.type} in ('quote','customer_order','invoice','realization','act','customer_return','supplier_order','receipt','supplier_return','stock_transfer','write_off','stock_posting','inventory_count','production_order','production','work_order','piecework_order','other_costs')`),
    check('documents_status_chk', sql`${t.status} in ('draft','posted','cancelled')`),
    check('documents_state_chk', sql`${t.state} is null or ${t.state} ~ '^[a-z][a-z0-9_]*$'`),
    check('documents_operation_chk', sql`${t.operation} is null or ${t.operation} in ('transfer','in_transit','to_operation','from_operation','assembly')`),
    // перемещение с получателем: склад-получатель задан и отличается от склада-источника
    // (у передачи в эксплуатацию и возврата из неё склада-получателя нет)
    check('documents_transfer_chk', sql`${t.operation} not in ('transfer','in_transit') or (${t.targetWarehouseId} is not null and ${t.targetWarehouseId} <> ${t.warehouseId})`),
    // передача в эксплуатацию и возврат из неё: получатель ровно один — сотрудник или участок
    check('documents_in_use_chk', sql`${t.operation} not in ('to_operation','from_operation') or ((${t.inUseMemberId} is not null) <> (${t.inUseWorkCenterId} is not null))`),
    check('documents_number_chk', sql`(${t.number} is null) = (${t.numberSeq} is null) and (${t.numberSeq} is null) = (${t.numberYear} is null)`),
    // номер уникален в (организация, тип, год)
    uniqueIndex('documents_number_uq').on(t.workspaceId, t.organizationId, t.type, t.numberYear, t.numberSeq).where(sql`${t.numberSeq} is not null`),
    index('documents_ws_type_date_idx').on(t.workspaceId, t.type, t.date),
    index('documents_counterparty_idx').on(t.counterpartyId),
    index('documents_contract_idx').on(t.workspaceId, t.contractId),
    index('documents_based_on_idx').on(t.basedOnId),
  ],
);

export const documentLines = pgTable(
  'document_lines',
  {
    id: pk(),
    workspaceId: wsCol(),
    documentId: uuid('document_id').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    productId: uuid('product_id').notNull(),
    name: text('name').notNull(),
    unitCode: text('unit_code').notNull().default('796'),
    qty: numeric('qty', { precision: 18, scale: 3 }).notNull(),
    price: money('price').notNull().default('0'),
    discountPct: numeric('discount_pct', { precision: 7, scale: 2 }).notNull().default('0'),
    vatRate: text('vat_rate').notNull().default('20'),
    net: money('net').notNull().default('0'),
    vatAmount: money('vat_amount').notNull().default('0'),
    total: money('total').notNull().default('0'),
    /** Строка, с которой скопирована эта (документ «на основании») */
    sourceLineId: uuid('source_line_id'),
    /** Строка исходного заказа: по ней считается остаток к отгрузке / поступлению всей цепочки документов */
    originLineId: uuid('origin_line_id'),
    /** Роль строки внутреннего документа: приход или расход (у продаж и закупок — null) */
    stockRole: text('stock_role', { enum: ['in', 'out'] }),
    /** Значения параметров спецификации изделия (заказ покупателя): состав выпуска считается формулами строк */
    params: jsonb('params').$type<Record<string, unknown>>().notNull().default({}),
    /** Статья косвенных затрат строки-услуги (поступление): сумма строки уходит в косвенные затраты месяца */
    costItemId: uuid('cost_item_id'),
    /** Участок строки-услуги (поступление): внешний ключ не ставим (схема участков ссылается на документы) */
    workCenterId: uuid('work_center_id'),
    /** Учётное количество по остаткам (инвентаризация): разница с qty — недостача или излишек */
    bookQty: numeric('book_qty', { precision: 18, scale: 3 }).notNull().default('0'),
    /** Принятое количество (перемещение «в пути»): не больше отправленного */
    receivedQty: numeric('received_qty', { precision: 18, scale: 3 }).notNull().default('0'),
    /** Вкладка строки отчёта о переработке: продукция, использованное сырьё или отходы */
    tollingRole: text('tolling_role', { enum: ['product', 'material', 'waste'] }),
    createdAt: createdAt(),
  },
  t => [
    unique('document_lines_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.documentId], foreignColumns: [documents.workspaceId, documents.id], name: 'document_lines_document_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.productId], foreignColumns: [products.workspaceId, products.id], name: 'document_lines_product_fk' }),
    foreignKey({ columns: [t.workspaceId, t.unitCode], foreignColumns: [units.workspaceId, units.code], name: 'document_lines_unit_fk' }),
    foreignKey({ columns: [t.workspaceId, t.costItemId], foreignColumns: [costItems.workspaceId, costItems.id], name: 'document_lines_cost_item_fk' }),
    foreignKey({ columns: [t.workspaceId, t.sourceLineId], foreignColumns: [t.workspaceId, t.id], name: 'document_lines_source_fk' }).onDelete('set null'),
    foreignKey({ columns: [t.workspaceId, t.originLineId], foreignColumns: [t.workspaceId, t.id], name: 'document_lines_origin_fk' }).onDelete('set null'),
    check('document_lines_qty_chk', sql`${t.qty} >= 0 and ${t.price} >= 0 and ${t.discountPct} >= 0 and ${t.discountPct} <= 100`),
    check('document_lines_book_qty_chk', sql`${t.bookQty} >= 0 and ${t.receivedQty} >= 0`),
    check('document_lines_vat_chk', sql`${t.vatRate} in ('none','0','5','7','10','20')`),
    check('document_lines_stock_role_chk', sql`${t.stockRole} is null or ${t.stockRole} in ('in','out')`),
    check('document_lines_tolling_role_chk', sql`${t.tollingRole} is null or ${t.tollingRole} in ('product','material','waste')`),
    index('document_lines_doc_idx').on(t.documentId, t.sortOrder),
    index('document_lines_origin_idx').on(t.originLineId),
    index('document_lines_source_idx').on(t.sourceLineId),
    index('document_lines_product_idx').on(t.productId),
    index('document_lines_cost_item_idx').on(t.costItemId),
  ],
);

/** Счётчики нумерации по (организация, тип, год). Строка блокируется инкрементом в транзакции проведения:
    откат проведения откатывает и счётчик, поэтому номера идут подряд без дыр */
export const documentCounters = pgTable(
  'document_counters',
  {
    workspaceId: wsCol(),
    organizationId: uuid('organization_id').notNull(),
    type: text('type').notNull(),
    year: integer('year').notNull(),
    lastNumber: integer('last_number').notNull().default(0),
  },
  t => [
    primaryKey({ columns: [t.organizationId, t.type, t.year] }),
    foreignKey({ columns: [t.workspaceId, t.organizationId], foreignColumns: [organizations.workspaceId, organizations.id], name: 'document_counters_org_fk' }).onDelete('cascade'),
  ],
);

/** Движения склада, записываются при проведении (qty со знаком: приход +, расход −). seq задаёт порядок пересчёта средней */
export const stockMoves = pgTable(
  'stock_moves',
  {
    id: pk(),
    workspaceId: wsCol(),
    seq: bigint('seq', { mode: 'number' }).generatedAlwaysAsIdentity().notNull(),
    warehouseId: uuid('warehouse_id').notNull(),
    productId: uuid('product_id').notNull(),
    documentId: uuid('document_id').notNull(),
    documentLineId: uuid('document_line_id'),
    qty: numeric('qty', { precision: 18, scale: 3 }).notNull(),
    /** Приход: цена единицы без НДС (или с НДС при УСН); расход: себестоимость по средней на момент списания */
    cost: numeric('cost', { precision: 18, scale: 4 }).notNull().default('0'),
    /** Фаза движения: 1 — основная (отправка), 2 — приёмка (перемещение «в пути») */
    phase: integer('phase').notNull().default(1),
    movedAt: date('moved_at', { mode: 'string' }).notNull(),
    createdAt: createdAt(),
  },
  t => [
    // составной ключ нужен корректировкам себестоимости закрытия (stock_cost_adjustments ссылается на (workspace_id, id))
    unique('stock_moves_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.warehouseId], foreignColumns: [warehouses.workspaceId, warehouses.id], name: 'stock_moves_warehouse_fk' }),
    foreignKey({ columns: [t.workspaceId, t.productId], foreignColumns: [products.workspaceId, products.id], name: 'stock_moves_product_fk' }),
    foreignKey({ columns: [t.workspaceId, t.documentId], foreignColumns: [documents.workspaceId, documents.id], name: 'stock_moves_document_fk' }).onDelete('cascade'),
    check('stock_moves_qty_chk', sql`${t.qty} <> 0`),
    check('stock_moves_phase_chk', sql`${t.phase} in (1,2)`),
    index('stock_moves_card_idx').on(t.workspaceId, t.warehouseId, t.productId, t.seq),
    index('stock_moves_product_idx').on(t.workspaceId, t.productId, t.seq),
    index('stock_moves_document_idx').on(t.documentId),
  ],
);

/** Остатки и средняя себестоимость по (склад, товар): обновляются в той же транзакции, что и движения */
export const stockBalances = pgTable(
  'stock_balances',
  {
    workspaceId: wsCol(),
    warehouseId: uuid('warehouse_id').notNull(),
    productId: uuid('product_id').notNull(),
    qty: numeric('qty', { precision: 18, scale: 3 }).notNull().default('0'),
    avgCost: numeric('avg_cost', { precision: 18, scale: 4 }).notNull().default('0'),
    updatedAt: updatedAt(),
  },
  t => [
    primaryKey({ columns: [t.warehouseId, t.productId] }),
    foreignKey({ columns: [t.workspaceId, t.warehouseId], foreignColumns: [warehouses.workspaceId, warehouses.id], name: 'stock_balances_warehouse_fk' }),
    foreignKey({ columns: [t.workspaceId, t.productId], foreignColumns: [products.workspaceId, products.id], name: 'stock_balances_product_fk' }),
    index('stock_balances_product_idx').on(t.workspaceId, t.productId),
  ],
);

/** Резерв под проведённый заказ покупателя: по строке заказа, количество = заказано − отгружено.
    Резерв выпущенной продукции — по строке выпуска (production_line_id): продукция, выпущенная под заказ покупателя, закреплена за ним */
export const stockReservations = pgTable(
  'stock_reservations',
  {
    id: pk(),
    workspaceId: wsCol(),
    documentId: uuid('document_id').notNull(),
    documentLineId: uuid('document_line_id'),
    /** Строка выпуска (продукция под заказ покупателя) */
    productionLineId: uuid('production_line_id'),
    /** Строка состава заказа на производство (материал под заказ) */
    productionComponentId: uuid('production_component_id'),
    warehouseId: uuid('warehouse_id').notNull(),
    productId: uuid('product_id').notNull(),
    qty: numeric('qty', { precision: 18, scale: 3 }).notNull(),
    updatedAt: updatedAt(),
  },
  t => [
    foreignKey({ columns: [t.workspaceId, t.documentId], foreignColumns: [documents.workspaceId, documents.id], name: 'stock_reservations_document_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.documentLineId], foreignColumns: [documentLines.workspaceId, documentLines.id], name: 'stock_reservations_line_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.productionLineId], foreignColumns: [documentLines.workspaceId, documentLines.id], name: 'stock_reservations_production_line_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.warehouseId], foreignColumns: [warehouses.workspaceId, warehouses.id], name: 'stock_reservations_warehouse_fk' }),
    foreignKey({ columns: [t.workspaceId, t.productId], foreignColumns: [products.workspaceId, products.id], name: 'stock_reservations_product_fk' }),
    unique('stock_reservations_line_uq').on(t.documentLineId),
    unique('stock_reservations_production_line_uq').on(t.productionLineId),
    // владелец резерва ровно один: строка заказа покупателя, строка выпуска или строка состава заказа на производство
    check('stock_reservations_owner_chk', sql`num_nonnulls(${t.documentLineId}, ${t.productionLineId}, ${t.productionComponentId}) = 1`),
    check('stock_reservations_qty_chk', sql`${t.qty} > 0`),
    uniqueIndex('stock_reservations_component_uq').on(t.workspaceId, t.productionComponentId, t.warehouseId).where(sql`${t.productionComponentId} is not null`),
    index('stock_reservations_stock_idx').on(t.workspaceId, t.warehouseId, t.productId),
    index('stock_reservations_component_idx').on(t.workspaceId, t.productionComponentId),
  ],
);

/** Сформированные PDF печатных форм. Файл пока лежит в БД (data); storage_key — заготовка под S3 (см. apps/worker/src/pdf/storage.ts) */
export const documentFiles = pgTable(
  'document_files',
  {
    id: pk(),
    workspaceId: wsCol(),
    documentId: uuid('document_id').notNull(),
    form: text('form').notNull(),
    status: text('status', { enum: ['pending', 'ready', 'failed'] }).notNull().default('pending'),
    contentType: text('content_type').notNull().default('application/pdf'),
    size: integer('size').notNull().default(0),
    data: bytea('data'),
    storageKey: text('storage_key'),
    error: text('error'),
    requestedBy: uuid('requested_by'),
    createdAt: createdAt(),
    finishedAt: ts('finished_at'),
  },
  t => [
    foreignKey({ columns: [t.workspaceId, t.documentId], foreignColumns: [documents.workspaceId, documents.id], name: 'document_files_document_fk' }).onDelete('cascade'),
    check('document_files_status_chk', sql`${t.status} in ('pending','ready','failed')`),
    index('document_files_document_idx').on(t.documentId, t.createdAt),
  ],
);

/** Выгрузка документов одним архивом (ZIP со счетами периода). Файл лежит в БД (data), как и PDF печатных форм.
    Документы выгрузки перечислены в document_ids — по ним воркер собирает архив (задача billing.export_zip) */
export const documentExports = pgTable(
  'document_exports',
  {
    id: pk(),
    workspaceId: wsCol(),
    /** Имя файла архива (например invoices-2026-10.zip) */
    name: text('name').notNull(),
    contentType: text('content_type').notNull().default('application/zip'),
    status: text('status', { enum: ['pending', 'ready', 'failed'] }).notNull().default('pending'),
    size: integer('size').notNull().default(0),
    data: bytea('data'),
    storageKey: text('storage_key'),
    error: text('error'),
    /** Счета выгрузки (id документов) — из них воркер собирает архив */
    documentIds: jsonb('document_ids').$type<string[]>().notNull().default([]),
    requestedBy: uuid('requested_by'),
    createdAt: createdAt(),
    finishedAt: ts('finished_at'),
  },
  t => [
    check('document_exports_status_chk', sql`${t.status} in ('pending','ready','failed')`),
    index('document_exports_ws_idx').on(t.workspaceId, t.createdAt),
  ],
);
