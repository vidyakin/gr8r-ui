/* Модули и тарифы платформы (задача 1205, docs/architecture/licensing.md). Каталог модулей живёт в коде, а не в таблице:
   у модуля есть корневые пути API, разделы меню, пункты настроек, типы задач воркера и узлы автоматизаций. Какие модули
   включены у арендатора, решает оператор (тариф + докупленные модули); здесь — только чистые правила без БД. */

export const MODULE_IDS = ['core', 'crm', 'trade', 'production', 'services', 'money', 'payroll', 'automations', 'integrations', 'docflow'] as const;
export type ModuleId = (typeof MODULE_IDS)[number];

/** Модуль, который включён всегда */
export const CORE_MODULE: ModuleId = 'core';

export interface ModuleDef {
  id: ModuleId;
  /** Зависимости: включение модуля тянет за собой и их */
  requires: readonly ModuleId[];
  /** Корневые пути API арендатора (`TENANT_PATHS` в apps/api) */
  paths: readonly string[];
  /** Публичные вебхуки: имя сегмента после `/hooks/` */
  hooks: readonly string[];
  /** Идентификаторы разделов меню (`SECTIONS` в apps/web/src/app/routes.ts) */
  sections: readonly string[];
  /** Идентификаторы разделов настроек (`SET_NAV` в apps/web/src/app/settings/nav.ts) */
  settings: readonly string[];
  /** Типы фоновых задач `jobs.type` */
  jobs: readonly string[];
  /** Типы узлов автоматизаций */
  nodes: readonly string[];
}

const def = (d: Partial<ModuleDef> & { id: ModuleId }): ModuleDef => ({ requires: [], paths: [], hooks: [], sections: [], settings: [], jobs: [], nodes: [], ...d });

