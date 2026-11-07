/* Словари MCP-инструментов (docs/architecture/mcp.md): вид → корневой путь и поле заголовка, отчёт → путь.
   Путь каждого вида обязан быть в TENANT_PATHS (проверяет тест mcp.test.ts). */
export interface EntityKind {
  /** Корневой путь API арендатора (GET / и GET /:id) */
  path: string;
  /** Поле заголовка в элементах списка GET / */
  title: string;
}

export const ENTITY_KINDS = {
  company: { path: '/companies', title: 'name' },
  contact: { path: '/contacts', title: 'name' },
  product: { path: '/products', title: 'name' },
  deal: { path: '/deals', title: 'name' },
  lead: { path: '/leads', title: 'name' },
  project: { path: '/projects', title: 'name' },
  task: { path: '/tasks', title: 'title' },
  document: { path: '/documents', title: 'number' },
  payment: { path: '/payments', title: 'number' },
  warehouse: { path: '/warehouses', title: 'name' },
  organization: { path: '/organizations', title: 'name' },
  contract: { path: '/contracts', title: 'number' },
  work_order: { path: '/work-orders', title: 'number' },
  production_order: { path: '/production-orders', title: 'number' },
  object: { path: '/objects', title: 'name' },
  crm_activity: { path: '/crm-activities', title: 'subject' },
} as const satisfies Record<string, EntityKind>;

export type EntityKindName = keyof typeof ENTITY_KINDS;
export const ENTITY_KIND_NAMES = Object.keys(ENTITY_KINDS) as [EntityKindName, ...EntityKindName[]];

/** Ключевые отчёты run_report: имя → путь GET (параметры — ?params, проверяет zod-схема маршрута) */
export const REPORTS = {
  cash_flow: '/payments/reports/cash-flow',
  receivables: '/payments/reports/receivables',
  payables: '/payments/reports/payables',
  deal_funnel: '/deal-funnel',
  sales_plan: '/sales-plan/analysis',
  payment_calendar: '/payment-calendar',
  production_release: '/production/reports/release',
  service_states: '/services/reports/states',
} as const satisfies Record<string, string>;

export type ReportName = keyof typeof REPORTS;
export const REPORT_NAMES = Object.keys(REPORTS) as [ReportName, ...ReportName[]];
