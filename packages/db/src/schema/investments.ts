/* Инвестпроекты и окупаемость: проект, план денежного потока (период × статья) и статьи, закреплённые за проектом.
   Таблицы арендатора (workspace_id + RLS), связи — составные FK. Факт берётся из проведённых документов
   (`documents.investment_project_id` или статья проекта) — правила в packages/db/src/investments.ts. */
import { sql } from 'drizzle-orm';
import { check, date, foreignKey, index, integer, numeric, pgTable, text, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { archivedAt, createdAt, money, pk, ts, updatedAt } from './columns';
import { costItems, organizations } from './documents';
import { members, wsCol } from './people';
import { projects } from './work';

export const investmentProjects = pgTable(
  'investment_projects',
  {
    id: pk(),
    workspaceId: wsCol(),
    name: text('name').notNull(),
    /** Черновик → утверждён (план заморожен) → закрыт (документы не принимаются) */
    status: text('status', { enum: ['draft', 'approved', 'closed'] }).notNull().default('draft'),
    /** База факта: начисление (проведённые документы) или оплаты (движения денег, задача 1174б) */
    factBasis: text('fact_basis', { enum: ['accrual', 'payments'] }).notNull().default('accrual'),
    /** Шаг планирования: месяц, квартал, год */
    periodKind: text('period_kind', { enum: ['month', 'quarter', 'year'] }).notNull().default('month'),
    /** Начало первого периода (всегда начало месяца, квартала или года) */
    startDate: date('start_date', { mode: 'string' }).notNull(),
    /** Горизонт — число периодов */
    periods: integer('periods').notNull(),
    /** Годовая ставка дисконтирования, % */
    discountRate: numeric('discount_rate', { precision: 9, scale: 4 }).notNull().default('0'),
    /** Проект задач (необязательно): деньги через эту связь не считаются */
    projectId: uuid('project_id'),
    organizationId: uuid('organization_id'),
    responsibleId: uuid('responsible_id'),
    comment: text('comment').notNull().default(''),
    approvedAt: ts('approved_at'),
    approvedBy: uuid('approved_by'),
    /** Когда проект закрыт: документы, проведённые позже, в факт по статьям проекта не идут */
    closedAt: ts('closed_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  t => [
    unique('investment_projects_ws_id_uq').on(t.workspaceId, t.id),
    check('investment_projects_status_chk', sql`${t.status} in ('draft','approved','closed')`),
    check('investment_projects_fact_basis_chk', sql`${t.factBasis} in ('accrual','payments')`),
    check('investment_projects_period_chk', sql`${t.periodKind} in ('month','quarter','year')`),
    check('investment_projects_periods_chk', sql`${t.periods} between 1 and 240`),
    check('investment_projects_rate_chk', sql`${t.discountRate} >= 0`),
    // проект задач можно удалить из Archive — связь обнуляется (список колонок дописан в SQL миграции)
    foreignKey({ columns: [t.workspaceId, t.projectId], foreignColumns: [projects.workspaceId, projects.id], name: 'investment_projects_project_fk' }).onDelete('set null'),
    foreignKey({ columns: [t.workspaceId, t.organizationId], foreignColumns: [organizations.workspaceId, organizations.id], name: 'investment_projects_org_fk' }),
    foreignKey({ columns: [t.workspaceId, t.responsibleId], foreignColumns: [members.workspaceId, members.id], name: 'investment_projects_responsible_fk' }),
    foreignKey({ columns: [t.workspaceId, t.approvedBy], foreignColumns: [members.workspaceId, members.id], name: 'investment_projects_approved_by_fk' }),
    index('investment_projects_ws_status_idx').on(t.workspaceId, t.status),
  ],
);

/** Строка плана: период (номер от начала проекта), статья и сумма. Направление задаёт вид статьи */
export const investmentPlanLines = pgTable(
  'investment_plan_lines',
  {
    id: pk(),
    workspaceId: wsCol(),
    investmentProjectId: uuid('investment_project_id').notNull(),
    periodIndex: integer('period_index').notNull(),
    costItemId: uuid('cost_item_id').notNull(),
    amount: money('amount').notNull(),
    comment: text('comment').notNull().default(''),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
  },
  t => [
    unique('investment_plan_lines_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.investmentProjectId], foreignColumns: [investmentProjects.workspaceId, investmentProjects.id], name: 'investment_plan_lines_project_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.costItemId], foreignColumns: [costItems.workspaceId, costItems.id], name: 'investment_plan_lines_cost_item_fk' }),
    check('investment_plan_lines_period_chk', sql`${t.periodIndex} >= 0`),
    check('investment_plan_lines_amount_chk', sql`${t.amount} > 0`),
    index('investment_plan_lines_project_idx').on(t.investmentProjectId, t.sortOrder),
  ],
);

/** Статья, закреплённая за проектом: запасной путь факта для документов без поля «Инвестпроект». Статья — не больше чем за одним проектом */
export const investmentCostItems = pgTable(
  'investment_cost_items',
  {
    id: pk(),
    workspaceId: wsCol(),
    investmentProjectId: uuid('investment_project_id').notNull(),
    costItemId: uuid('cost_item_id').notNull(),
    createdAt: createdAt(),
  },
  t => [
    unique('investment_cost_items_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.investmentProjectId], foreignColumns: [investmentProjects.workspaceId, investmentProjects.id], name: 'investment_cost_items_project_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.costItemId], foreignColumns: [costItems.workspaceId, costItems.id], name: 'investment_cost_items_cost_item_fk' }),
    uniqueIndex('investment_cost_items_item_uq').on(t.workspaceId, t.costItemId),
    index('investment_cost_items_project_idx').on(t.investmentProjectId),
  ],
);
