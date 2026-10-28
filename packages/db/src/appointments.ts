/* Запись клиентов на приём (задача 1171), раздел docs/architecture/appointments.md: график специалиста и исключения, записи с проверкой
   слотов и пересечений, сетки дня и недели, поиск свободного времени, документ «Оказанные услуги за день» (тип service_day) с проведением,
   контроль незакрытых дней и напоминания воркера. Правила слотов — чистые функции @gr8r/shared/appointments. */
import { resolveOne } from './pricing';
import { and, asc, eq, gte, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm';
import {
  addDaysIso,
  APPOINTMENT_TRANSITIONS,
  checkPlacement,
  dec,
  findNearestFree,
  fmt,
  mul,
  OCCUPYING_STATUSES,
  slotsNeeded,
  wallClock,
  workingSlots,
  minToHm,
  type AppointmentStatus,
  type FreeCandidate,
  type FreeSlot,
  type ScheduleDef,
  productFitsSpecialist,
  specialistProductKindIds,
} from '@gr8r/shared';
import type { Db } from './client';
import { DOCUMENT_HOOKS } from './document-hooks';
import { createDocument, deleteDocument, postDocument, unpostDocument, type DocCtx } from './documents';
import { DomainError } from './errors';
import { recordEvent } from './events';
import { workspaceTimeZone } from './planning';
import { loadPositionContext, memberIdsWithFunction, specialistKinds } from './positions';
import {
  appointmentDayAlerts,
  appointmentReminders,
  appointments,
  companies,
  contacts,
  crmActivities,
  documents,
  members,
  notifications,
  products,
  serviceDayDocs,
  serviceDayLines,
  serviceDaySales,
  specialistScheduleExceptions,
  specialistSchedules,
  workspaceHolidays,
} from './schema';


/* ---------------- график специалиста ---------------- */

export interface ScheduleInput {
  slotMinutes: number;
  dayStartMin: number;
  dayEndMin: number;
  week: Record<string, number[]>;
}

export async function loadSchedule(db: Db, memberId: string, lock = false) {
  const q = db.select().from(specialistSchedules).where(eq(specialistSchedules.memberId, memberId)).limit(1);
  const [row] = lock ? await q.for('update') : await q;
  return row ?? null;
}
const defOf = (r: { slotMinutes: number; dayStartMin: number; dayEndMin: number; week: Record<string, number[]> }): ScheduleDef => ({ slotMinutes: r.slotMinutes, dayStartMin: r.dayStartMin, dayEndMin: r.dayEndMin, week: r.week });

async function assertMember(db: Db, memberId: string) {
  const [m] = await db.select({ id: members.id, name: members.name, status: members.status }).from(members).where(eq(members.id, memberId)).limit(1);
  if (!m || m.status === 'deactivated') throw new DomainError(422, 'invalid_reference', 'The specialist does not exist');
  return m;
}

/** Сохраняет график целиком; будущие активные записи, выпавшие из новой сетки, график менять не дают (409) */
export async function saveSchedule(db: Db, ctx: DocCtx, memberId: string, input: ScheduleInput): Promise<void> {
  await assertMember(db, memberId);
  const week: Record<string, number[]> = {};
  for (const [d, slots] of Object.entries(input.week)) week[d] = [...new Set(slots)].sort((a, b) => a - b);
  const prev = await loadSchedule(db, memberId, true);
  if (prev) {
    const next: ScheduleDef = { ...input, week };
    const tz = await workspaceTimeZone(db, ctx.workspaceId);
    const today = wallClock(new Date(), tz).toISOString().slice(0, 10);
    const future = await db
      .select({ id: appointments.id, date: appointments.date, startMin: appointments.startMin, slots: appointments.slots, slotMinutes: appointments.slotMinutes })
      .from(appointments)
      .where(and(eq(appointments.specialistId, memberId), gte(appointments.date, today), inArray(appointments.status, OCCUPYING_STATUSES)));
    if (future.length) {
      const exceptions = await exceptionsOf(db, memberId);
      const holidays = await holidaysOf(db, ctx.workspaceId);
      for (const a of future) {
        const working = workingSlots(next, a.date, exceptions, holidays);
        if (checkPlacement({ working, slotMinutes: a.slotMinutes, startMin: a.startMin, slots: a.slots, busy: [] }) !== null || a.slotMinutes !== input.slotMinutes)
          throw new DomainError(409, 'schedule_has_appointments', `The schedule change conflicts with the appointment on ${a.date} at ${minToHm(a.startMin)}: move or cancel it first`, { appointmentId: a.id });
      }
    }
    await db.update(specialistSchedules).set({ ...input, week, updatedAt: new Date() }).where(eq(specialistSchedules.id, prev.id));
  } else {
    await db.insert(specialistSchedules).values({ workspaceId: ctx.workspaceId, memberId, ...input, week });
  }
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'specialist_schedule.updated', entity: 'specialist_schedule', recordId: memberId, actorId: ctx.memberId, payload: { memberId } });
}

async function exceptionsOf(db: Db, memberId: string, from?: string, to?: string) {
  const conds = [eq(specialistScheduleExceptions.memberId, memberId)];
  if (from) conds.push(gte(specialistScheduleExceptions.date, from));
  if (to) conds.push(lte(specialistScheduleExceptions.date, to));
  return db.select({ date: specialistScheduleExceptions.date, slots: specialistScheduleExceptions.slots, note: specialistScheduleExceptions.note }).from(specialistScheduleExceptions).where(and(...conds)).orderBy(asc(specialistScheduleExceptions.date));
}
async function holidaysOf(db: Db, ws: string): Promise<string[]> {
  return (await db.select({ date: workspaceHolidays.date }).from(workspaceHolidays).where(eq(workspaceHolidays.workspaceId, ws))).map(h => h.date);
}

