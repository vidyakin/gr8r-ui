/* Токены доступа агентов (задача 1285, docs/architecture/agent-tokens.md): какие разделы открывает каждый корневой
   путь TENANT_PATHS при запросе по токену. В отличие от SECTION_OF_API_PATH (должности, только пути одного раздела)
   здесь закрыты и общие пути — интерфейс токеном не пользуется. Каждый корень TENANT_PATHS обязан попасть ровно в один
   из TOKEN_PATH_SECTIONS или TOKEN_OPEN_PATHS (полноту проверяет тест apps/api/test/api-tokens.test.ts). */
import type { PositionSection } from './positions';

/** Корень пути API (`/documents/abc` → `/documents`): по нему ищется соответствие в TOKEN_PATH_SECTIONS и MODULE_OF_PATH */
export const tokenApiRoot = (path: string) => '/' + (path.split('/')[1] ?? '');

/**
 * Корневой путь API → разделы, пересечение которых с sections токена даёт доступ.
 * /documents — документы всех торговых/складских/финансовых/сервисных/производственных разделов.
 */
export const TOKEN_PATH_SECTIONS: Map<string, PositionSection[]> = new Map<string, PositionSection[]>([
  // Задачи, проекты и всё рабочее пространство
  ['/projects', ['projects']],
  ['/statuses', ['projects']],
  ['/tasks', ['projects']],
  ['/comments', ['projects']],
  ['/time-logs', ['projects']],
  ['/saved-views', ['projects']],
  ['/calendar-events', ['projects']],
  ['/activity', ['projects']],
  // CRM: сделки, лиды, реклама, план продаж
  ['/deals', ['crm']],
  ['/deal-pipelines', ['crm']],
  ['/deal-stages', ['crm']],
  ['/deal-lost-reasons', ['crm']],
  ['/deal-funnel', ['crm']],
  ['/crm-activities', ['crm']],
  ['/leads', ['crm']],
  ['/lead-statuses', ['crm']],
  ['/lead-forms', ['crm']],
  ['/lead-sources', ['crm']],
  ['/ad-campaigns', ['crm']],
  ['/ad-expenses', ['crm']],
  ['/ad-report', ['crm']],
  ['/sales-plan', ['crm']],
  // Торговля и склад
  ['/documents', ['trade', 'stock', 'finance', 'services', 'production']],
  ['/stock', ['trade']],
  ['/stock-levels', ['trade']],
  ['/pricing', ['trade']],
  ['/loyalty', ['trade']],
  ['/processing', ['trade']],
  ['/processor-reports', ['trade']],
  ['/supplier-orders', ['trade']],
  ['/serials', ['trade']],
  ['/doc-templates', ['trade']],
  ['/objects', ['trade']],
  ['/supplier-ratings', ['trade']],
  ['/estimates', ['trade']],
  ['/shifts', ['trade']],
  ['/object-acts', ['trade']],
  ['/sub-acts', ['trade']],
  ['/objects-forecast', ['trade']],
  // Услуги и заказ-наряды
  ['/work-orders', ['services']],
  ['/work-order-assignments', ['services']],
  ['/work-order-kinds', ['services']],
  ['/document-states', ['services']],
  ['/services', ['services']],
  ['/contracts', ['services']],
  ['/tariff-plans', ['services']],
  ['/billing', ['services']],
  ['/repair-items', ['services']],
  ['/appointments', ['services']],
  // Доставки
  ['/deliveries', ['deliveries']],
  ['/delivery-methods', ['deliveries']],
  // Производство
  ['/work-centers', ['production']],
  ['/manufactured-items', ['production']],
  ['/bom-lines', ['production']],
  ['/production', ['production']],
  ['/production-orders', ['production']],
  ['/production-plans', ['production']],
  ['/order-calculations', ['production']],
  ['/other-costs', ['production']],
  ['/material-allocations', ['production']],
  ['/defect-reasons', ['production']],
  // Финансы и деньги
  ['/payments', ['finance']],
  ['/payment-calendar', ['finance']],
  ['/payment-requests', ['finance']],
  ['/opening-balances', ['finance']],
  ['/bank-import', ['finance']],
  ['/cash-registers', ['finance']],
  ['/cash-flow-items', ['finance']],
  ['/investments', ['finance']],
  ['/payroll', ['finance']],
  ['/bank-connections', ['finance']],
  ['/payment-links', ['finance']],
  // Транспорт
  ['/fleet', ['transport']],
  ['/trips', ['transport']],
  ['/transport-orders', ['transport']],
  // Автоматизации
  ['/flows', ['automations']],
  ['/flow-runs', ['automations']],
  // Справочники (номенклатура, контрагенты, организации, склады, статьи затрат, должности)
  ['/companies', ['catalog']],
  ['/contacts', ['catalog']],
  ['/units', ['catalog']],
  ['/product-categories', ['catalog']],
  ['/attribute-defs', ['catalog']],
  ['/products', ['catalog']],
  ['/organizations', ['catalog']],
  ['/bank-accounts', ['catalog']],
  ['/warehouses', ['catalog']],
  ['/cost-items', ['catalog']],
  ['/positions', ['catalog']],
  ['/product-kinds', ['catalog']],
]);

/** Пути, доступные любому токену независимо от разделов: участники, уведомления, журнал, справочники конструктора,
    вложения, лицензия и секреты (секреты на запись и так под admin/owner) */
export const TOKEN_OPEN_PATHS: Set<string> = new Set<string>([
  '/notifications',
  '/members',
  '/teams',
  '/events',
  '/entities',
  '/data',
  '/data-search',
  '/attachments',
  '/secrets',
  '/license',
  '/api-tokens',
]);
