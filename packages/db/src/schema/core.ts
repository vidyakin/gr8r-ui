/* Учётные записи, сессии, воркспейсы (арендаторы), членство и приглашения. */
import { sql } from 'drizzle-orm';
import { boolean, check, date, index, integer, jsonb, numeric, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { archivedAt, createdAt, pk, ts, updatedAt } from './columns';

/** Глобальные учётные записи (не арендаторские: без workspace_id и без RLS) */
export const users = pgTable(
  'users',
  {
    id: pk(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    name: text('name').notNull(),
    /** Язык интерфейса ('en' | 'ru'); null — как в воркспейсе */
    locale: text('locale'),
    /** Оператор установки: видит список арендаторов, создаёт и удаляет их (выдаёт CLI `bun run operator grant`) */
    isOperator: boolean('is_operator').notNull().default(false),
    createdAt: createdAt(),
    lastLoginAt: ts('last_login_at'),
  },
  t => [uniqueIndex('users_email_uq').on(sql`lower(${t.email})`), check('users_locale_chk', sql`${t.locale} in ('en','ru')`)],
);

/** Сессии: id — sha256 токена из cookie (сам токен в БД не хранится) */
export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
    expiresAt: ts('expires_at').notNull(),
    ip: text('ip'),
    userAgent: text('user_agent'),
  },
  t => [index('sessions_user_idx').on(t.userId), index('sessions_expires_idx').on(t.expiresAt)],
);

/** Счётчики для rate-limit (вход, регистрация): key = «действие:email:ip» */
export const rateLimits = pgTable('rate_limits', {
  key: text('key').primaryKey(),
  hits: integer('hits').notNull().default(0),
  windowStart: ts('window_start').notNull().defaultNow(),
});

/** Воркспейс = арендатор. Сам является границей RLS (политика по id) */
export const workspaces = pgTable(
  'workspaces',
  {
    id: pk(),
    name: text('name').notNull(),
    /** Короткий адрес (WorkspaceInfo.url) */
    slug: text('slug').notNull(),
    color: text('color').notNull().default('#1D1C1A'),
    brand: boolean('brand').notNull().default(false),
    settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
    /** Часовой пояс арендатора (IANA): в нём считаются день и период биллинга и расписания автоматизаций */
    timezone: text('timezone').notNull().default('Europe/Moscow'),
    /** Дата запрета редактирования: документы с датой не позже неё нельзя провести, снять с проведения или исправить */
    closedThrough: date('closed_through', { mode: 'string' }),
    /** Переносить дату запрета на конец закрываемого месяца (настройка закрытия периода, по умолчанию выключена) */
    closeMovesLock: boolean('close_moves_lock').notNull().default(false),
    /** Ставка страховых взносов на зарплату, % (задача 1184) */
    payrollInsuranceRate: numeric('payroll_insurance_rate', { precision: 5, scale: 2 }).notNull().default('30'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    /** regular — клиент, demo — демо-арендатор оператора со сроком жизни expires_at (docs/architecture/deploy.md) */
    kind: text('kind', { enum: ['regular', 'demo'] }).notNull().default('regular'),
    expiresAt: ts('expires_at'),
    /** Оператор запросил удаление: воркер удалит арендатора целиком (purgeTenantsOnce) */
    deleteRequestedAt: ts('delete_requested_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  t => [uniqueIndex('workspaces_slug_uq').on(sql`lower(${t.slug})`), check('workspaces_kind_chk', sql`${t.kind} in ('regular','demo')`)],
);

/** Доступ пользователя к воркспейсу и его роль (источник правды для проверки прав) */
export const memberships = pgTable(
  'memberships',
  {
    id: pk(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['owner', 'admin', 'member', 'guest'] }).notNull(),
    createdAt: createdAt(),
  },
  t => [
    uniqueIndex('memberships_ws_user_uq').on(t.workspaceId, t.userId),
    index('memberships_user_idx').on(t.userId),
    check('memberships_role_chk', sql`${t.role} in ('owner','admin','member','guest')`),
  ],
);

/** Приглашения. Токен вида `<workspace_id>.<secret>`; в БД — только sha256 секрета */
export const invites = pgTable(
  'invites',
  {
    id: pk(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: text('role', { enum: ['admin', 'member', 'guest'] }).notNull(),
    tokenHash: text('token_hash').notNull(),
    invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),
    expiresAt: ts('expires_at').notNull(),
    acceptedAt: ts('accepted_at'),
    createdAt: createdAt(),
  },
  t => [uniqueIndex('invites_token_uq').on(t.tokenHash), index('invites_ws_idx').on(t.workspaceId)],
);