/** Исключение на дату: выходной (slots = null) или свой набор слотов; запись на этот день не должна ломаться */
export async function saveScheduleException(db: Db, ctx: DocCtx, memberId: string, date: string, input: { slots: number[] | null; note?: string }): Promise<void> {
  const sch = await loadSchedule(db, memberId, true);
  if (!sch) throw new DomainError(422, 'no_schedule', 'The specialist has no schedule yet');
  const slots = input.slots ? [...new Set(input.slots)].sort((a, b) => a - b) : null;
  const def = defOf(sch);
  const work = workingSlots({ ...def, week: {} }, date, [{ date, slots }], []);
  if (slots && work.length !== slots.length) throw new DomainError(422, 'invalid_slots', 'Some slots do not lie on the schedule grid');
  const busy = await db.select().from(appointments).where(and(eq(appointments.specialistId, memberId), eq(appointments.date, date), inArray(appointments.status, OCCUPYING_STATUSES)));
  for (const a of busy) {
    if (checkPlacement({ working: work, slotMinutes: a.slotMinutes, startMin: a.startMin, slots: a.slots, busy: [] }) !== null)
      throw new DomainError(409, 'schedule_has_appointments', `The exception conflicts with the appointment at ${minToHm(a.startMin)}: move or cancel it first`, { appointmentId: a.id });
  }
  await db
    .insert(specialistScheduleExceptions)
    .values({ workspaceId: ctx.workspaceId, memberId, date, slots, note: input.note ?? '' })
    .onConflictDoUpdate({ target: [specialistScheduleExceptions.workspaceId, specialistScheduleExceptions.memberId, specialistScheduleExceptions.date], set: { slots, note: input.note ?? '' } });
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'specialist_schedule.updated', entity: 'specialist_schedule', recordId: memberId, actorId: ctx.memberId, payload: { memberId, date } });
}

export async function deleteScheduleException(db: Db, ctx: DocCtx, memberId: string, date: string): Promise<void> {
  await db.delete(specialistScheduleExceptions).where(and(eq(specialistScheduleExceptions.memberId, memberId), eq(specialistScheduleExceptions.date, date)));
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'specialist_schedule.updated', entity: 'specialist_schedule', recordId: memberId, actorId: ctx.memberId, payload: { memberId, date } });
}

/** Специалисты: участники с графиком и функцией «специалист записи» (нет таких должностей в воркспейсе — все с графиком).
    productKindIds — оказываемые виды номенклатуры (null — любые услуги, задача 1172) */
export async function listSpecialists(db: Db) {
  const ids = await memberIdsWithFunction(db, 'appointments_specialist');
  const cx = await loadPositionContext(db);
  const rows = await db
    .select({ memberId: members.id, name: members.name, color: members.color, title: members.title, slotMinutes: specialistSchedules.slotMinutes, dayStartMin: specialistSchedules.dayStartMin, dayEndMin: specialistSchedules.dayEndMin })
    .from(specialistSchedules)
    .innerJoin(members, eq(members.id, specialistSchedules.memberId))
    .where(ne(members.status, 'deactivated'))
    .orderBy(asc(members.name));
  return rows.filter(r => !ids || ids.has(r.memberId)).map(r => ({ ...r, productKindIds: specialistProductKindIds(r.memberId, cx.positions, cx.links) }));
}

/** Специалист оказывает услугу: её вид входит в виды его должностей (виды не заданы — любая услуга) */
async function assertSpecialistProvides(db: Db, specialistId: string, productId: string): Promise<void> {
  const allowed = await specialistKinds(db, specialistId);
  if (allowed === null) return;
  const [p] = await db.select({ kindId: products.productKindId }).from(products).where(eq(products.id, productId)).limit(1);
  if (!productFitsSpecialist(p?.kindId, allowed)) throw new DomainError(422, 'service_not_provided', 'The specialist does not provide this service');
}

export async function scheduleView(db: Db, ws: string, memberId: string) {
  const m = await assertMember(db, memberId);
  const sch = await loadSchedule(db, memberId);
  const exceptions = await exceptionsOf(db, memberId, addDaysIso(new Date().toISOString().slice(0, 10), -31));
  return { memberId, name: m.name, schedule: sch ? { ...defOf(sch) } : null, exceptions, holidays: await holidaysOf(db, ws) };
}

/* ---------------- занятость и сетки ---------------- */

async function dayContext(db: Db, ws: string, memberId: string, dates: string[]) {
  const sch = await loadSchedule(db, memberId);
  if (!sch) return null;
  const def = defOf(sch);
  const exceptions = await exceptionsOf(db, memberId, dates[0], dates[dates.length - 1]);
  const holidays = await holidaysOf(db, ws);
  return { def, exceptions, holidays, working: (date: string) => workingSlots(def, date, exceptions, holidays) };
}

const apptSelect = {
  id: appointments.id,
  specialistId: appointments.specialistId,
  contactId: appointments.contactId,
  companyId: appointments.companyId,
  productId: appointments.productId,
  date: appointments.date,
  startMin: appointments.startMin,
  slots: appointments.slots,
  slotMinutes: appointments.slotMinutes,
  status: appointments.status,
  cancelReason: appointments.cancelReason,
  price: appointments.price,
  comment: appointments.comment,
  dayLineId: appointments.dayLineId,
  contactName: contacts.name,
  contactPhone: contacts.phone,
  companyName: companies.name,
  productName: products.name,
  specialistName: members.name,
};
export type AppointmentView = {
  id: string;
  specialistId: string;
  contactId: string | null;
  companyId: string | null;
  productId: string;
  date: string;
  startMin: number;
  slots: number;
  slotMinutes: number;
  status: AppointmentStatus;
  cancelReason: string | null;
  price: string;
  comment: string;
  dayLineId: string | null;
  contactName: string | null;
  contactPhone: string | null;
  companyName: string | null;
  productName: string | null;
  specialistName: string | null;
  endMin: number;
  clientName: string;
};

