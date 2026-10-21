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
] as const;
export type SystemEntityKey = (typeof SYSTEM_ENTITIES)[number]['key'];

/* ---------------- каталог и производство ---------------- */

export const PRODUCT_KINDS = ['goods', 'service'] as const;
export type ProductKind = (typeof PRODUCT_KINDS)[number];

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

export const BOM_KINDS = ['material', 'semi', 'work'] as const;
export type BomKind = (typeof BOM_KINDS)[number];
export const MANUFACTURED_KINDS = ['product', 'semi'] as const;

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
