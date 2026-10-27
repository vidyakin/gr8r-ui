/* Константы, общие для API, БД и фронтенда. */

/** Набор статусов по умолчанию (колонки доски); новые воркспейсы получают его при создании */
export const STATUSES = [
  { id: 'backlog', name: 'Backlog' },
  { id: 'todo', name: 'To Do' },
  { id: 'progress', name: 'In Progress' },
  { id: 'review', name: 'Review' },
  { id: 'done', name: 'Done' },
] as const;

/** Приоритет — шкала 1–10 (10 — самый срочный) */
export const PRIORITIES: number[] = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1];

/** Роли воркспейса по убыванию прав */
export const ROLES = ['owner', 'admin', 'member', 'guest'] as const;
export type Role = (typeof ROLES)[number];

export const PROJECT_STATUSES = ['planning', 'active', 'risk', 'hold', 'complete'] as const;

/** Модуль задач: general — обычные задачи, production — производство, services — услуги.
    Модуль задачи совпадает с модулем проекта, в котором она лежит (у каждого модуля свой системный проект) */
export const TASK_MODULES = ['general', 'production', 'services'] as const;
export type TaskModule = (typeof TASK_MODULES)[number];
export const TASK_MODULE_LABELS: Record<TaskModule, string> = { general: 'General', production: 'Production', services: 'Services' };

export const PROJECT_COLORS = ['indigo', 'blue', 'violet', 'teal', 'rose', 'amber', 'green', 'slate'] as const;
export const MEMBER_STATUSES = ['active', 'invited', 'deactivated'] as const;
export const NOTIFICATION_TYPES = ['mention', 'assign', 'comment', 'update'] as const;
export const VIEW_TYPES = ['list', 'board', 'table', 'calendar', 'timeline'] as const;
export const FILE_KINDS = ['fig', 'pdf', 'zip', 'img', 'sheet', 'doc', 'code', 'other'] as const;
export const DEAL_STAGES = ['lead', 'qualified', 'proposal', 'negotiation', 'won', 'lost'] as const;
export const CRM_ACTIVITY_TYPES = ['call', 'email', 'meeting', 'note', 'task'] as const;

/** Системные сущности конструктора: у их таблиц есть колонка custom jsonb. Регистрируются в entities при создании воркспейса */
export const SYSTEM_ENTITIES = [
  { key: 'task', name: 'Tasks', icon: 'list-checks', titleField: 'title' },
  { key: 'project', name: 'Projects', icon: 'folder-kanban', titleField: 'name' },
  { key: 'deal', name: 'Deals', icon: 'handshake', titleField: 'name' },
  { key: 'company', name: 'Companies', icon: 'building-2', titleField: 'name' },
  { key: 'contact', name: 'Contacts', icon: 'contact-round', titleField: 'name' },
  { key: 'product', name: 'Products', icon: 'package', titleField: 'name' },
  { key: 'lead', name: 'Leads', icon: 'user-plus', titleField: 'name' },
] as const;
export type SystemEntityKey = (typeof SYSTEM_ENTITIES)[number]['key'];

/* ---------------- каталог и производство ---------------- */

/** Виды номенклатуры: товар, услуга, работа (заказ-наряд) и операция (работа производства: не продаётся и склад не двигает). Список расширяют осторожно —
    CHECK в БД (products_kind_chk) перечисляет те же значения, их добавляют вместе с миграцией */
export const PRODUCT_KINDS = ['goods', 'service', 'work', 'operation'] as const;
export type ProductKind = (typeof PRODUCT_KINDS)[number];
export const PRODUCT_KIND_LABELS: Record<ProductKind, string> = { goods: 'Goods', service: 'Service', work: 'Work', operation: 'Operation' };

/** Способ расчёта стоимости операции: за единицу продукции или по норме времени */
export const OPERATION_RATE_UNITS = ['per_unit', 'per_hour'] as const;
export type OperationRateUnit = (typeof OPERATION_RATE_UNITS)[number];