function view<T extends { status: string; startMin: number; slots: number; slotMinutes: number; contactName: string | null; companyName: string | null }>(r: T) {
  return { ...r, status: r.status as AppointmentStatus, endMin: r.startMin + r.slots * r.slotMinutes, clientName: r.contactName ?? r.companyName ?? '' };
}
function baseQuery(db: Db) {
  return db
    .select(apptSelect)
    .from(appointments)
    .leftJoin(contacts, eq(contacts.id, appointments.contactId))
    .leftJoin(companies, eq(companies.id, appointments.companyId))
    .leftJoin(products, eq(products.id, appointments.productId))
    .leftJoin(members, eq(members.id, appointments.specialistId));
}

export async function appointmentDetail(db: Db, id: string): Promise<AppointmentView> {
  const [r] = await baseQuery(db).where(eq(appointments.id, id)).limit(1);
  if (!r) throw new DomainError(404, 'not_found', 'Appointment not found');
  return view(r) as AppointmentView;
}

async function busyOf(db: Db, memberId: string, date: string, excludeId?: string) {
  const rows = await db
    .select({ id: appointments.id, startMin: appointments.startMin, slots: appointments.slots, slotMinutes: appointments.slotMinutes })
    .from(appointments)
    .where(and(eq(appointments.specialistId, memberId), eq(appointments.date, date), inArray(appointments.status, OCCUPYING_STATUSES)));
  return rows.filter(r => r.id !== excludeId).map(r => ({ startMin: r.startMin, endMin: r.startMin + r.slots * r.slotMinutes }));
}

/** Незакрытая запись: пришёл, а строки проведённого документа дня у неё нет */
async function unclosedSet(db: Db, specialistIds: string[], from: string, to: string): Promise<Set<string>> {
  if (!specialistIds.length) return new Set();
  const rows = await db
    .select({ s: appointments.specialistId, d: appointments.date, docStatus: documents.status })
    .from(appointments)
    .leftJoin(serviceDayLines, eq(serviceDayLines.id, appointments.dayLineId))
    .leftJoin(documents, eq(documents.id, serviceDayLines.documentId))
    .where(and(inArray(appointments.specialistId, specialistIds), eq(appointments.status, 'came'), gte(appointments.date, from), lte(appointments.date, to)));
  return new Set(rows.filter(r => r.docStatus !== 'posted').map(r => `${r.s}|${r.d}`));
}

export interface DayColumn {
  specialistId: string;
  date: string;
  working: number[];
  slotMinutes: number;
  dayStartMin: number;
  dayEndMin: number;
  holiday: boolean;
  unclosed: boolean;
  appointments: AppointmentView[];
}

/** Сетка дней специалиста: рабочие слоты, записи и признак незакрытого дня */
async function columnsOf(db: Db, ws: string, specialistId: string, dates: string[]): Promise<DayColumn[]> {
  const cx = await dayContext(db, ws, specialistId, dates);
  if (!cx) return [];
  const from = dates[0]!;
  const to = dates[dates.length - 1]!;
  const rows = await baseQuery(db).where(and(eq(appointments.specialistId, specialistId), gte(appointments.date, from), lte(appointments.date, to))).orderBy(asc(appointments.startMin));
  const unclosed = await unclosedSet(db, [specialistId], from, to);
  return dates.map(date => ({
    specialistId,
    date,
    working: cx.working(date),
    slotMinutes: cx.def.slotMinutes,
    dayStartMin: cx.def.dayStartMin,
    dayEndMin: cx.def.dayEndMin,
    holiday: cx.holidays.includes(date),
    unclosed: unclosed.has(`${specialistId}|${date}`),
    appointments: rows.filter(r => r.date === date).map(r => view(r) as AppointmentView),
  }));
}

/** Сетка дня всех специалистов: колонки — специалисты */
export async function dayBoard(db: Db, ws: string, date: string) {
  const specs = await listSpecialists(db);
  const columns: (DayColumn & { name: string; color: string })[] = [];
  for (const s of specs) {
    const [col] = await columnsOf(db, ws, s.memberId, [date]);
    if (col) columns.push({ ...col, name: s.name, color: s.color });
  }
  return { date, columns };
}

/** Неделя специалиста (7 дней с понедельника `from`) */
export async function weekBoard(db: Db, ws: string, specialistId: string, from: string) {
  const m = await assertMember(db, specialistId);
  const dates = Array.from({ length: 7 }, (_, i) => addDaysIso(from, i));
  return { specialistId, name: m.name, from, days: await columnsOf(db, ws, specialistId, dates) };
}