export const MODULES: readonly ModuleDef[] = [
  // Общее ядро: задачи, проекты, справочники (контрагенты, номенклатура, организации, склады), конструктор сущностей, настройки
  def({
    id: 'core',
    paths: [
      '/projects', '/statuses', '/tasks', '/comments', '/time-logs', '/notifications', '/members', '/teams', '/saved-views', '/calendar-events', '/files', '/activity', '/events',
      '/entities', '/data', '/data-search', '/units', '/product-categories', '/attribute-defs', '/products', '/organizations', '/bank-accounts', '/warehouses', '/cost-items',
      '/companies', '/contacts', '/positions', '/product-kinds', '/secrets', '/license',
    ],
    sections: ['home', 'inbox', 'mytasks', 'favorites', 'notifications', 'overview', 'projects', 'tasks', 'calendar', 'timeline', 'members', 'activity', 'archive', 'search', 'settings', 'system', 'catalog', 'crmCompanies', 'crmContacts'],
    settings: ['workspace', 'appearance', 'language', 'datetime', 'members', 'teams', 'projects', 'permissions', 'data-model', 'organizations', 'warehouses', 'cost-items', 'positions', 'product-kinds'],
    jobs: ['noop', 'index.create', 'index.drop'],
  }),
  def({
    id: 'crm',
    paths: ['/deals', '/deal-pipelines', '/deal-stages', '/deal-lost-reasons', '/deal-funnel', '/crm-activities', '/leads', '/lead-statuses', '/lead-forms', '/lead-sources', '/ad-campaigns', '/ad-expenses', '/ad-report', '/sales-plan'],
    hooks: ['leads'],
    sections: ['crm', 'crmLeads', 'crmAds', 'crmDeals', 'crmFunnel', 'crmActivities', 'crmSalesPlan'],
    settings: ['deal-pipelines', 'lost-reasons', 'lead-statuses', 'lead-forms', 'lead-sources'],
    nodes: [
      'trigger.lead_created', 'trigger.lead_status_changed', 'trigger.deal_stage_changed', 'trigger.deal_won', 'trigger.deal_lost', 'trigger.deal_stage_overdue',
      'action.create_lead', 'action.assign_lead', 'action.move_deal',
    ],
  }),
  def({
    id: 'trade',
    paths: ['/documents', '/stock', '/stock-levels', '/pricing', '/processing', '/processor-reports', '/supplier-orders', '/serials', '/doc-templates'],
    hooks: ['prices'],
    sections: ['sales', 'purchases', 'stockDocs', 'processingDocs', 'inventory', 'inUse', 'serials', 'priceList', 'priceSettings', 'priceKinds', 'crmQuoteTemplates'],
    jobs: ['document.pdf', 'settlement.act_pdf'],
  }),
  def({
    id: 'production',
    requires: ['trade'],
    paths: ['/work-centers', '/manufactured-items', '/bom-lines', '/production', '/production-orders', '/production-plans', '/order-calculations', '/other-costs', '/material-allocations'],
    sections: [
      'production', 'productionOrders', 'productionWorkbench', 'productionNeeds', 'productionPlans', 'productionPlanOrders', 'productionStages', 'productionPiecework', 'productionPlanner',
      'productionResources', 'productionClosing', 'productionWip', 'productionReports', 'otherCosts', 'materialAllocation', 'workCenters',
    ],
    settings: ['production'],
    jobs: ['production.close_period'],
  }),
  def({
    id: 'services',
    requires: ['trade'],
    paths: ['/work-orders', '/work-order-assignments', '/work-order-kinds', '/document-states', '/services', '/contracts', '/tariff-plans', '/billing', '/deliveries', '/delivery-methods', '/appointments', '/repair-items'],
    sections: ['workOrders', 'repairItems', 'servicesTimesheet', 'servicesPlanner', 'servicesReports', 'contracts', 'tariffPlans', 'billing', 'deliveries', 'myDeliveries', 'crmAppointments'],
    settings: ['work-orders', 'delivery-methods'],
    jobs: ['billing.export_zip'],
  }),
  def({
    id: 'money',
    requires: ['trade'],
    paths: ['/payments', '/payment-calendar', '/payment-requests', '/opening-balances', '/bank-import', '/cash-registers', '/cash-flow-items', '/investments'],
    sections: ['money', 'moneyCalendar', 'moneyRequests', 'moneyOpening', 'moneyBalances', 'moneyCashFlow', 'moneyReceivables', 'moneyPayables', 'moneyBankImport', 'moneyReferences', 'investments', 'investmentsPlanFact'],
    nodes: ['trigger.payment_posted', 'trigger.document_paid'],
  }),
  def({
    id: 'payroll',
    requires: ['money'],
    paths: ['/payroll'],
    sections: ['payroll', 'payrollStatements', 'payrollEmployees', 'payrollReports', 'payslip'],
  }),
  def({
    id: 'automations',
    paths: ['/flows', '/flow-runs'],
    sections: ['automations'],
    jobs: ['flow.run'],
    // Общие узлы: триггеры по записям и расписанию, условия, управление потоком и универсальные действия
    nodes: [
      'trigger.record_created', 'trigger.record_updated', 'trigger.field_changed', 'trigger.schedule', 'trigger.manual',
      'logic.condition', 'flow.delay', 'flow.branch',
      'action.update_field', 'action.create_task', 'action.notify', 'action.http_request', 'action.add_comment',
    ],
  }),
  def({
    id: 'integrations',
    requires: ['money'],
    paths: ['/bank-connections', '/payment-links'],
    hooks: ['yookassa'],
    settings: ['integrations'],
    jobs: ['bank.sync', 'yookassa.payment'],
  }),
  // Документооборот (сессия 48): модуль заведён заранее, разделы, пути и задачи добавит задача 1191+
  def({ id: 'docflow' }),
];

export const MODULE_BY_ID: Readonly<Record<ModuleId, ModuleDef>> = Object.fromEntries(MODULES.map(m => [m.id, m])) as Record<ModuleId, ModuleDef>;
export const isModuleId = (v: unknown): v is ModuleId => typeof v === 'string' && (MODULE_IDS as readonly string[]).includes(v);

const invert = (pick: (m: ModuleDef) => readonly string[]): Map<string, ModuleId> => {
  const map = new Map<string, ModuleId>();
  for (const m of MODULES)
    for (const k of pick(m)) {
      if (map.has(k)) throw new Error(`"${k}" belongs to two modules: ${map.get(k)} and ${m.id}`);
      map.set(k, m.id);
    }
  return map;
};

export const MODULE_OF_PATH = invert(m => m.paths);
export const MODULE_OF_HOOK = invert(m => m.hooks);
export const MODULE_OF_SECTION = invert(m => m.sections);
export const MODULE_OF_SETTING = invert(m => m.settings);
export const MODULE_OF_JOB = invert(m => m.jobs);
export const MODULE_OF_NODE = invert(m => m.nodes);

/** Модуль корневого пути API (`/deals/abc` → crm); null — путь не принадлежит модулям */
export function moduleOfApiPath(pathname: string): ModuleId | null {
  const root = '/' + (pathname.split('/')[1] ?? '');
  return MODULE_OF_PATH.get(root) ?? null;
}

/** Модуль адреса интерфейса по самому длинному совпадению пути раздела меню; null — адрес вне модулей (виден всегда).
    sectionPaths — id раздела → путь (`SECTIONS` во фронтенде) */
