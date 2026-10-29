/* Тарифы и лицензии арендаторов (задача 1205, docs/architecture/licensing.md). Платформенные таблицы: данные оператора
   установки, а не арендатора. Приложению (app_user) доступно только чтение своей строки лицензии, запись — через
   SECURITY DEFINER-функции оператора (миграция 0057). */
import { sql } from 'drizzle-orm';
import { boolean, index, integer, jsonb, pgTable, primaryKey, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { archivedAt, createdAt, pk, ts, updatedAt } from './columns';
import { users, workspaces } from './core';

/** Справочник тарифов оператора. Модули — идентификаторы каталога в коде (`MODULES` в @gr8r/shared) */
export const licensePlans = pgTable(
  'license_plans',
  {
    id: pk(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    modules: text('modules').array().notNull().default(sql`'{}'::text[]`),
    /** Тариф включает все модули каталога, в том числе будущие («Полный») */
    allModules: boolean('all_modules').notNull().default(false),
    /** Лимиты (пользователи, организации, склады, файлы) — проверит задача 1207 */
    limits: jsonb('limits').$type<Record<string, number>>().notNull().default({}),
    /** Пробный период при создании арендатора, дней (задача 1206) */
    trialDays: integer('trial_days'),
    /** Тариф новых арендаторов и арендаторов без назначения */
    isDefault: boolean('is_default').notNull().default(false),
    sortOrder: integer('sort_order').notNull().default(0),
    archivedAt: archivedAt(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [uniqueIndex('license_plans_key_uq').on(t.key), uniqueIndex('license_plans_default_uq').on(t.isDefault).where(sql`${t.isDefault}`)],
);

/** Назначенный арендатору тариф: срок тарифа и персональные лимиты поверх лимитов тарифа */
export const workspaceLicenses = pgTable('workspace_licenses', {
  workspaceId: uuid('workspace_id')
    .primaryKey()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  planId: uuid('plan_id')
    .notNull()
    .references(() => licensePlans.id),
  /** null — бессрочно */
  planExpiresAt: ts('plan_expires_at'),
  /** Тариф выдан как пробный: срок plan_expires_at — конец пробного периода (задача 1206) */
  isTrial: boolean('is_trial').notNull().default(false),
  limits: jsonb('limits').$type<Record<string, number>>().notNull().default({}),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Докупленные модули арендатора со своим сроком */
export const workspaceModuleGrants = pgTable(
  'workspace_module_grants',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    module: text('module').notNull(),
    /** null — бессрочно */
    expiresAt: ts('expires_at'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  t => [primaryKey({ columns: [t.workspaceId, t.module], name: 'workspace_module_grants_pk' }), index('workspace_module_grants_expires_idx').on(t.expiresAt)],
);

/** Журнал изменений лицензии арендатора (задача 1209): кто из операторов и когда сменил тариф, модули, сроки, лимиты (старое → новое).
    Пишут только SECURITY DEFINER-функции оператора; арендатору таблица недоступна. Запись — одно изменение одного поля */
export const licenseLog = pgTable(
  'license_log',
  {
    id: pk(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    /** Оператор; без внешнего ключа — журнал переживает удаление пользователя. null — система (пробный период при создании арендатора) */
    actorId: uuid('actor_id'),
    actorEmail: text('actor_email'),
    at: ts('at').notNull().defaultNow(),
    /** plan | plan_expires | grant_added | grant_removed | grant_expires | limit | trial | trial_started | plan_edit */
    kind: text('kind').notNull(),
    /** Модуль (grant_*), ключ лимита (limit), изменённое поле тарифа (plan_edit) */
    subject: text('subject'),
    /** Название тарифа для plan_edit */
    context: text('context'),
    oldValue: jsonb('old_value'),
    newValue: jsonb('new_value'),
  },
  t => [index('license_log_ws_idx').on(t.workspaceId, t.at)],
);