export async function listAppointments(db: Db, f: { specialistId?: string | undefined; contactId?: string | undefined; companyId?: string | undefined; status?: string | undefined; from?: string | undefined; to?: string | undefined; limit: number; offset: number }) {
  const conds = [];
  if (f.specialistId) conds.push(eq(appointments.specialistId, f.specialistId));
  // у компании видны и записи её контактов
  if (f.companyId) conds.push(or(eq(appointments.companyId, f.companyId), inArray(appointments.contactId, db.select({ id: contacts.id }).from(contacts).where(eq(contacts.companyId, f.companyId))))!);
  if (f.contactId) conds.push(eq(appointments.contactId, f.contactId));
  if (f.status) conds.push(eq(appointments.status, f.status as AppointmentStatus));
  if (f.from) conds.push(gte(appointments.date, f.from));
  if (f.to) conds.push(lte(appointments.date, f.to));
  const rows = await baseQuery(db).where(conds.length ? and(...conds) : undefined).orderBy(asc(appointments.date), asc(appointments.startMin)).limit(f.limit).offset(f.offset);
  return { items: rows.map(r => view(r) as AppointmentView) };
}

/* ---------------- запись ---------------- */

async function loadClient(db: Db, contactId?: string | null, companyId?: string | null): Promise<void> {
  if (contactId) {
    const [c] = await db.select({ id: contacts.id }).from(contacts).where(and(eq(contacts.id, contactId), isNull(contacts.archivedAt))).limit(1);
    if (!c) throw new DomainError(422, 'invalid_reference', 'The contact does not exist');
  }
  if (companyId) {
    const [c] = await db.select({ id: companies.id }).from(companies).where(and(eq(companies.id, companyId), isNull(companies.archivedAt))).limit(1);
    if (!c) throw new DomainError(422, 'invalid_reference', 'The company does not exist');
  }
}

/** Физлицо с телефоном: создаётся прямо в диалоге записи */
export async function createAppointmentClient(db: Db, ctx: DocCtx, input: { name: string; phone: string }): Promise<{ id: string }> {
  const [row] = await db.insert(contacts).values({ workspaceId: ctx.workspaceId, name: input.name, phone: input.phone, ownerId: ctx.memberId }).returning({ id: contacts.id });
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'contact.created', entity: 'contact', recordId: row!.id, actorId: ctx.memberId, payload: { record: { id: row!.id, name: input.name } } });
  return row!;
}

interface Placement {
  specialistId: string;
  date: string;
  startMin: number;
  productId: string;
  excludeId?: string;
}
/** Проверка размещения под блокировкой графика специалиста: вне рабочих слотов — 422, пересечение — 409 */
async function placeOrThrow(db: Db, ws: string, p: Placement): Promise<{ slots: number; slotMinutes: number }> {
  const sch = await loadSchedule(db, p.specialistId, true);
  if (!sch) throw new DomainError(422, 'no_schedule', 'The specialist has no schedule');
  const [prod] = await db.select({ minutes: products.appointmentMinutes }).from(products).where(eq(products.id, p.productId)).limit(1);
  const def = defOf(sch);
  const slots = slotsNeeded(prod?.minutes, def.slotMinutes);
  const working = workingSlots(def, p.date, await exceptionsOf(db, p.specialistId, p.date, p.date), await holidaysOf(db, ws));
  const busy = await busyOf(db, p.specialistId, p.date, p.excludeId);
  const err = checkPlacement({ working, slotMinutes: def.slotMinutes, startMin: p.startMin, slots, busy });
  if (err === 'outside_slots') throw new DomainError(422, 'outside_working_slots', 'The appointment does not fit into the working slots of the specialist');
  if (err === 'overlap') throw new DomainError(409, 'slot_taken', 'The specialist is already busy at this time');
  return { slots, slotMinutes: def.slotMinutes };
}

export interface AppointmentInput {
  specialistId: string;
  contactId?: string | null | undefined;
  companyId?: string | null | undefined;
  productId: string;
  date: string;
  startMin: number;
  price?: string | undefined;
  comment?: string | undefined;
}

export async function createAppointment(db: Db, ctx: DocCtx, input: AppointmentInput): Promise<string> {
  await assertMember(db, input.specialistId);
  await loadClient(db, input.contactId, input.companyId);
  const [prod] = await db.select({ price: products.price, kind: products.kind, isActive: products.isActive }).from(products).where(eq(products.id, input.productId)).limit(1);
  if (!prod || prod.kind !== 'service' || !prod.isActive) throw new DomainError(422, 'invalid_reference', 'Select an active service from the catalog');
  await assertSpecialistProvides(db, input.specialistId, input.productId);
  const { slots, slotMinutes } = await placeOrThrow(db, ctx.workspaceId, input);
  const [row] = await db
    .insert(appointments)
    .values({
      workspaceId: ctx.workspaceId,
      specialistId: input.specialistId,
      contactId: input.contactId ?? null,
      companyId: input.companyId ?? null,
      productId: input.productId,
      date: input.date,
      startMin: input.startMin,
      slots,
      slotMinutes,
      // цена по виду цен клиента на дату записи (задача 1178), без вида — розничная
      price: input.price ?? (await resolveOne(db, ctx.workspaceId, input.productId, { party: 'customer', counterpartyId: input.companyId ?? null }, input.date)) ?? prod.price,
      comment: input.comment ?? '',
      createdBy: ctx.memberId,
    })
    .returning({ id: appointments.id });
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'appointment.created', entity: 'appointment', recordId: row!.id, actorId: ctx.memberId, payload: { record: { id: row!.id, specialistId: input.specialistId, date: input.date, startMin: input.startMin } } });
  return row!.id;
}

async function loadAppt(db: Db, id: string, lock = true) {
  const q = db.select().from(appointments).where(eq(appointments.id, id)).limit(1);
  const [a] = lock ? await q.for('update') : await q;
  if (!a) throw new DomainError(404, 'not_found', 'Appointment not found');
  return a;
}

