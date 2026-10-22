/* Профили участников воркспейса и команды. Таблицы арендатора: workspace_id + RLS. */
import { sql } from 'drizzle-orm';
import { check, foreignKey, index, integer, pgTable, text, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, pk, ts, updatedAt } from './columns';
import { users } from './core';
import { workCalendars } from './calendars';
import { wsCol } from './tenant';

export { wsCol };

export const teams = pgTable(
  'teams',
  {
    id: pk(),
    workspaceId: wsCol(),
    /** Читаемый ключ из демо-данных ('design', 'eng'…), уникален в воркспейсе */
    key: text('key').notNull(),
    name: text('name').notNull(),
    icon: text('icon').notNull().default('users'),
    color: text('color').notNull().default('#5A67D8'),
    description: text('description').notNull().default(''),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [unique('teams_ws_id_uq').on(t.workspaceId, t.id), uniqueIndex('teams_ws_key_uq').on(t.workspaceId, t.key)],
);

/** Профиль участника в воркспейсе (имя, должность, цвет). user_id пуст у приглашённых, ещё не зарегистрированных.
    Инвариант: если user_id задан, существует memberships с той же ролью (смена роли обновляет обе таблицы). */
export const members = pgTable(
  'members',
  {
    id: pk(),
    workspaceId: wsCol(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    email: text('email').notNull(),
    name: text('name').notNull(),
    title: text('title').notNull().default(''),
    color: text('color').notNull().default('#5A67D8'),
    teamId: uuid('team_id'),
    role: text('role', { enum: ['owner', 'admin', 'member', 'guest'] }).notNull().default('member'),
    status: text('status', { enum: ['active', 'invited', 'deactivated'] }).notNull().default('active'),
    tz: text('tz').notNull().default(''),
    /** Рабочий график сотрудника (пусто — график воркспейса по умолчанию) */
    calendarId: uuid('calendar_id'),
    lastSeenAt: ts('last_seen_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    unique('members_ws_id_uq').on(t.workspaceId, t.id),
    uniqueIndex('members_ws_email_uq').on(t.workspaceId, sql`lower(${t.email})`),
    uniqueIndex('members_ws_user_uq').on(t.workspaceId, t.userId),
    foreignKey({ columns: [t.workspaceId, t.teamId], foreignColumns: [teams.workspaceId, teams.id], name: 'members_team_fk' }),
    foreignKey({ columns: [t.workspaceId, t.calendarId], foreignColumns: [workCalendars.workspaceId, workCalendars.id], name: 'members_calendar_fk' }),
    check('members_role_chk', sql`${t.role} in ('owner','admin','member','guest')`),
    check('members_status_chk', sql`${t.status} in ('active','invited','deactivated')`),
    index('members_user_idx').on(t.userId),
  ],
);
