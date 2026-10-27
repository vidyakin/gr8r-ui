/* Запись клиентов на приём (задача 1171): график специалиста, исключения, записи, документ «Оказанные услуги за день»,
   журналы идемпотентности воркера. Все таблицы арендаторские (workspace_id + RLS), ссылки — составные FK. */
import { sql } from 'drizzle-orm';
import { check, date, foreignKey, index, integer, jsonb, numeric, pgTable, primaryKey, text, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { createdAt, money, pk, updatedAt } from './columns';
import { products } from './catalog';
import { companies, contacts } from './crm';
import { documents } from './documents';
import { members, wsCol } from './people';

/** График приёма специалиста: длительность слота, диапазон сетки и недельная сетка (дни 1–7 → начала рабочих слотов, минуты от полуночи) */
export const specialistSchedules = pgTable(
  'specialist_schedules',
  {
    id: pk(),
    workspaceId: wsCol(),
    memberId: uuid('member_id').notNull(),
    slotMinutes: integer('slot_minutes').notNull().default(30),
    dayStartMin: integer('day_start_min').notNull().default(480),
    dayEndMin: integer('day_end_min').notNull().default(1200),
    week: jsonb('week').$type<Record<string, number[]>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    unique('specialist_schedules_ws_id_uq').on(t.workspaceId, t.id),
    uniqueIndex('specialist_schedules_member_uq').on(t.workspaceId, t.memberId),
    foreignKey({ columns: [t.workspaceId, t.memberId], foreignColumns: [members.workspaceId, members.id], name: 'specialist_schedules_member_fk' }).onDelete('cascade'),
    check('specialist_schedules_slot_chk', sql`${t.slotMinutes} in (15,30,45,60,90)`),
    check('specialist_schedules_range_chk', sql`${t.dayStartMin} >= 0 and ${t.dayEndMin} <= 1440 and ${t.dayEndMin} > ${t.dayStartMin}`),
  ],
);

/** Исключение на дату: slots = null — выходной, иначе свой набор слотов на день */
export const specialistScheduleExceptions = pgTable(
  'specialist_schedule_exceptions',
  {
    id: pk(),
    workspaceId: wsCol(),
    memberId: uuid('member_id').notNull(),
    date: date('date', { mode: 'string' }).notNull(),
    slots: jsonb('slots').$type<number[] | null>(),
    note: text('note').notNull().default(''),
    createdAt: createdAt(),
  },
  t => [
    uniqueIndex('specialist_schedule_exceptions_uq').on(t.workspaceId, t.memberId, t.date),
    foreignKey({ columns: [t.workspaceId, t.memberId], foreignColumns: [members.workspaceId, members.id], name: 'specialist_exceptions_member_fk' }).onDelete('cascade'),
  ],
);

/** Запись на приём: дата и начало (минуты от полуночи), число слотов подряд и длина слота на момент записи */
export const appointments = pgTable(
  'appointments',
  {
    id: pk(),
    workspaceId: wsCol(),
    specialistId: uuid('specialist_id').notNull(),
    contactId: uuid('contact_id'),
    companyId: uuid('company_id'),
    productId: uuid('product_id').notNull(),
    date: date('date', { mode: 'string' }).notNull(),
    startMin: integer('start_min').notNull(),
    slots: integer('slots').notNull().default(1),
    slotMinutes: integer('slot_minutes').notNull(),
    status: text('status', { enum: ['booked', 'confirmed', 'came', 'no_show', 'cancelled'] }).notNull().default('booked'),
    cancelReason: text('cancel_reason'),
    price: money('price').notNull().default('0'),
    comment: text('comment').notNull().default(''),
    /** Строка документа «Оказанные услуги за день», в которую запись попала (SET NULL по списку колонок — правка миграции) */
    dayLineId: uuid('day_line_id'),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [
    unique('appointments_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.specialistId], foreignColumns: [members.workspaceId, members.id], name: 'appointments_specialist_fk' }),
    foreignKey({ columns: [t.workspaceId, t.contactId], foreignColumns: [contacts.workspaceId, contacts.id], name: 'appointments_contact_fk' }),
    foreignKey({ columns: [t.workspaceId, t.companyId], foreignColumns: [companies.workspaceId, companies.id], name: 'appointments_company_fk' }),
    foreignKey({ columns: [t.workspaceId, t.productId], foreignColumns: [products.workspaceId, products.id], name: 'appointments_product_fk' }),
    foreignKey({ columns: [t.workspaceId, t.dayLineId], foreignColumns: [serviceDayLines.workspaceId, serviceDayLines.id], name: 'appointments_day_line_fk' }).onDelete('set null'),
    check('appointments_status_chk', sql`${t.status} in ('booked','confirmed','came','no_show','cancelled')`),
    check('appointments_slots_chk', sql`${t.slots} >= 1 and ${t.startMin} >= 0 and ${t.startMin} + ${t.slots} * ${t.slotMinutes} <= 1440`),
    check('appointments_client_chk', sql`${t.contactId} is not null or ${t.companyId} is not null`),
    index('appointments_specialist_day_idx').on(t.workspaceId, t.specialistId, t.date),
    index('appointments_contact_idx').on(t.workspaceId, t.contactId),
    index('appointments_company_idx').on(t.workspaceId, t.companyId),
  ],
);

/** Документ «Оказанные услуги за день»: шапка (специалист; дата — в documents) */
export const serviceDayDocs = pgTable(
  'service_day_docs',
  {
    documentId: uuid('document_id').primaryKey(),
    workspaceId: wsCol(),
    specialistId: uuid('specialist_id').notNull(),
  },
  t => [
    foreignKey({ columns: [t.workspaceId, t.documentId], foreignColumns: [documents.workspaceId, documents.id], name: 'service_day_docs_document_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.specialistId], foreignColumns: [members.workspaceId, members.id], name: 'service_day_docs_specialist_fk' }),
  ],
);

/** Строки документа дня: клиент (компания-покупатель), услуга или товар, время, количество и цена */
export const serviceDayLines = pgTable(
  'service_day_lines',
  {
    id: pk(),
    workspaceId: wsCol(),
    documentId: uuid('document_id').notNull(),
    companyId: uuid('company_id').notNull(),
    contactId: uuid('contact_id'),
    productId: uuid('product_id').notNull(),
    startMin: integer('start_min'),
    qty: numeric('qty', { precision: 18, scale: 3 }).notNull().default('1'),
    price: money('price').notNull().default('0'),
    amount: money('amount').notNull().default('0'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
  },
  t => [
    unique('service_day_lines_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.documentId], foreignColumns: [documents.workspaceId, documents.id], name: 'service_day_lines_document_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.companyId], foreignColumns: [companies.workspaceId, companies.id], name: 'service_day_lines_company_fk' }),
    foreignKey({ columns: [t.workspaceId, t.contactId], foreignColumns: [contacts.workspaceId, contacts.id], name: 'service_day_lines_contact_fk' }),
    foreignKey({ columns: [t.workspaceId, t.productId], foreignColumns: [products.workspaceId, products.id], name: 'service_day_lines_product_fk' }),
    check('service_day_lines_qty_chk', sql`${t.qty} > 0 and ${t.price} >= 0`),
    index('service_day_lines_document_idx').on(t.documentId),
  ],
);

/** Продажи, созданные проведением документа дня (по одной на клиента) */
export const serviceDaySales = pgTable(
  'service_day_sales',
  {
    workspaceId: wsCol(),
    dayDocumentId: uuid('day_document_id').notNull(),
    saleDocumentId: uuid('sale_document_id').notNull(),
  },
  t => [
    primaryKey({ columns: [t.dayDocumentId, t.saleDocumentId] }),
    foreignKey({ columns: [t.workspaceId, t.dayDocumentId], foreignColumns: [documents.workspaceId, documents.id], name: 'service_day_sales_day_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.saleDocumentId], foreignColumns: [documents.workspaceId, documents.id], name: 'service_day_sales_sale_fk' }).onDelete('cascade'),
  ],
);

/** Журнал напоминаний «Подтвердите запись»: одно дело на запись */
export const appointmentReminders = pgTable(
  'appointment_reminders',
  {
    workspaceId: wsCol(),
    appointmentId: uuid('appointment_id').primaryKey(),
    activityId: uuid('activity_id'),
    createdAt: createdAt(),
  },
  t => [foreignKey({ columns: [t.workspaceId, t.appointmentId], foreignColumns: [appointments.workspaceId, appointments.id], name: 'appointment_reminders_fk' }).onDelete('cascade')],
);

/** Журнал уведомлений о незакрытых днях: одно на (специалист, дата, вечер/утро) */
export const appointmentDayAlerts = pgTable(
  'appointment_day_alerts',
  {
    workspaceId: wsCol(),
    specialistId: uuid('specialist_id').notNull(),
    date: date('date', { mode: 'string' }).notNull(),
    kind: text('kind', { enum: ['evening', 'morning'] }).notNull(),
    createdAt: createdAt(),
  },
  t => [
    primaryKey({ columns: [t.specialistId, t.date, t.kind] }),
    foreignKey({ columns: [t.workspaceId, t.specialistId], foreignColumns: [members.workspaceId, members.id], name: 'appointment_day_alerts_member_fk' }).onDelete('cascade'),
  ],
);