export async function updateAppointment(db: Db, ctx: DocCtx, id: string, patch: { comment?: string | undefined; price?: string | undefined }): Promise<void> {
  const a = await loadAppt(db, id);
  if (a.dayLineId && patch.price !== undefined) throw new DomainError(409, 'appointment_in_day_document', 'The appointment is already in a document of the day: change the price there');
  await db.update(appointments).set({ ...(patch.comment !== undefined ? { comment: patch.comment } : {}), ...(patch.price !== undefined ? { price: patch.price } : {}), updatedAt: new Date() }).where(eq(appointments.id, id));
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'appointment.updated', entity: 'appointment', recordId: id, actorId: ctx.memberId, payload: { changes: Object.keys(patch) } });
}

/** Смена статуса: booked → confirmed → came | no_show | cancelled; отмена — с причиной */
export async function setAppointmentStatus(db: Db, ctx: DocCtx, id: string, to: AppointmentStatus, reason?: string): Promise<void> {
  const a = await loadAppt(db, id);
  if (!APPOINTMENT_TRANSITIONS[a.status as AppointmentStatus].includes(to)) throw new DomainError(409, 'invalid_status', `The appointment cannot move from "${a.status}" to "${to}"`);
  if (to === 'cancelled' && !reason?.trim()) throw new DomainError(422, 'cancel_reason_required', 'Enter the reason for cancelling the appointment');
  await db.update(appointments).set({ status: to, cancelReason: to === 'cancelled' ? reason!.trim() : null, updatedAt: new Date() }).where(eq(appointments.id, id));
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'appointment.updated', entity: 'appointment', recordId: id, actorId: ctx.memberId, payload: { changes: { status: { from: a.status, to } } } });
}

/** Перенос на другой слот или к другому специалисту: проверки те же, свою запись пересечением не считаем */
export async function moveAppointment(db: Db, ctx: DocCtx, id: string, to: { specialistId?: string | undefined; date: string; startMin: number }): Promise<void> {
  const a = await loadAppt(db, id);
  if (a.status !== 'booked' && a.status !== 'confirmed') throw new DomainError(409, 'invalid_status', 'Only a booked or confirmed appointment can be moved');
  const specialistId = to.specialistId ?? a.specialistId;
  if (specialistId !== a.specialistId) {
    await assertMember(db, specialistId);
    await assertSpecialistProvides(db, specialistId, a.productId);
  }
  const { slots, slotMinutes } = await placeOrThrow(db, ctx.workspaceId, { specialistId, date: to.date, startMin: to.startMin, productId: a.productId, excludeId: id });
  await db.update(appointments).set({ specialistId, date: to.date, startMin: to.startMin, slots, slotMinutes, updatedAt: new Date() }).where(eq(appointments.id, id));
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'appointment.updated', entity: 'appointment', recordId: id, actorId: ctx.memberId, payload: { changes: { date: { from: a.date, to: to.date }, startMin: { from: a.startMin, to: to.startMin } } } });
}

/** Ближайшее свободное время под услугу у выбранного или любого специалиста (горизонт 60 дней) */
export async function findFreeTime(db: Db, ws: string, q: { productId: string; specialistId?: string | undefined; from?: string | undefined; fromMin?: number | undefined }, today: string): Promise<(FreeSlot & { specialistName: string }) | null> {
  const [prod] = await db.select({ minutes: products.appointmentMinutes }).from(products).where(eq(products.id, q.productId)).limit(1);
  if (!prod) throw new DomainError(422, 'invalid_reference', 'The service does not exist');
  const [fp] = await db.select({ kindId: products.productKindId }).from(products).where(eq(products.id, q.productId)).limit(1);
  const specs = (await listSpecialists(db)).filter(s => (!q.specialistId || s.memberId === q.specialistId) && productFitsSpecialist(fp?.kindId, s.productKindIds));
  const from = q.from ?? today;
  const dates = Array.from({ length: 60 }, (_, i) => addDaysIso(from, i));
  const candidates: FreeCandidate[] = [];
  for (const s of specs) {
    const cx = await dayContext(db, ws, s.memberId, dates);
    if (!cx) continue;
    const busyRows = await db
      .select({ date: appointments.date, startMin: appointments.startMin, slots: appointments.slots, slotMinutes: appointments.slotMinutes })
      .from(appointments)
      .where(and(eq(appointments.specialistId, s.memberId), gte(appointments.date, from), lte(appointments.date, dates[59]!), inArray(appointments.status, OCCUPYING_STATUSES)));
    for (const date of dates) {
      const working = cx.working(date);
      if (!working.length) continue;
      candidates.push({ memberId: s.memberId, date, def: cx.def, working, busy: busyRows.filter(b => b.date === date).map(b => ({ startMin: b.startMin, endMin: b.startMin + b.slots * b.slotMinutes })) });
    }
  }
  const found = findNearestFree(candidates, prod.minutes, { date: from, startMin: q.fromMin ?? 0 });
  return found ? { ...found, specialistName: specs.find(s => s.memberId === found.memberId)?.name ?? '' } : null;
}

/* ---------------- клиент документа ---------------- */

/** Покупатель продажи: компания записи, компания контакта, иначе физлицо создаётся компанией вида «individual» и привязывается к контакту */
async function saleCompanyOf(db: Db, ctx: DocCtx, a: { contactId: string | null; companyId: string | null }): Promise<string> {
  if (a.companyId) return a.companyId;
  const [c] = await db.select().from(contacts).where(eq(contacts.id, a.contactId!)).limit(1);
  if (!c) throw new DomainError(422, 'invalid_reference', 'The contact does not exist');
  if (c.companyId) return c.companyId;
  const [co] = await db.insert(companies).values({ workspaceId: ctx.workspaceId, name: c.name, kind: 'individual', ownerId: c.ownerId }).returning({ id: companies.id });
  await db.update(contacts).set({ companyId: co!.id, updatedAt: new Date() }).where(eq(contacts.id, c.id));
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'company.created', entity: 'company', recordId: co!.id, actorId: ctx.memberId, payload: { record: { id: co!.id, name: c.name }, via: 'appointment' } });
  return co!.id;
}