/** Ставки НДС: 'none' — без НДС */
export const VAT_RATES = ['none', '0', '5', '7', '10', '20'] as const;
export type VatRate = (typeof VAT_RATES)[number];
export const VAT_LABELS: Record<VatRate, string> = { none: 'No VAT', '0': '0%', '5': '5%', '7': '7%', '10': '10%', '20': '20%' };

/** Базовый набор единиц ОКЕИ (код, название по справочнику, обозначение). Воркспейс получает его при создании и может добавлять свои */
export const OKEI_UNITS = [
  { code: '796', name: 'Штука', symbol: 'шт' },
  { code: '778', name: 'Упаковка', symbol: 'упак' },
  { code: '704', name: 'Набор', symbol: 'набор' },
  { code: '625', name: 'Лист', symbol: 'лист' },
  { code: '736', name: 'Рулон', symbol: 'рул' },
  { code: '166', name: 'Килограмм', symbol: 'кг' },
  { code: '163', name: 'Грамм', symbol: 'г' },
  { code: '168', name: 'Тонна', symbol: 'т' },
  { code: '112', name: 'Литр', symbol: 'л' },
  { code: '111', name: 'Миллилитр', symbol: 'мл' },
  { code: '006', name: 'Метр', symbol: 'м' },
  { code: '004', name: 'Сантиметр', symbol: 'см' },
  { code: '003', name: 'Миллиметр', symbol: 'мм' },
  { code: '055', name: 'Квадратный метр', symbol: 'м²' },
  { code: '113', name: 'Кубический метр', symbol: 'м³' },
  { code: '356', name: 'Час', symbol: 'ч' },
  { code: '359', name: 'Сутки', symbol: 'сут' },
  { code: '362', name: 'Месяц', symbol: 'мес' },
  { code: '876', name: 'Условная единица', symbol: 'усл. ед' },
] as const;

export const BOM_KINDS = ['material', 'semi', 'work', 'expense', 'output', 'waste'] as const;
export type BomKind = (typeof BOM_KINDS)[number];
/** expense — расход: услуга подрядчика входит в плановую себестоимость, но со склада не списывается (строка 8.1.1 УНФ);
    output — выходной продукт разборки: он не расходуется, а приходуется (спецификация разборки);
    waste — возвратные отходы: приходуются на склад отходов финальным этапом, плановая себестоимость уменьшается
    на их учётную стоимость */
export const BOM_KIND_LABELS: Record<BomKind, string> = { material: 'Material', semi: 'Semi-finished product', work: 'Work operation', expense: 'Expense', output: 'Output', waste: 'Waste' };
export const MANUFACTURED_KINDS = ['product', 'semi'] as const;

/** Стоимость возвратных отходов в шапке выпуска: zero — приходуются по 0, себестоимость продукции не меняется;
    accounting — приходуются по учётной цене и уменьшают себестоимость продукции */
export const WASTE_VALUATION = ['zero', 'accounting'] as const;
/** Режим списания материалов выпуска: при проведении выпуска или по итогам смены (документ «Распределение материалов») */
export const MATERIAL_MODES = ['on_release', 'shift'] as const;
export type MaterialMode = (typeof MATERIAL_MODES)[number];
export type WasteValuation = (typeof WASTE_VALUATION)[number];

/** Источник учётной цены возвратных отходов (настройка воркспейса): цена закупки (по умолчанию), цена продажи или средняя склада */
export const WASTE_PRICE_SOURCES = ['purchase', 'price', 'avg_cost'] as const;
export type WastePriceSource = (typeof WASTE_PRICE_SOURCES)[number];

/** Режим брака позиции выпуска: cost — в себестоимость годной продукции (брак не приходуется),
    expense — на склад брака по себестоимости годного, дальше списание */
export const DEFECT_MODES = ['cost', 'expense'] as const;
export type DefectMode = (typeof DEFECT_MODES)[number];

