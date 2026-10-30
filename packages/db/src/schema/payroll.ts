/* Зарплата (задача 1184, миграция 0050_payroll): кадровые данные сотрудников, виды начислений, способы отражения,
   строки документов «Начисление зарплаты» и «Ведомость на выплату», регистр расчётов с персоналом.
   Документы лежат в общей documents (группа «payroll»). Таблицы арендатора, связи — составные FK. Правила — docs/architecture/payroll.md. */
import { sql } from 'drizzle-orm';
import { boolean, check, date, foreignKey, index, integer, numeric, pgTable, primaryKey, text, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { archivedAt, createdAt, money, pk, updatedAt } from './columns';
import { costItems, documents, organizations } from './documents';
import { members, wsCol } from './people';
import { workCenters } from './production';
import { fleetTrips } from './trips';

/** Способ отражения: статья затрат + участок, куда идёт начисление */
export const payrollReflections = pgTable(
  'payroll_reflections',
  {
    id: pk(),
    workspaceId: wsCol(),
    name: text('name').notNull(),
    costItemId: uuid('cost_item_id').notNull(),
    workCenterId: uuid('work_center_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  t => [
    unique('payroll_reflections_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.costItemId], foreignColumns: [costItems.workspaceId, costItems.id], name: 'payroll_reflections_cost_item_fk' }),
    foreignKey({ columns: [t.workspaceId, t.workCenterId], foreignColumns: [workCenters.workspaceId, workCenters.id], name: 'payroll_reflections_work_center_fk' }),
    uniqueIndex('payroll_reflections_ws_name_uq').on(t.workspaceId, sql`lower(${t.name})`).where(sql`${t.archivedAt} is null`),
  ],
);

/** Вид начисления или удержания. Системные (system_key) создаются при первом обращении */
export const payrollKinds = pgTable(
  'payroll_kinds',
  {
    id: pk(),
    workspaceId: wsCol(),
    name: text('name').notNull(),
    baseType: text('base_type').notNull(),
    systemKey: text('system_key'),
    /** Облагается страховыми взносами */
    insurable: boolean('insurable').notNull().default(true),
    createdAt: createdAt(),
    archivedAt: archivedAt(),
  },
  t => [
    unique('payroll_kinds_ws_id_uq').on(t.workspaceId, t.id),
    check('payroll_kinds_base_chk', sql`${t.baseType} in ('salary','piecework','sales_percent','bonus','one_time','deduction','trip_piecework','trip_km','trip_stop','trip_perdiem')`),
    uniqueIndex('payroll_kinds_system_uq').on(t.workspaceId, t.systemKey).where(sql`${t.systemKey} is not null`),
  ],
);

/** Кадровые данные сотрудника (участник воркспейса) */
export const employeePayroll = pgTable(
  'employee_payroll',
  {
    workspaceId: wsCol(),
    memberId: uuid('member_id').notNull(),
    hiredAt: date('hired_at', { mode: 'string' }),
    firedAt: date('fired_at', { mode: 'string' }),
    organizationId: uuid('organization_id'),
    workCenterId: uuid('work_center_id'),
    /** Способ отражения по умолчанию */
    reflectionId: uuid('reflection_id'),
    ndflRate: numeric('ndfl_rate', { precision: 5, scale: 2 }).notNull().default('13'),
    /** Счёт или карта для зарплатного реестра (не секрет) */
    cardAccount: text('card_account').notNull().default(''),
    advanceAmount: money('advance_amount'),
    advancePercent: numeric('advance_percent', { precision: 5, scale: 2 }),
    updatedAt: updatedAt(),
  },
  t => [
    primaryKey({ columns: [t.workspaceId, t.memberId] }),
    foreignKey({ columns: [t.workspaceId, t.memberId], foreignColumns: [members.workspaceId, members.id], name: 'employee_payroll_member_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.organizationId], foreignColumns: [organizations.workspaceId, organizations.id], name: 'employee_payroll_org_fk' }),
    foreignKey({ columns: [t.workspaceId, t.workCenterId], foreignColumns: [workCenters.workspaceId, workCenters.id], name: 'employee_payroll_work_center_fk' }),
    foreignKey({ columns: [t.workspaceId, t.reflectionId], foreignColumns: [payrollReflections.workspaceId, payrollReflections.id], name: 'employee_payroll_reflection_fk' }),
    check('employee_payroll_ndfl_chk', sql`${t.ndflRate} >= 0 and ${t.ndflRate} <= 100`),
  ],
);

/** Плановые начисления сотрудника с историей: значение действует с valid_from */
export const employeeAccruals = pgTable(
  'employee_accruals',
  {
    id: pk(),
    workspaceId: wsCol(),
    memberId: uuid('member_id').notNull(),
    kindId: uuid('kind_id').notNull(),
    validFrom: date('valid_from', { mode: 'string' }).notNull(),
    amount: money('amount'),
    percent: numeric('percent', { precision: 5, scale: 2 }),
    percentBasis: text('percent_basis').notNull().default('revenue'),
    createdAt: createdAt(),
  },
  t => [
    unique('employee_accruals_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.memberId], foreignColumns: [members.workspaceId, members.id], name: 'employee_accruals_member_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.kindId], foreignColumns: [payrollKinds.workspaceId, payrollKinds.id], name: 'employee_accruals_kind_fk' }),
    check('employee_accruals_basis_chk', sql`${t.percentBasis} in ('revenue','margin')`),
    uniqueIndex('employee_accruals_uq').on(t.workspaceId, t.memberId, t.kindId, t.validFrom),
    index('employee_accruals_member_idx').on(t.memberId, t.validFrom),
  ],
);

/** Шапка документа «Начисление зарплаты» */
export const payrollHeaders = pgTable(
  'payroll_headers',
  {
    workspaceId: wsCol(),
    documentId: uuid('document_id').notNull(),
    /** Первый день месяца начисления */
    period: date('period', { mode: 'string' }).notNull(),
    workCenterId: uuid('work_center_id'),
  },
  t => [
    primaryKey({ columns: [t.workspaceId, t.documentId] }),
    foreignKey({ columns: [t.workspaceId, t.documentId], foreignColumns: [documents.workspaceId, documents.id], name: 'payroll_headers_document_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.workCenterId], foreignColumns: [workCenters.workspaceId, workCenters.id], name: 'payroll_headers_work_center_fk' }),
  ],
);

/** Строки начисления: сотрудник × вид; удержание — вид с базой deduction.
    trip_id (задача 1224) — рейс, за который начислена оплата водителю (trip_* базы); пусто для прочих видов.
    Используется для прослеживания начисления к рейсу (например, для маржи рейса — задача 1223), значение не влияет на расчёт зарплаты */
export const payrollLines = pgTable(
  'payroll_lines',
  {
    id: pk(),
    workspaceId: wsCol(),
    documentId: uuid('document_id').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    memberId: uuid('member_id').notNull(),
    kindId: uuid('kind_id').notNull(),
    base: money('base').notNull().default('0'),
    rate: numeric('rate', { precision: 7, scale: 4 }).notNull().default('0'),
    workedDays: integer('worked_days').notNull().default(0),
    normDays: integer('norm_days').notNull().default(0),
    amount: money('amount').notNull(),
    ndfl: money('ndfl').notNull().default('0'),
    insurance: money('insurance').notNull().default('0'),
    reflectionId: uuid('reflection_id'),
    tripId: uuid('trip_id'),
    comment: text('comment').notNull().default(''),
    createdAt: createdAt(),
  },
  t => [
    unique('payroll_lines_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.documentId], foreignColumns: [documents.workspaceId, documents.id], name: 'payroll_lines_document_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.memberId], foreignColumns: [members.workspaceId, members.id], name: 'payroll_lines_member_fk' }),
    foreignKey({ columns: [t.workspaceId, t.kindId], foreignColumns: [payrollKinds.workspaceId, payrollKinds.id], name: 'payroll_lines_kind_fk' }),
    foreignKey({ columns: [t.workspaceId, t.reflectionId], foreignColumns: [payrollReflections.workspaceId, payrollReflections.id], name: 'payroll_lines_reflection_fk' }),
    foreignKey({ columns: [t.workspaceId, t.tripId], foreignColumns: [fleetTrips.workspaceId, fleetTrips.id], name: 'payroll_lines_trip_fk' }),
    check('payroll_lines_amount_chk', sql`${t.amount} >= 0 and ${t.ndfl} >= 0 and ${t.insurance} >= 0`),
    index('payroll_lines_doc_idx').on(t.documentId, t.sortOrder),
    index('payroll_lines_member_idx').on(t.memberId),
    index('payroll_lines_trip_idx').on(t.tripId),
  ],
);

/** Шапка ведомости на выплату */
export const payrollStatementHeaders = pgTable(
  'payroll_statement_headers',
  {
    workspaceId: wsCol(),
    documentId: uuid('document_id').notNull(),
    period: date('period', { mode: 'string' }).notNull(),
    kind: text('kind').notNull(),
    method: text('method').notNull(),
  },
  t => [
    primaryKey({ columns: [t.workspaceId, t.documentId] }),
    foreignKey({ columns: [t.workspaceId, t.documentId], foreignColumns: [documents.workspaceId, documents.id], name: 'payroll_statement_headers_document_fk' }).onDelete('cascade'),
    check('payroll_statement_headers_kind_chk', sql`${t.kind} in ('advance','settlement') and ${t.method} in ('cash','bank')`),
  ],
);

export const payrollStatementLines = pgTable(
  'payroll_statement_lines',
  {
    id: pk(),
    workspaceId: wsCol(),
    documentId: uuid('document_id').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    memberId: uuid('member_id').notNull(),
    amount: money('amount').notNull(),
    comment: text('comment').notNull().default(''),
    createdAt: createdAt(),
  },
  t => [
    unique('payroll_statement_lines_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.documentId], foreignColumns: [documents.workspaceId, documents.id], name: 'payroll_statement_lines_document_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.memberId], foreignColumns: [members.workspaceId, members.id], name: 'payroll_statement_lines_member_fk' }),
    check('payroll_statement_lines_amount_chk', sql`${t.amount} > 0`),
    index('payroll_statement_lines_doc_idx').on(t.documentId, t.sortOrder),
  ],
);

/** Расчёты с персоналом: знак «долг перед сотрудником растёт» (+). accrual +, ndfl/deduction/payment − */
export const payrollMoves = pgTable(
  'payroll_moves',
  {
    id: pk(),
    workspaceId: wsCol(),
    memberId: uuid('member_id').notNull(),
    documentId: uuid('document_id').notNull(),
    lineId: uuid('line_id'),
    date: date('date', { mode: 'string' }).notNull(),
    kind: text('kind').notNull(),
    amount: money('amount').notNull(),
    createdAt: createdAt(),
  },
  t => [
    foreignKey({ columns: [t.workspaceId, t.memberId], foreignColumns: [members.workspaceId, members.id], name: 'payroll_moves_member_fk' }),
    foreignKey({ columns: [t.workspaceId, t.documentId], foreignColumns: [documents.workspaceId, documents.id], name: 'payroll_moves_document_fk' }).onDelete('cascade'),
    check('payroll_moves_kind_chk', sql`${t.kind} in ('accrual','ndfl','deduction','payment')`),
    index('payroll_moves_member_idx').on(t.workspaceId, t.memberId, t.date),
    index('payroll_moves_document_idx').on(t.documentId),
  ],
);
