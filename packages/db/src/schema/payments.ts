/* Деньги (задача 1174б): кассы, статьи ДДС, строки документов оплат, движения денег, взаиморасчёты и подотчёт.
   Документы оплат лежат в общей таблице documents (группа «cash»), здесь — их строки и регистры.
   Таблицы арендатора (workspace_id + RLS), связи — составные FK. Правила — docs/architecture/payments.md. */
import { sql } from 'drizzle-orm';
import { check, date, foreignKey, index, integer, pgTable, text, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { archivedAt, createdAt, money, pk, updatedAt } from './columns';
import { companies } from './crm';
import { bankAccounts, costItems, documents, organizations } from './documents';
import { investmentProjects } from './investments';
import { contracts } from './billing';
import { members, wsCol } from './people';

/** Кассы наличных */
export const cashRegisters = pgTable(
  'cash_registers',
  {
    id: pk(),
    workspaceId: wsCol(),
    name: text('name').notNull(),
    organizationId: uuid('organization_id').notNull(),
    currency: text('currency').notNull().default('RUB'),
    responsibleId: uuid('responsible_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  t => [
    unique('cash_registers_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.organizationId], foreignColumns: [organizations.workspaceId, organizations.id], name: 'cash_registers_org_fk' }),
    foreignKey({ columns: [t.workspaceId, t.responsibleId], foreignColumns: [members.workspaceId, members.id], name: 'cash_registers_responsible_fk' }),
    uniqueIndex('cash_registers_ws_name_uq').on(t.workspaceId, sql`lower(${t.name})`).where(sql`${t.archivedAt} is null`),
  ],
);

/** Статьи движения денег (ДДС). Системные (system_key) создаются сами и не удаляются */
export const cashFlowItems = pgTable(
  'cash_flow_items',
  {
    id: pk(),
    workspaceId: wsCol(),
    name: text('name').notNull(),
    kind: text('kind', { enum: ['income', 'expense'] }).notNull(),
    flowGroup: text('flow_group', { enum: ['operating', 'investing', 'financing'] }).notNull().default('operating'),
    systemKey: text('system_key'),
    /** Статья закреплена за инвестпроектом: оплаты по ней идут в кассовый факт проекта */
    investmentProjectId: uuid('investment_project_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  t => [
    unique('cash_flow_items_ws_id_uq').on(t.workspaceId, t.id),
    check('cash_flow_items_kind_chk', sql`${t.kind} in ('income','expense')`),
    check('cash_flow_items_group_chk', sql`${t.flowGroup} in ('operating','investing','financing')`),
    foreignKey({ columns: [t.workspaceId, t.investmentProjectId], foreignColumns: [investmentProjects.workspaceId, investmentProjects.id], name: 'cash_flow_items_investment_fk' }),
    uniqueIndex('cash_flow_items_system_uq').on(t.workspaceId, t.systemKey).where(sql`${t.systemKey} is not null`),
    uniqueIndex('cash_flow_items_ws_name_uq').on(t.workspaceId, t.kind, sql`lower(${t.name})`).where(sql`${t.archivedAt} is null`),
  ],
);

/** Строки документов оплат и авансового отчёта: расшифровка суммы.
    Оплата: документ расчётов (пусто — аванс), договор, статья ДДС. Авансовый отчёт: расход (статья затрат) или оплата поставщику */
export const paymentLines = pgTable(
  'payment_lines',
  {
    id: pk(),
    workspaceId: wsCol(),
    documentId: uuid('document_id').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    /** Сотрудник строки: выплата зарплаты по ведомости (операция salary_payment) */
    memberId: uuid('member_id'),
    /** Контрагент строки (авансовый отчёт — оплата поставщику); у оплат берётся из шапки */
    counterpartyId: uuid('counterparty_id'),
    /** Документ расчётов (счёт, заказ, реализация…): сервер приводит его к корню цепочки */
    settlementDocumentId: uuid('settlement_document_id'),
    contractId: uuid('contract_id'),
    amount: money('amount').notNull(),
    cashFlowItemId: uuid('cash_flow_item_id').notNull(),
    /** Прочий доход/расход и расход подотчётного: статья затрат */
    costItemId: uuid('cost_item_id'),
    investmentProjectId: uuid('investment_project_id'),
    comment: text('comment').notNull().default(''),
    createdAt: createdAt(),
  },
  t => [
    unique('payment_lines_ws_id_uq').on(t.workspaceId, t.id),
    check('payment_lines_amount_chk', sql`${t.amount} > 0`),
    foreignKey({ columns: [t.workspaceId, t.documentId], foreignColumns: [documents.workspaceId, documents.id], name: 'payment_lines_document_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.counterpartyId], foreignColumns: [companies.workspaceId, companies.id], name: 'payment_lines_counterparty_fk' }),
    foreignKey({ columns: [t.workspaceId, t.settlementDocumentId], foreignColumns: [documents.workspaceId, documents.id], name: 'payment_lines_settlement_fk' }),
    foreignKey({ columns: [t.workspaceId, t.memberId], foreignColumns: [members.workspaceId, members.id], name: 'payment_lines_member_fk' }),
    foreignKey({ columns: [t.workspaceId, t.contractId], foreignColumns: [contracts.workspaceId, contracts.id], name: 'payment_lines_contract_fk' }),
    foreignKey({ columns: [t.workspaceId, t.cashFlowItemId], foreignColumns: [cashFlowItems.workspaceId, cashFlowItems.id], name: 'payment_lines_cash_flow_item_fk' }),
    foreignKey({ columns: [t.workspaceId, t.costItemId], foreignColumns: [costItems.workspaceId, costItems.id], name: 'payment_lines_cost_item_fk' }),
    foreignKey({ columns: [t.workspaceId, t.investmentProjectId], foreignColumns: [investmentProjects.workspaceId, investmentProjects.id], name: 'payment_lines_investment_fk' }),
    index('payment_lines_doc_idx').on(t.documentId, t.sortOrder),
    index('payment_lines_settlement_idx').on(t.settlementDocumentId),
  ],
);

/** Строки «Ввода начальных остатков»: касса или счёт организации (kind cash|bank) либо долг/аванс контрагента */
export const openingBalanceLines = pgTable(
  'opening_balance_lines',
  {
    id: pk(),
    workspaceId: wsCol(),
    documentId: uuid('document_id').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    kind: text('kind', { enum: ['cash', 'bank', 'customer_debt', 'customer_advance', 'supplier_debt', 'supplier_advance'] }).notNull(),
    cashRegisterId: uuid('cash_register_id'),
    bankAccountId: uuid('bank_account_id'),
    counterpartyId: uuid('counterparty_id'),
    contractId: uuid('contract_id'),
    /** Документ расчётов, к которому привязан долг или аванс (необязательно; нужен в режиме «по документам») */
    settlementDocumentId: uuid('settlement_document_id'),
    amount: money('amount').notNull(),
    comment: text('comment').notNull().default(''),
    createdAt: createdAt(),
  },
  t => [
    unique('opening_balance_lines_ws_id_uq').on(t.workspaceId, t.id),
    check('opening_balance_lines_amount_chk', sql`${t.amount} > 0`),
    check('opening_balance_lines_kind_chk', sql`${t.kind} in ('cash','bank','customer_debt','customer_advance','supplier_debt','supplier_advance')`),
    foreignKey({ columns: [t.workspaceId, t.documentId], foreignColumns: [documents.workspaceId, documents.id], name: 'opening_balance_lines_document_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.cashRegisterId], foreignColumns: [cashRegisters.workspaceId, cashRegisters.id], name: 'opening_balance_lines_cash_register_fk' }),
    foreignKey({ columns: [t.workspaceId, t.bankAccountId], foreignColumns: [bankAccounts.workspaceId, bankAccounts.id], name: 'opening_balance_lines_bank_account_fk' }),
    foreignKey({ columns: [t.workspaceId, t.counterpartyId], foreignColumns: [companies.workspaceId, companies.id], name: 'opening_balance_lines_counterparty_fk' }),
    foreignKey({ columns: [t.workspaceId, t.contractId], foreignColumns: [contracts.workspaceId, contracts.id], name: 'opening_balance_lines_contract_fk' }),
    foreignKey({ columns: [t.workspaceId, t.settlementDocumentId], foreignColumns: [documents.workspaceId, documents.id], name: 'opening_balance_lines_settlement_document_fk' }),
    index('opening_balance_lines_doc_idx').on(t.documentId, t.sortOrder),
  ],
);

/** Движения денег по кассам, банковским счетам и подотчётным лицам (записываются при проведении) */
export const cashMoves = pgTable(
  'cash_moves',
  {
    id: pk(),
    workspaceId: wsCol(),
    documentId: uuid('document_id').notNull(),
    lineId: uuid('line_id'),
    date: date('date', { mode: 'string' }).notNull(),
    accountKind: text('account_kind', { enum: ['cash', 'bank', 'accountable'] }).notNull(),
    cashRegisterId: uuid('cash_register_id'),
    bankAccountId: uuid('bank_account_id'),
    /** Подотчётное лицо: расходы авансового отчёта (деньги уже выданы, в остатки касс не входят) */
    memberId: uuid('member_id'),
    cashFlowItemId: uuid('cash_flow_item_id').notNull(),
    direction: text('direction', { enum: ['in', 'out'] }).notNull(),
    amount: money('amount').notNull(),
    investmentProjectId: uuid('investment_project_id'),
    costItemId: uuid('cost_item_id'),
    createdAt: createdAt(),
  },
  t => [
    check('cash_moves_amount_chk', sql`${t.amount} > 0`),
    check('cash_moves_kind_chk', sql`${t.accountKind} in ('cash','bank','accountable')`),
    check('cash_moves_dir_chk', sql`${t.direction} in ('in','out')`),
    check(
      'cash_moves_account_chk',
      sql`(${t.accountKind} = 'cash' and ${t.cashRegisterId} is not null and ${t.bankAccountId} is null and ${t.memberId} is null)
      or (${t.accountKind} = 'bank' and ${t.bankAccountId} is not null and ${t.cashRegisterId} is null and ${t.memberId} is null)
      or (${t.accountKind} = 'accountable' and ${t.memberId} is not null and ${t.cashRegisterId} is null and ${t.bankAccountId} is null)`,
    ),
    foreignKey({ columns: [t.workspaceId, t.documentId], foreignColumns: [documents.workspaceId, documents.id], name: 'cash_moves_document_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.cashRegisterId], foreignColumns: [cashRegisters.workspaceId, cashRegisters.id], name: 'cash_moves_cash_register_fk' }),
    foreignKey({ columns: [t.workspaceId, t.bankAccountId], foreignColumns: [bankAccounts.workspaceId, bankAccounts.id], name: 'cash_moves_bank_account_fk' }),
    foreignKey({ columns: [t.workspaceId, t.memberId], foreignColumns: [members.workspaceId, members.id], name: 'cash_moves_member_fk' }),
    foreignKey({ columns: [t.workspaceId, t.cashFlowItemId], foreignColumns: [cashFlowItems.workspaceId, cashFlowItems.id], name: 'cash_moves_cash_flow_item_fk' }),
    foreignKey({ columns: [t.workspaceId, t.investmentProjectId], foreignColumns: [investmentProjects.workspaceId, investmentProjects.id], name: 'cash_moves_investment_fk' }),
    foreignKey({ columns: [t.workspaceId, t.costItemId], foreignColumns: [costItems.workspaceId, costItems.id], name: 'cash_moves_cost_item_fk' }),
    index('cash_moves_document_idx').on(t.documentId),
    index('cash_moves_cash_idx').on(t.workspaceId, t.cashRegisterId, t.date),
    index('cash_moves_bank_idx').on(t.workspaceId, t.bankAccountId, t.date),
    index('cash_moves_date_idx').on(t.workspaceId, t.date),
  ],
);

/** Взаиморасчёты с контрагентами. amount со знаком «долг растёт» (+): у покупателя — он должен нам, у поставщика — мы ему.
    Начисление (+), оплата и зачёт (−). Строки без документа расчётов (settlement_document_id is null) — «пул» авансов;
    зачёт аванса — пара строк: (документ, −сумма) и (пул, +сумма) со ссылкой на источник аванса */
export const settlementMoves = pgTable(
  'settlement_moves',
  {
    id: pk(),
    workspaceId: wsCol(),
    companyId: uuid('company_id').notNull(),
    side: text('side', { enum: ['customer', 'supplier'] }).notNull(),
    contractId: uuid('contract_id'),
    settlementDocumentId: uuid('settlement_document_id'),
    /** Документ, создавший строку (начисление, оплата или документ, в котором произошёл зачёт) */
    documentId: uuid('document_id').notNull(),
    lineId: uuid('line_id'),
    /** Источник аванса, к которому относится строка пула (оплата, давшая аванс) */
    advanceDocumentId: uuid('advance_document_id'),
    advanceLineId: uuid('advance_line_id'),
    date: date('date', { mode: 'string' }).notNull(),
    kind: text('kind', { enum: ['accrual', 'payment', 'offset'] }).notNull(),
    amount: money('amount').notNull(),
    createdAt: createdAt(),
  },
  t => [
    check('settlement_moves_side_chk', sql`${t.side} in ('customer','supplier')`),
    check('settlement_moves_kind_chk', sql`${t.kind} in ('accrual','payment','offset')`),
    check('settlement_moves_amount_chk', sql`${t.amount} <> 0`),
    foreignKey({ columns: [t.workspaceId, t.companyId], foreignColumns: [companies.workspaceId, companies.id], name: 'settlement_moves_company_fk' }),
    foreignKey({ columns: [t.workspaceId, t.contractId], foreignColumns: [contracts.workspaceId, contracts.id], name: 'settlement_moves_contract_fk' }),
    foreignKey({ columns: [t.workspaceId, t.settlementDocumentId], foreignColumns: [documents.workspaceId, documents.id], name: 'settlement_moves_settlement_fk' }),
    foreignKey({ columns: [t.workspaceId, t.documentId], foreignColumns: [documents.workspaceId, documents.id], name: 'settlement_moves_document_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.advanceDocumentId], foreignColumns: [documents.workspaceId, documents.id], name: 'settlement_moves_advance_fk' }).onDelete('cascade'),
    index('settlement_moves_company_idx').on(t.workspaceId, t.companyId, t.side),
    index('settlement_moves_settlement_idx').on(t.settlementDocumentId),
    index('settlement_moves_document_idx').on(t.documentId),
    index('settlement_moves_advance_idx').on(t.advanceDocumentId),
  ],
);

/** Расчёты с подотчётными лицами: выдача (+) увеличивает долг сотрудника, авансовый отчёт и возврат (−) уменьшают */
export const accountableMoves = pgTable(
  'accountable_moves',
  {
    id: pk(),
    workspaceId: wsCol(),
    memberId: uuid('member_id').notNull(),
    documentId: uuid('document_id').notNull(),
    date: date('date', { mode: 'string' }).notNull(),
    amount: money('amount').notNull(),
    createdAt: createdAt(),
  },
  t => [
    check('accountable_moves_amount_chk', sql`${t.amount} <> 0`),
    foreignKey({ columns: [t.workspaceId, t.memberId], foreignColumns: [members.workspaceId, members.id], name: 'accountable_moves_member_fk' }),
    foreignKey({ columns: [t.workspaceId, t.documentId], foreignColumns: [documents.workspaceId, documents.id], name: 'accountable_moves_document_fk' }).onDelete('cascade'),
    index('accountable_moves_member_idx').on(t.workspaceId, t.memberId),
    index('accountable_moves_document_idx').on(t.documentId),
  ],
);
