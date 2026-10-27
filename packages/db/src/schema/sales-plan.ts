/* Планирование продаж (задача 1133): сценарии, шапка документа «План продаж», его строки и регистр плановых показателей. */
import { sql } from 'drizzle-orm';
import { check, date, foreignKey, index, numeric, pgTable, text, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { archivedAt, createdAt, money, pk, updatedAt } from './columns';
import { productCategories, products } from './catalog';
import { documents, organizations, warehouses } from './documents';
import { members, wsCol } from './people';

/** Сценарий планирования: периодичность и разрез плана */
export const salesPlanScenarios = pgTable(
  'sales_plan_scenarios',
  {
    id: pk(),
    workspaceId: wsCol(),
    name: text('name').notNull(),
    periodicity: text('periodicity', { enum: ['month', 'quarter', 'year'] }).notNull().default('month'),
    dimension: text('dimension', { enum: ['manager', 'category', 'product'] }).notNull().default('manager'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  t => [
    unique('sales_plan_scenarios_ws_id_uq').on(t.workspaceId, t.id),
    uniqueIndex('sales_plan_scenarios_name_uq').on(t.workspaceId, sql`lower(${t.name})`).where(sql`${t.archivedAt} is null`),
    check('sales_plan_scenarios_periodicity_chk', sql`${t.periodicity} in ('month','quarter','year')`),
    check('sales_plan_scenarios_dimension_chk', sql`${t.dimension} in ('manager','category','product')`),
  ],
);

/** Шапка документа «План продаж» (общая шапка — documents): сценарий и начало планируемого года */
export const salesPlanDocs = pgTable(
  'sales_plan_docs',
  {
    documentId: uuid('document_id').primaryKey(),
    workspaceId: wsCol(),
    scenarioId: uuid('scenario_id').notNull(),
    /** Начало первого периода плана (нормализовано под периодичность сценария) */
    periodStart: date('period_start', { mode: 'string' }).notNull(),
  },
  t => [
    foreignKey({ columns: [t.workspaceId, t.documentId], foreignColumns: [documents.workspaceId, documents.id], name: 'sales_plan_docs_document_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.scenarioId], foreignColumns: [salesPlanScenarios.workspaceId, salesPlanScenarios.id], name: 'sales_plan_docs_scenario_fk' }),
  ],
);

const lineCols = {
  periodStart: date('period_start', { mode: 'string' }).notNull(),
  /** Значение разреза: менеджер, категория или товар (пусто — «без менеджера/категории») */
  memberId: uuid('member_id'),
  categoryId: uuid('category_id'),
  productId: uuid('product_id'),
  amount: money('amount').notNull().default('0'),
  qty: numeric('qty', { precision: 18, scale: 3 }).notNull().default('0'),
};

/** Строки плана: период × значение разреза, сумма без НДС (у разреза «товар» ещё количество) */
export const salesPlanLines = pgTable(
  'sales_plan_lines',
  {
    id: pk(),
    workspaceId: wsCol(),
    documentId: uuid('document_id').notNull(),
    ...lineCols,
  },
  t => [
    foreignKey({ columns: [t.workspaceId, t.documentId], foreignColumns: [documents.workspaceId, documents.id], name: 'sales_plan_lines_document_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.memberId], foreignColumns: [members.workspaceId, members.id], name: 'sales_plan_lines_member_fk' }),
    foreignKey({ columns: [t.workspaceId, t.categoryId], foreignColumns: [productCategories.workspaceId, productCategories.id], name: 'sales_plan_lines_category_fk' }),
    foreignKey({ columns: [t.workspaceId, t.productId], foreignColumns: [products.workspaceId, products.id], name: 'sales_plan_lines_product_fk' }),
    check('sales_plan_lines_amount_chk', sql`${t.amount} >= 0 and ${t.qty} >= 0`),
    index('sales_plan_lines_document_idx').on(t.documentId),
  ],
);

/** Регистр плановых показателей: пишется при проведении плана, стирается при отмене проведения */
export const salesPlanFigures = pgTable(
  'sales_plan_figures',
  {
    id: pk(),
    workspaceId: wsCol(),
    documentId: uuid('document_id').notNull(),
    scenarioId: uuid('scenario_id').notNull(),
    warehouseId: uuid('warehouse_id'),
    organizationId: uuid('organization_id'),
    ...lineCols,
  },
  t => [
    foreignKey({ columns: [t.workspaceId, t.documentId], foreignColumns: [documents.workspaceId, documents.id], name: 'sales_plan_figures_document_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.scenarioId], foreignColumns: [salesPlanScenarios.workspaceId, salesPlanScenarios.id], name: 'sales_plan_figures_scenario_fk' }),
    foreignKey({ columns: [t.workspaceId, t.warehouseId], foreignColumns: [warehouses.workspaceId, warehouses.id], name: 'sales_plan_figures_warehouse_fk' }),
    foreignKey({ columns: [t.workspaceId, t.organizationId], foreignColumns: [organizations.workspaceId, organizations.id], name: 'sales_plan_figures_organization_fk' }),
    index('sales_plan_figures_scenario_idx').on(t.workspaceId, t.scenarioId, t.periodStart),
    index('sales_plan_figures_document_idx').on(t.documentId),
  ],
);