export function moduleOfSectionPath(pathname: string, sectionPaths: Readonly<Record<string, string>>): ModuleId | null {
  let best: ModuleId | null = null;
  let len = 0;
  for (const [id, path] of Object.entries(sectionPaths)) {
    const m = MODULE_OF_SECTION.get(id);
    if (!m) continue;
    if ((pathname === path || pathname.startsWith(path + '/')) && path.length > len) [best, len] = [m, path.length];
  }
  return best === CORE_MODULE ? null : best; // самый длинный путь — раздел ядра (/crm/companies): ограничений нет
}

/** Набор включённых модулей: ядро + перечисленные + их зависимости. `*` включает всё. Неизвестные идентификаторы игнорируются */
export function resolveModules(raw: Iterable<string>): Set<ModuleId> {
  const out = new Set<ModuleId>([CORE_MODULE]);
  const add = (id: ModuleId) => {
    if (out.has(id) && id !== CORE_MODULE) return;
    out.add(id);
    for (const r of MODULE_BY_ID[id].requires) add(r);
  };
  for (const v of raw) {
    if (v === '*') MODULE_IDS.forEach(add);
    else if (isModuleId(v)) add(v);
  }
  return out;
}

/** Состав лицензии арендатора в сыром виде: так его отдаёт БД (функция `app_workspace_license`) и читает воркер */
export interface LicenseRaw {
  planId: string | null;
  planKey: string | null;
  planName: string | null;
  /** Модули тарифа; тариф с planAllModules включает все */
  planModules: string[];
  planAllModules: boolean;
  /** Срок тарифа арендатора; null — бессрочно */
  planExpiresAt: string | null;
  /** Доп. модули со сроками (null — бессрочно) */
  grants: { module: string; expiresAt: string | null }[];
  /** Лимиты тарифа с персональными поверх него (проверит задача 1207; пока только хранятся) */
  limits: Record<string, unknown>;
}

const active = (expiresAt: string | null, now: Date) => !expiresAt || new Date(expiresAt).getTime() > now.getTime();

/** Включённые модули арендатора: ядро + модули тарифа (пока не истёк срок) + доп. модули с действующим сроком + зависимости */
export function enabledModules(l: LicenseRaw | null, now: Date = new Date()): Set<ModuleId> {
  const raw: string[] = [];
  if (l) {
    if (active(l.planExpiresAt, now)) raw.push(...(l.planAllModules ? ['*'] : l.planModules));
    for (const g of l.grants) if (active(g.expiresAt, now)) raw.push(g.module);
  }
  return resolveModules(raw);
}

/** Ответ GET /license: набор модулей текущего арендатора и сведения о тарифе */
export interface LicenseView {
  modules: ModuleId[];
  plan: { key: string | null; name: string | null; expiresAt: string | null };
  grants: { module: ModuleId; expiresAt: string | null }[];
}

export function licenseView(l: LicenseRaw | null, now: Date = new Date()): LicenseView {
  const on = enabledModules(l, now);
  return {
    modules: MODULE_IDS.filter(id => on.has(id)),
    plan: { key: l?.planKey ?? null, name: l?.planName ?? null, expiresAt: l?.planExpiresAt ?? null },
    grants: (l?.grants ?? []).filter((g): g is { module: ModuleId; expiresAt: string | null } => isModuleId(g.module)),
  };
}

/** Запись журнала изменений лицензии (задача 1209). old/new — значения до и после (null — не было / убрали) */
export interface LicenseLogEntry {
  id: string;
  at: string;
  /** Email оператора на момент изменения; null — система (пробный период при создании арендатора) */
  actorEmail: string | null;
  kind: 'plan' | 'plan_expires' | 'grant_added' | 'grant_removed' | 'grant_expires' | 'limit' | 'trial' | 'trial_started' | 'plan_edit';
  /** Модуль, ключ лимита или поле тарифа */
  subject: string | null;
  /** Название тарифа для plan_edit */
  context: string | null;
  old: unknown;
  new: unknown;
}

/** Модули, нужные набору узлов автоматизации и выключенные у арендатора (по типам узлов; неизвестный тип считается общим узлом автоматизаций) */
export function disabledModulesOfNodes(nodeTypes: Iterable<string>, enabled: ReadonlySet<ModuleId>): ModuleId[] {
  const out = new Set<ModuleId>();
  for (const t of nodeTypes) {
    const m = MODULE_OF_NODE.get(t) ?? 'automations';
    if (!enabled.has(m)) out.add(m);
  }
  return [...out];
}