/* ---------------- документ «Оказанные услуги за день» ---------------- */

export interface ServiceDayLineInput {
  id?: string | undefined;
  companyId: string;
  contactId?: string | null | undefined;
  productId: string;
  startMin?: number | null | undefined;
  qty: string;
  price: string;
}

async function loadDay(db: Db, id: string, lock = false) {
  const q = db.select({ doc: documents, header: serviceDayDocs }).from(documents).innerJoin(serviceDayDocs, eq(serviceDayDocs.documentId, documents.id)).where(eq(documents.id, id)).limit(1);
  const [r] = lock ? await q.for('update', { of: documents }) : await q;
  if (!r) throw new DomainError(404, 'not_found', 'Document of the day not found');
  return r;
}

async function updateTotal(db: Db, docId: string): Promise<void> {
  const [row] = await db.select({ amount: sql<string>`coalesce(sum(${serviceDayLines.amount}), 0)` }).from(serviceDayLines).where(eq(serviceDayLines.documentId, docId));
  const total = fmt(dec(row?.amount ?? '0'), 2);
  await db.update(documents).set({ total, amountNet: total, vatTotal: '0.00', updatedAt: new Date() }).where(eq(documents.id, docId));
}

/** Документ дня специалиста: один на специалиста и дату; создаётся черновик и заполняется записями «пришёл» */
export async function createServiceDay(db: Db, ctx: DocCtx, input: { specialistId: string; date: string; comment?: string | undefined }): Promise<string> {
  await assertMember(db, input.specialistId);
  await db.execute(sql`select pg_advisory_xact_lock(hashtext(${`service_day|${input.specialistId}|${input.date}`}))`);
  const [dup] = await db
    .select({ id: documents.id })
    .from(documents)
    .innerJoin(serviceDayDocs, eq(serviceDayDocs.documentId, documents.id))
    .where(and(eq(serviceDayDocs.specialistId, input.specialistId), eq(documents.date, input.date), ne(documents.status, 'cancelled')))
    .limit(1);
  if (dup) throw new DomainError(409, 'service_day_exists', 'A document of the day already exists for this specialist', { documentId: dup.id });
  const id = await createDocument(db, ctx, { type: 'service_day', date: input.date, comment: input.comment ?? '', responsibleId: input.specialistId, lines: [] });
  await db.insert(serviceDayDocs).values({ workspaceId: ctx.workspaceId, documentId: id, specialistId: input.specialistId });
  await fillServiceDay(db, ctx, id);
  return id;
}

/** «Заполнить»: записи специалиста за дату со статусом «пришёл», ещё не попавшие в строки, добавляются строками */
export async function fillServiceDay(db: Db, ctx: DocCtx, id: string): Promise<number> {
  const { doc, header } = await loadDay(db, id, true);
  if (doc.status !== 'draft') throw new DomainError(409, 'not_draft', 'A posted document cannot be edited: unpost it first');
  const appts = await db
    .select()
    .from(appointments)
    .where(and(eq(appointments.specialistId, header.specialistId), eq(appointments.date, doc.date), eq(appointments.status, 'came')))
    .orderBy(asc(appointments.startMin));
  const fresh = appts.filter(a => !a.dayLineId);
  const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(serviceDayLines).where(eq(serviceDayLines.documentId, id));
  let i = Number(n);
  for (const a of fresh) {
    const companyId = await saleCompanyOf(db, ctx, a);
    const [line] = await db
      .insert(serviceDayLines)
      .values({ workspaceId: ctx.workspaceId, documentId: id, companyId, contactId: a.contactId, productId: a.productId, startMin: a.startMin, qty: '1', price: a.price, amount: a.price, sortOrder: i++ })
      .returning({ id: serviceDayLines.id });
    await db.update(appointments).set({ dayLineId: line!.id, updatedAt: new Date() }).where(eq(appointments.id, a.id));
  }
  await updateTotal(db, id);
  return fresh.length;
}

/** Правка черновика: строки заменяются списком (запись, чья строка удалена, снова «незакрытая») */
export async function updateServiceDay(db: Db, ctx: DocCtx, id: string, patch: { comment?: string | undefined; lines?: ServiceDayLineInput[] | undefined }): Promise<void> {
  const { doc } = await loadDay(db, id, true);
  if (doc.status !== 'draft') throw new DomainError(409, 'not_draft', 'A posted document cannot be edited: unpost it first');
  if (patch.comment !== undefined) await db.update(documents).set({ comment: patch.comment, updatedAt: new Date() }).where(eq(documents.id, id));
  if (patch.lines) {
    const existing = await db.select({ id: serviceDayLines.id }).from(serviceDayLines).where(eq(serviceDayLines.documentId, id));
    const keep = new Set(patch.lines.map(l => l.id).filter((x): x is string => !!x));
    for (const e of existing) if (!keep.has(e.id)) await db.delete(serviceDayLines).where(eq(serviceDayLines.id, e.id));
    for (const [i, l] of patch.lines.entries()) {
      if (dec(l.qty) <= 0n) throw new DomainError(422, 'invalid_qty', 'The quantity must be greater than zero');
      const [p] = await db.select({ id: products.id }).from(products).where(eq(products.id, l.productId)).limit(1);
      if (!p) throw new DomainError(422, 'invalid_reference', 'The product does not exist');
      const values = { companyId: l.companyId, contactId: l.contactId ?? null, productId: l.productId, startMin: l.startMin ?? null, qty: l.qty, price: l.price, amount: fmt(mul(dec(l.qty), dec(l.price)), 2), sortOrder: i };
      if (l.id && keep.has(l.id) && existing.some(e => e.id === l.id)) await db.update(serviceDayLines).set(values).where(eq(serviceDayLines.id, l.id));
      else await db.insert(serviceDayLines).values({ workspaceId: ctx.workspaceId, documentId: id, ...(l.id ? { id: l.id } : {}), ...values });
    }
    await updateTotal(db, id);
  }
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'document.updated', entity: 'document', recordId: id, actorId: ctx.memberId, payload: { changes: Object.keys(patch) } });
}

