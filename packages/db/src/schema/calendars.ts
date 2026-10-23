/* Сменные рабочие графики: недельный и циклический, праздники воркспейса и исключения (отпуск, больничный, ремонт).
   Таблицы арендатора (workspace_id + RLS). График назначается участнику, участку и ресурсу; без назначения —
   график воркспейса по умолчанию (work_calendars.is_default), а если его нет — пятидневка 8 часов. */
import { sql } from 'drizzle-orm';
import { boolean, check, date, index, jsonb, numeric, pgTable, primaryKey, text, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { archivedAt, createdAt, pk, updatedAt } from './columns';
import { wsCol } from './tenant';

export const workCalendars = pgTable(
  'work_calendars',
  {
    id: pk(),
    workspaceId: wsCol(),
    name: text('name').notNull(),
    /** weekly — недельный (рабочие дни недели и часы), cycle — циклический (2/2, сутки через трое) */
    kind: text('kind', { enum: ['weekly', 'cycle'] }).notNull().default('weekly'),
    /** Недельный: { weekdays: [1..7] (1 — понедельник), startHour, endHour }; циклический: { cycle: [1 — рабочий, 0 — выходной] } */
    pattern: jsonb('pattern').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    /** Дата начала цикла (циклический график) */
    cycleStart: date('cycle_start', { mode: 'string' }),
    /** Рабочих часов в день */
    hoursPerDay: numeric('hours_per_day', { precision: 10, scale: 3 }).notNull().default('8'),
    /** График воркспейса по умолчанию: без него участник, участок и ресурс работают по пятидневке */
    isDefault: boolean('is_default').notNull().default(false),
    note: text('note').notNull().default(''),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  t => [
    unique('work_calendars_ws_id_uq').on(t.workspaceId, t.id),
    uniqueIndex('work_calendars_ws_name_uq').on(t.workspaceId, sql`lower(${t.name})`).where(sql`${t.archivedAt} is null`),
    uniqueIndex('work_calendars_ws_default_uq').on(t.workspaceId).where(sql`${t.isDefault} and ${t.archivedAt} is null`),
    check('work_calendars_kind_chk', sql`${t.kind} in ('weekly','cycle')`),
    check('work_calendars_hours_chk', sql`${t.hoursPerDay} >= 0`),
    index('work_calendars_ws_idx').on(t.workspaceId),
  ],
);

/** Праздники воркспейса: общий календарь нерабочих дней */
export const workspaceHolidays = pgTable(
  'workspace_holidays',
  {
    workspaceId: wsCol(),
    /** Дата праздника */
    date: date('date', { mode: 'string' }).notNull(),
    name: text('name').notNull().default(''),
    createdAt: createdAt(),
  },
  t => [primaryKey({ columns: [t.workspaceId, t.date] })],
);

/** Исключение из графика: отпуск, больничный, ремонт — у сотрудника, участка или ресурса */
export const calendarExceptions = pgTable(
  'calendar_exceptions',
  {
    id: pk(),
    workspaceId: wsCol(),
    /** Кого касается */
    scope: text('scope', { enum: ['member', 'work_center', 'resource'] }).notNull(),
    /** Сотрудник, участок или ресурс */
    scopeId: uuid('scope_id').notNull(),
    /** С даты (включительно) */
    dateFrom: date('date_from', { mode: 'string' }).notNull(),
    /** По дату (включительно) */
    dateTo: date('date_to', { mode: 'string' }).notNull(),
    note: text('note').notNull().default(''),
    createdAt: createdAt(),
  },
  t => [
    unique('calendar_exceptions_ws_id_uq').on(t.workspaceId, t.id),
    check('calendar_exceptions_scope_chk', sql`${t.scope} in ('member','work_center','resource')`),
    check('calendar_exceptions_range_chk', sql`${t.dateTo} >= ${t.dateFrom}`),
    index('calendar_exceptions_scope_idx').on(t.workspaceId, t.scope, t.scopeId),
  ],
);