/** Вид спецификации: сборка (изделие из материалов) или разборка (исходный товар делится на выходные продукты) */
export const SPEC_MODES = ['assembly', 'disassembly'] as const;
export type SpecMode = (typeof SPEC_MODES)[number];
export const SPEC_MODE_LABELS: Record<SpecMode, string> = { assembly: 'Assembly', disassembly: 'Disassembly' };

/** Типы значений параметра спецификации: число (замер), вариант (цвет) и флажок */
export const PARAM_TYPES = ['number', 'select', 'boolean'] as const;
export type ParamType = (typeof PARAM_TYPES)[number];

/** Предел числа комбинаций в генераторе «Создать все комбинации» */
export const VARIANT_MAX_COMBINATIONS = 200;

/** Источник цены себестоимости в калькуляции заказа: средняя склада, последняя цена закупки или закупочная цена товара */
export const COST_PRICE_SOURCES = ['avg', 'last_purchase', 'purchase_price'] as const;
export type CostPriceSource = (typeof COST_PRICE_SOURCES)[number];
export const COST_PRICE_SOURCE_LABELS: Record<CostPriceSource, string> = {
  avg: 'Average warehouse cost',
  last_purchase: 'Last purchase price',
  purchase_price: 'Purchase price of the product',
};

/** Типы строк калькуляции заказа: состав изделия и разовые расходы (доставка и т. п.) */
export const CALC_LINE_TYPES = ['material', 'semi', 'work', 'expense', 'extra'] as const;
export type CalcLineType = (typeof CALC_LINE_TYPES)[number];
export const CALC_LINE_LABELS: Record<CalcLineType, string> = { material: 'Material', semi: 'Semi-finished product', work: 'Work operation', expense: 'Expense', extra: 'One-off expense' };

/** Режим полуфабриката в строке BOM: stock — полуфабрикат выпускается отдельно и списывается со склада,
    explode — разворачивается до материалов и работ в том же выпуске */
export const SEMI_MODES = ['stock', 'explode'] as const;
export type SemiMode = (typeof SEMI_MODES)[number];

/** Откуда берётся цена материала при расчёте себестоимости. avg_cost — средняя себестоимость склада (этап 5);
    пока товара нет на складах, расчёт берёт закупочную цену */
export const MATERIAL_PRICE_SOURCES = ['purchase', 'price', 'avg_cost'] as const;
export type MaterialPriceSource = (typeof MATERIAL_PRICE_SOURCES)[number];

/** Способ пополнения товара: закупить на склад или выпустить своим производством */
export const REPLENISHMENT_MODES = ['purchase', 'production'] as const;
export type ReplenishmentMode = (typeof REPLENISHMENT_MODES)[number];

/** Способ пополнения по норме запаса: закупить, выпустить или переместить с другого склада */
export const STOCK_REPLENISHMENT = ['purchase', 'production', 'transfer'] as const;
export type StockReplenishment = (typeof STOCK_REPLENISHMENT)[number];
export const STOCK_REPLENISHMENT_LABELS: Record<StockReplenishment, string> = { purchase: 'Purchase', production: 'Production', transfer: 'Transfer' };

/** План производства: шаг периодов (неделя или месяц) и состояние (черновик → утверждён) */
export const PLAN_STEPS = ['week', 'month'] as const;
export type PlanStep = (typeof PLAN_STEPS)[number];
export const PLAN_STATUSES = ['draft', 'approved'] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

/** Методики расчёта потребностей: по заказам с правилом мин./макс. и по продажам */
export const NEEDS_METHODS = ['orders', 'sales_minmax', 'sales_statistics'] as const;
export type NeedsMethod = (typeof NEEDS_METHODS)[number];
export const NEEDS_METHOD_LABELS: Record<NeedsMethod, string> = {
  orders: 'By orders, min/max',
  sales_minmax: 'By sales, min/max',
  sales_statistics: 'By sales statistics',
};