export async function serviceDayDetail(db: Db, id: string) {
  const { doc, header } = await loadDay(db, id);
  const lines = await db
    .select({ line: serviceDayLines, productName: products.name, companyName: companies.name, contactName: contacts.name })
    .from(serviceDayLines)
    .leftJoin(products, eq(products.id, serviceDayLines.productId))
    .leftJoin(companies, eq(companies.id, serviceDayLines.companyId))
    .leftJoin(contacts, eq(contacts.id, serviceDayLines.contactId))
    .where(eq(serviceDayLines.documentId, id))
    .orderBy(asc(serviceDayLines.sortOrder));
  const [spec] = await db.select({ name: members.name }).from(members).where(eq(members.id, header.specialistId)).limit(1);
  const sales = await db.select({ id: documents.id, number: documents.number, type: documents.type, total: documents.total, counterpartyId: documents.counterpartyId }).from(serviceDaySales).innerJoin(documents, eq(documents.id, serviceDaySales.saleDocumentId)).where(eq(serviceDaySales.dayDocumentId, id));
  return {
    id: doc.id,
    number: doc.number,
    date: doc.date,
    status: doc.status,
    comment: doc.comment,
    total: doc.total,
    specialistId: header.specialistId,
    specialistName: spec?.name ?? '',
    lines: lines.map(l => ({ ...l.line, productName: l.productName ?? '', companyName: l.companyName ?? '', contactName: l.contactName })),
    sales,
  };
}

/** Дни с записями «пришёл» без проведённого документа дня */
export async function unclosedDays(db: Db, ws: string, specialistId?: string) {
  const rows = await db
    .select({ s: appointments.specialistId, d: appointments.date, docStatus: documents.status, docId: serviceDayLines.documentId, amount: appointments.price })
    .from(appointments)
    .leftJoin(serviceDayLines, eq(serviceDayLines.id, appointments.dayLineId))
    .leftJoin(documents, eq(documents.id, serviceDayLines.documentId))
    .where(and(eq(appointments.workspaceId, ws), eq(appointments.status, 'came'), specialistId ? eq(appointments.specialistId, specialistId) : undefined));
  const groups = new Map<string, { specialistId: string; date: string; count: number; documentId: string | null }>();
  for (const r of rows) {
    if (r.docStatus === 'posted') continue;
    const k = `${r.s}|${r.d}`;
    const g = groups.get(k) ?? { specialistId: r.s, date: r.d, count: 0, documentId: null };
    g.count++;
    g.documentId = g.documentId ?? r.docId ?? null;
    groups.set(k, g);
  }
  const names = new Map((await db.select({ id: members.id, name: members.name }).from(members).where(eq(members.workspaceId, ws))).map(m => [m.id, m.name]));
  return [...groups.values()].sort((a, b) => (a.date < b.date ? 1 : -1)).map(g => ({ ...g, specialistName: names.get(g.specialistId) ?? '' }));
}

/** Проведение документа дня = продажа по каждому клиенту строк: акт (только услуги) или реализация (есть товары); проводятся общим postDocument */
DOCUMENT_HOOKS.service_day = {
  check: async (db, _ctx, doc) => {
    const lines = await db.select({ id: serviceDayLines.id }).from(serviceDayLines).where(eq(serviceDayLines.documentId, doc.id));
    if (!lines.length) throw new DomainError(422, 'no_lines', 'Add at least one line to the document of the day');
  },
  post: async (db, ctx, doc) => {
    const lines = await db.select().from(serviceDayLines).where(eq(serviceDayLines.documentId, doc.id)).orderBy(asc(serviceDayLines.sortOrder));
    const kinds = new Map((await db.select({ id: products.id, kind: products.kind }).from(products).where(inArray(products.id, [...new Set(lines.map(l => l.productId))]))).map(p => [p.id, p.kind]));
    const byClient = new Map<string, typeof lines>();
    for (const l of lines) byClient.set(l.companyId, [...(byClient.get(l.companyId) ?? []), l]);
    for (const [companyId, ls] of byClient) {
      const hasGoods = ls.some(l => kinds.get(l.productId) === 'goods');
      const saleId = await createDocument(db, ctx, {
        type: hasGoods ? 'realization' : 'act',
        date: doc.date,
        organizationId: doc.organizationId,
        counterpartyId: companyId,
        responsibleId: doc.responsibleId,
        comment: `Оказанные услуги за день ${doc.date}`,
        lines: ls.map(l => ({ productId: l.productId, qty: l.qty, price: l.price, discountPct: '0' })),
      });
      await postDocument(db, ctx, saleId);
      await db.insert(serviceDaySales).values({ workspaceId: ctx.workspaceId, dayDocumentId: doc.id, saleDocumentId: saleId });
    }
  },
  /** Отмена проведения снимает и удаляет продажи, созданные проведением */
  afterUnpost: async (db, ctx, doc) => {
    const sales = await db.select({ id: serviceDaySales.saleDocumentId }).from(serviceDaySales).where(eq(serviceDaySales.dayDocumentId, doc.id));
    for (const s of sales) {
      const [d] = await db.select({ status: documents.status, numberSeq: documents.numberSeq }).from(documents).where(eq(documents.id, s.id)).limit(1);
      if (!d) continue;
      if (d.status === 'posted') await unpostDocument(db, ctx, s.id);
      // продажа с номером удалена быть не может: отменяем, чтобы она не учитывалась
      if (d.numberSeq === null) await deleteDocument(db, ctx, s.id);
      else await db.update(documents).set({ status: 'cancelled', updatedAt: new Date() }).where(eq(documents.id, s.id));
    }
    await db.delete(serviceDaySales).where(eq(serviceDaySales.dayDocumentId, doc.id));
  },
};

