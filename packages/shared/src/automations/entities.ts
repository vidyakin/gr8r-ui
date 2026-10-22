/* Сущности и встроенные поля для автоматизаций. Пользовательские поля берутся из метаданных конструктора (таблица fields),
   а встроенные колонки системных таблиц описаны здесь: в `fields` они не заводятся. `writable` — колонки, которые узел
   «Обновить поле» может менять (значение проверяется схемой поля того же типа, что и в конструкторе). */
import { DEAL_STAGES, PROJECT_STATUSES, SYSTEM_ENTITIES, TASK_MODULES } from '../constants';
import type { FieldOptions, FieldType } from '../fields';

/** Сущности, события которых могут запускать flow: системные, документы и пользовательские (их ключи — из конструктора) */
export const AUTOMATION_SYSTEM_ENTITIES = [...SYSTEM_ENTITIES.map(e => ({ key: e.key as string, name: e.name as string })), { key: 'document', name: 'Documents' }];

export interface BuiltinField {
  /** Имя свойства записи (camelCase), как в событии и в `trigger.record` */
  key: string;
  name: string;
  type: FieldType;
  writable: boolean;
  options?: FieldOptions;
}

const f = (key: string, name: string, type: FieldType, writable = true, options?: FieldOptions): BuiltinField => ({ key, name, type, writable, ...(options ? { options } : {}) });
const choices = (values: readonly string[]): FieldOptions => ({ choices: values.map(v => ({ value: v, label: v, color: 'gray' })) });

export const BUILTIN_FIELDS: Record<string, BuiltinField[]> = {
  task: [
    f('title', 'Title', 'text'),
    f('description', 'Description', 'long_text'),
    f('status', 'Status', 'text'),
    f('module', 'Module', 'select', false, choices(TASK_MODULES)),
    f('priority', 'Priority', 'number', true, { min: 1, max: 10 }),
    f('assigneeId', 'Assignee', 'user'),
    f('dueDate', 'Due date', 'date'),
    f('startDate', 'Start date', 'date'),
    f('projectId', 'Project', 'ref', false, { refEntity: 'project' }),
  ],
  project: [
    f('name', 'Name', 'text'),
    f('description', 'Description', 'long_text'),
    f('status', 'Status', 'select', true, choices(PROJECT_STATUSES)),
    f('leadId', 'Lead', 'user'),
    f('dueDate', 'Due date', 'date'),
    f('startDate', 'Start date', 'date'),
  ],
  deal: [
    f('name', 'Name', 'text'),
    f('stage', 'Stage', 'select', true, choices(DEAL_STAGES)),
    f('amount', 'Amount', 'money', true, { min: 0 }),
    f('currency', 'Currency', 'text'),
    f('ownerId', 'Owner', 'user'),
    f('companyId', 'Company', 'ref', true, { refEntity: 'company' }),
    f('closeDate', 'Close date', 'date'),
    f('lostReason', 'Lost reason', 'text'),
  ],
  company: [
    f('name', 'Name', 'text'),
    f('industry', 'Industry', 'text'),
    f('size', 'Size', 'text'),
    f('ownerId', 'Owner', 'user'),
    f('website', 'Website', 'text'),
    f('city', 'City', 'text'),
  ],
  contact: [
    f('name', 'Name', 'text'),
    f('title', 'Position', 'text'),
    f('email', 'Email', 'text'),
    f('phone', 'Phone', 'text'),
    f('ownerId', 'Owner', 'user'),
    f('companyId', 'Company', 'ref', true, { refEntity: 'company' }),
  ],
  product: [f('name', 'Name', 'text'), f('sku', 'SKU', 'text'), f('description', 'Description', 'long_text'), f('price', 'Price', 'money', true, { min: 0 }), f('purchasePrice', 'Purchase price', 'money', true, { min: 0 })],
  // Документами управляют проведение и отмена: поля только для чтения (триггеры «поле изменилось», условия, подстановки)
  document: [f('status', 'Status', 'select', false, choices(['draft', 'posted', 'cancelled'])), f('state', 'State', 'text', false), f('number', 'Number', 'text', false), f('date', 'Date', 'date', false), f('total', 'Total', 'money', false), f('responsibleId', 'Responsible', 'user', false)],
};

/** Таблица записей системной сущности (имена колонок — как в схеме БД; сопоставление с Drizzle-таблицей — в воркере) */
export const SYSTEM_ENTITY_KEYS = new Set(AUTOMATION_SYSTEM_ENTITIES.map(e => e.key));

/** Сущности, у которых можно записать комментарий узлом «Записать комментарий» */
export const COMMENTABLE_ENTITIES = ['task', 'deal'] as const;