/* ---------------- воркер: напоминания и контроль ---------------- */

async function ownerId(db: Db, ws: string): Promise<string | null> {
  const [o] = await db.select({ id: members.id }).from(members).where(and(eq(members.workspaceId, ws), eq(members.role, 'owner'), ne(members.status, 'deactivated'))).orderBy(asc(members.createdAt)).limit(1);
  return o?.id ?? null;
}
async function notify(db: Db, ws: string, recipientId: string, text: string, snippet: string, via: string): Promise<void> {
  const [n] = await db.insert(notifications).values({ workspaceId: ws, recipientId, type: 'update', actorId: null, text, snippet }).returning({ id: notifications.id });
  await recordEvent(db, { workspaceId: ws, type: 'notification.created', entity: 'notification', recordId: n!.id, actorId: null, payload: { recipientId, via } });
}

/** Записи на завтра без подтверждения: дело «Подтвердите запись» ответственному клиента (иначе владельцу) — одно на запись.
    Журнал appointment_reminders (ключ — запись) делает проход идемпотентным. Возвращает число созданных дел */
export async function runAppointmentReminders(db: Db, ws: string, today: string): Promise<number> {
  const tomorrow = addDaysIso(today, 1);
  const due = await baseQuery(db).where(and(eq(appointments.workspaceId, ws), eq(appointments.date, tomorrow), eq(appointments.status, 'booked')));
  let created = 0;
  const wsOwner = await ownerId(db, ws);
  for (const a of due) {
    const [run] = await db.insert(appointmentReminders).values({ workspaceId: ws, appointmentId: a.id }).onConflictDoNothing().returning({ id: appointmentReminders.appointmentId });
    if (!run) continue;
    const [ct] = a.contactId ? await db.select({ ownerId: contacts.ownerId, companyId: contacts.companyId }).from(contacts).where(eq(contacts.id, a.contactId)).limit(1) : [];
    const companyId = a.companyId ?? ct?.companyId ?? null;
    const [co] = companyId ? await db.select({ ownerId: companies.ownerId }).from(companies).where(eq(companies.id, companyId)).limit(1) : [];
    const responsible = ct?.ownerId ?? co?.ownerId ?? wsOwner;
    const client = a.contactName ?? a.companyName ?? '';
    const subject = `Подтвердите запись: ${client}, ${tomorrow} ${minToHm(a.startMin)}`;
    const [act] = await db
      .insert(crmActivities)
      .values({ workspaceId: ws, type: 'task', subject, contactId: a.contactId, companyId, authorId: responsible, dueDate: today, done: false, body: `${a.productName ?? ''} — ${a.specialistName ?? ''}${a.contactPhone ? `, ${a.contactPhone}` : ''}` })
      .returning({ id: crmActivities.id });
    await db.update(appointmentReminders).set({ activityId: act!.id }).where(eq(appointmentReminders.appointmentId, a.id));
    await recordEvent(db, { workspaceId: ws, type: 'crm_activity.created', entity: 'crm_activity', recordId: act!.id, actorId: null, payload: { record: { id: act!.id, type: 'task', subject }, via: 'appointment' } });
    if (responsible) await notify(db, ws, responsible, subject, a.comment, 'appointment');
    created++;
  }
  return created;
}

/** Контроль незакрытых дней: вечером (с 20:00) — за сегодня, утром (с 08:00) — за прошедшие дни; специалисту и admin/owner,
    по одному уведомлению на (специалист, дата, вечер/утро) — журнал appointment_day_alerts. Возвращает число уведомлённых дней */
export async function runUnclosedDayAlerts(db: Db, ws: string, today: string, hour: number): Promise<number> {
  const list = await unclosedDays(db, ws);
  const admins = (await db.select({ id: members.id }).from(members).where(and(eq(members.workspaceId, ws), inArray(members.role, ['owner', 'admin']), ne(members.status, 'deactivated')))).map(m => m.id);
  let sent = 0;
  for (const u of list) {
    const kind = u.date === today ? (hour >= 20 ? 'evening' : null) : u.date < today && hour >= 8 ? 'morning' : null;
    if (!kind) continue;
    const [run] = await db.insert(appointmentDayAlerts).values({ workspaceId: ws, specialistId: u.specialistId, date: u.date, kind }).onConflictDoNothing().returning({ d: appointmentDayAlerts.date });
    if (!run) continue;
    const text = `Не закрыт день приёма ${u.date}: ${u.specialistName}, записей «пришёл» — ${u.count}`;
    for (const r of new Set([u.specialistId, ...admins])) await notify(db, ws, r, text, '', 'appointment_day');
    sent++;
  }
  return sent;
}

