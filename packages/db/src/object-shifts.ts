/* Табель прораба (задача 1271, docs/architecture/construction.md): смена бригады на объекте, часы с распределением
   по позициям сметы, сменный отчёт объёмов, стоимость часа из зарплаты и бейджи работников.
   Часы живут только здесь (time_logs не трогаем): смена черновик → подтверждена, при подтверждении стоимость часа
   и сумма каждой строки фиксируются снимком (cost_rate, cost_amount), объёмы прибавляются к done_qty позиций сметы.
   Правка и отмена подтверждения — только admin/owner с причиной и записью в журнал смены.
   Деньги видят owner/admin (canSeeCost); прораб ведёт только свои объекты (object_foremen).
   Всё в транзакции вызывающего; изменение + событие + журнал — в одной транзакции. */
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import {
  badgeCode,
  DEFAULT_CALENDAR,
  dateRange,
  dec,
  exceptionsFor,
  fmt,
  isWorkingDayWith,
  laborCostAmount,
  laborHourCost,
  monthNormHours,
  shortDaysTotal,
  normalizeBadgeCode,
  SHIFT_HOURS_MAX,
  type Role,
} from '@gr8r/shared';
import type { Db } from './client';
import { canSeeCost } from './cost';
import { DomainError } from './errors';
import { recordEvent } from './events';
import { assertObjectBudget } from './object-budget';
import { payrollSettings } from './payroll';
import { calendarContext } from './planning';
import {
  employeeAccruals,
  employeePayroll,
  members,
  objectEstimateItems,
  objectEstimates,
  objectForemen,
  objectShiftHours,
  objectShiftLog,
  objectShifts,
  objectShiftVolumes,
  objects,
  payrollKinds,
} from './schema';
import { uuidv7 } from './uuid';

export type ShiftRow = typeof objectShifts.$inferSelect;
export type ShiftHourRow = typeof objectShiftHours.$inferSelect;
export type ShiftVolumeRow = typeof objectShiftVolumes.$inferSelect;

/** Контекст записи смены: чей воркспейс, кто автор и его роль (роль решает права и видимость денег) */
export interface ShiftCtx {
  workspaceId: string;
  memberId: string;
  role?: Role;
}

export interface ShiftHourInput {
  memberId: string;
  hours: string;
  estimateItemId?: string | null | undefined;
  note?: string | undefined;
}

export interface ShiftVolumeInput {
  estimateItemId: string;
  qty: string;
}

export interface ShiftSaveInput {
  hours?: ShiftHourInput[] | undefined;
  volumes?: ShiftVolumeInput[] | undefined;
  note?: string | undefined;
  /** Причина правки — обязательна при изменении подтверждённой смены */
  reason?: string | undefined;
}

/* ---------------- представления ---------------- */

export interface ShiftHourView {
  id: string;
  memberId: string;
  memberName: string;
  personnelNumber: string | null;
  estimateItemId: string | null;
  estimateItemName: string | null;
  hours: string;
  /** Снимок стоимости часа; null — нет ни ставки, ни оклада (или нет права видеть суммы) */
  costRate: string | null;
  costAmount: string | null;
  note: string;
}

export interface ShiftVolumeView {
  id: string;
  estimateItemId: string;
  estimateItemName: string;
  unitCode: string;
  qty: string;
}

export interface ShiftLogView {
  id: string;
  at: string;
  authorId: string | null;
  authorName: string | null;
  action: string;
  reason: string;
  before: unknown;
  after: unknown;
}

export interface ShiftView {
  id: string;
  objectId: string;
  objectNumber: string;
  objectName: string;
  workDate: string;
  foremanId: string;
  foremanName: string;
  status: 'draft' | 'confirmed';
  confirmedBy: string | null;
  confirmedAt: string | null;
  note: string;
  hours: ShiftHourView[];
  volumes: ShiftVolumeView[];
  totalHours: string;
  /** Сумма смены: только owner/admin; null — нет права видеть деньги */
  totalAmount: string | null;
  /** Сколько строк часов без стоимости (нет ставки): пробел в прогнозе, не ноль */
  noRate: number;
  canSeeCost: boolean;
  /** Может ли текущий участник править и подтверждать: прораб объекта или admin/owner */
  canWrite: boolean;
  log: ShiftLogView[];
  createdAt: string;
  updatedAt: string;
}

export interface ShiftListItem {
  id: string;
  workDate: string;
  status: 'draft' | 'confirmed';
  foremanId: string;
  foremanName: string;
  note: string;
  totalHours: string;
  totalAmount: string | null;
  confirmedAt: string | null;
  employees: number;
  /** Работники без стоимости часа — пробел данных */
  noRate: number;
}

export interface ObjectTimesheet {
  objectId: string;
  from: string;
  to: string;
  /** Дни периода (по ним раскладываются часы) */
  days: string[];
  rows: {
    memberId: string;
    memberName: string;
    personnelNumber: string | null;
    /** Часы по дням, выровнены с days */
    hours: string[];
    total: string;
    /** Есть ли часы без стоимости (нет ставки) */
    noRate: boolean;
  }[];
  totalByDay: string[];
  total: string;
}

export interface ShiftOptions {
  objectId: string;
  members: { id: string; name: string; title: string; personnelNumber: string | null; badgeCode: string | null }[];
  /** Позиции сметы вида work — на них распределяются часы */
  workItems: { id: string; estimateId: string; estimateName: string; name: string; unitCode: string; qty: string; doneQty: string; laborHours: string }[];
  /** Все позиции сметы объекта — для сменного отчёта объёмов */
  volumeItems: { id: string; name: string; unitCode: string; qty: string; doneQty: string }[];
  /** Дата и прораб по умолчанию для новой смены */
  foremanId: string;
}

/* ---------------- вспомогательное ---------------- */

const sum = (xs: string[]): string => fmt(xs.reduce((s, x) => s + dec(x), 0n), 2);

/** Объект своего воркспейса и не в архиве: чужой и архивный — 404 (как GET /objects/:id) */
async function assertObject(db: Db, objectId: string): Promise<typeof objects.$inferSelect> {
  const [row] = await db.select().from(objects).where(eq(objects.id, objectId)).limit(1);
  if (!row || row.archivedAt) throw new DomainError(404, 'not_found', 'object not found');
  return row;
}

async function isForemanOf(db: Db, objectId: string, memberId: string): Promise<boolean> {
  const [row] = await db
    .select({ objectId: objectForemen.objectId })
    .from(objectForemen)
    .where(and(eq(objectForemen.objectId, objectId), eq(objectForemen.memberId, memberId)))
    .limit(1);
  return !!row;
}

const isAdmin = (role: Role | undefined): boolean => role === 'owner' || role === 'admin';

/** Прораб ведёт только свои объекты (object_foremen), admin/owner — любые */
async function assertCanLead(db: Db, ctx: ShiftCtx, objectId: string): Promise<void> {
  if (isAdmin(ctx.role)) return;
  if (!(await isForemanOf(db, objectId, ctx.memberId))) throw new DomainError(403, 'forbidden', 'The foreman does not lead this object');
}

/** Прораб, от имени которого можно вести смену: member — только сам и только на своём объекте */
async function resolveForeman(db: Db, ctx: ShiftCtx, objectId: string, wanted: string | null | undefined): Promise<string> {
  if (!isAdmin(ctx.role)) {
    if (wanted && wanted !== ctx.memberId) throw new DomainError(403, 'forbidden', 'A foreman can only keep their own shift');
    await assertCanLead(db, ctx, objectId);
    return ctx.memberId;
  }
  const foremanId = wanted || ctx.memberId;
  const [row] = await db.select({ id: members.id }).from(members).where(eq(members.id, foremanId)).limit(1);
  if (!row) throw new DomainError(422, 'invalid_reference', 'The foreman does not exist');
  return foremanId;
}

async function loadShift(db: Db, id: string, lock = false): Promise<ShiftRow> {
  const q = db.select().from(objectShifts).where(eq(objectShifts.id, id)).limit(1);
  const [row] = await (lock ? q.for('update') : q);
  if (!row) throw new DomainError(404, 'not_found', 'shift not found');
  return row;
}

/** Строки смены: часы и объёмы (порядок — по имени работника и позиции) */
async function shiftRows(db: Db, shiftId: string): Promise<{ hours: ShiftHourRow[]; volumes: ShiftVolumeRow[] }> {
  // вставка пачкой даёт одинаковый created_at: порядок добираем по ключу строки, чтобы ответ был стабильным
  const hours = await db
    .select()
    .from(objectShiftHours)
    .where(eq(objectShiftHours.shiftId, shiftId))
    .orderBy(asc(objectShiftHours.createdAt), asc(objectShiftHours.memberId), asc(objectShiftHours.estimateItemId));
  const volumes = await db
    .select()
    .from(objectShiftVolumes)
    .where(eq(objectShiftVolumes.shiftId, shiftId))
    .orderBy(asc(objectShiftVolumes.createdAt), asc(objectShiftVolumes.estimateItemId));
  return { hours, volumes };
}

/** Позиции смет объекта (основная и допработы — включая черновики: прораб распределяет часы по текущей смете) */
async function objectEstimateItemRows(db: Db, objectId: string) {
  return db
    .select({
      id: objectEstimateItems.id,
      estimateId: objectEstimateItems.estimateId,
      estimateName: objectEstimates.name,
      kind: objectEstimateItems.kind,
      name: objectEstimateItems.name,
      unitCode: objectEstimateItems.unitCode,
      qty: objectEstimateItems.qty,
      doneQty: objectEstimateItems.doneQty,
      laborHours: objectEstimateItems.laborHours,
    })
    .from(objectEstimateItems)
    .innerJoin(objectEstimates, and(eq(objectEstimates.workspaceId, objectEstimateItems.workspaceId), eq(objectEstimates.id, objectEstimateItems.estimateId)))
    .where(eq(objectEstimates.objectId, objectId))
    .orderBy(asc(objectEstimates.kind), asc(objectEstimateItems.sortOrder));
}

/** Часы работника за смену не больше предела (24 ч): сумма по работнику, 422 shift_hours_exceed */
function assertMemberHours(lines: ShiftHourInput[]): void {
  const totals = new Map<string, bigint>();
  for (const l of lines) totals.set(l.memberId, (totals.get(l.memberId) ?? 0n) + dec(l.hours));
  for (const [memberId, total] of totals)
    if (total > dec(SHIFT_HOURS_MAX))
      throw new DomainError(422, 'shift_hours_exceed', `A worker cannot have more than ${SHIFT_HOURS_MAX} hours per shift`, { memberId, hours: fmt(total, 2) });
}

/** Строки часов одной пары работник × позиция складываются: повторный скан не создаёт дубль */
function mergeHourLines(lines: ShiftHourInput[]): ShiftHourInput[] {
  const out = new Map<string, ShiftHourInput>();
  for (const l of lines) {
    const key = `${l.memberId}:${l.estimateItemId ?? ''}`;
    const prev = out.get(key);
    out.set(key, prev ? { ...prev, hours: fmt(dec(prev.hours) + dec(l.hours), 2), note: prev.note || l.note || '' } : { ...l });
  }
  return [...out.values()];
}

/** Работники и позиции для экрана смены */
export async function shiftOptions(db: Db, ctx: ShiftCtx, objectId: string): Promise<ShiftOptions> {
  await assertObject(db, objectId);
  await assertCanLead(db, ctx, objectId);
  const [memberRows, items] = await Promise.all([
    db
      .select({ id: members.id, name: members.name, title: members.title, personnelNumber: members.personnelNumber, badgeCode: members.badgeCode })
      .from(members)
      .where(and(eq(members.status, 'active'), sql`${members.role} <> 'guest'`))
      .orderBy(asc(members.name)),
    objectEstimateItemRows(db, objectId),
  ]);
  return {
    objectId,
    members: memberRows,
    workItems: items.filter(i => i.kind === 'work').map(i => ({ ...i })),
    volumeItems: items.map(i => ({ id: i.id, name: i.name, unitCode: i.unitCode, qty: i.qty, doneQty: i.doneQty })),
    foremanId: ctx.memberId,
  };
}

/** Объекты, на которых участник может вести смену: свои для прораба, все неархивные для admin/owner */
export async function shiftObjects(db: Db, ctx: ShiftCtx) {
  const rows = await db
    .select({ id: objects.id, number: objects.number, name: objects.name, status: objects.status })
    .from(objects)
    .where(isNull(objects.archivedAt))
    .orderBy(desc(objects.createdAt));
  if (isAdmin(ctx.role)) return rows;
  const mine = await db.select({ objectId: objectForemen.objectId }).from(objectForemen).where(eq(objectForemen.memberId, ctx.memberId));
  const ids = new Set(mine.map(m => m.objectId));
  return rows.filter(r => ids.has(r.id));
}

/* ---------------- стоимость часа ---------------- */

export interface MemberHourCost {
  memberId: string;
  source: 'hourly' | 'salary' | null;
  gross: string | null;
  rate: string | null;
  /** Норма часов месяца по графику — для показа и проверки */
  monthNormHours: string | null;
}

/** Стоимость часа работников на дату: почасовая ставка, иначе оклад (действующий на дату) / норма часов месяца, плюс взносы */
export async function memberHourCosts(db: Db, workspaceId: string, memberIds: string[], date: string): Promise<Map<string, MemberHourCost>> {
  const out = new Map<string, MemberHourCost>();
  if (!memberIds.length) return out;
  const { insuranceRate } = await payrollSettings(db, workspaceId);
  const monthStart = `${date.slice(0, 7)}-01`;
  const monthEnd = `${date.slice(0, 7)}-${new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0)).getUTCDate()}`;
  const monthDays = dateRange(monthStart, monthEnd);
  const [cal, empRows, salaryKindRows, accruals, memberRows] = await Promise.all([
    calendarContext(db, workspaceId),
    db.select().from(employeePayroll).where(inArray(employeePayroll.memberId, memberIds)),
    db.select({ id: payrollKinds.id }).from(payrollKinds).where(eq(payrollKinds.baseType, 'salary')),
    db
      .select()
      .from(employeeAccruals)
      .where(and(inArray(employeeAccruals.memberId, memberIds), lte(employeeAccruals.validFrom, date)))
      .orderBy(asc(employeeAccruals.validFrom)),
    db.select({ id: members.id, calendarId: members.calendarId }).from(members).where(inArray(members.id, memberIds)),
  ]);
  const salaryKinds = new Set(salaryKindRows.map(k => k.id));
  const empByMember = new Map(empRows.map(e => [e.memberId, e]));
  // действующее начисление: последнее с датой не позже дня работы
  const salaryByMember = new Map<string, string>();
  for (const a of accruals) if (salaryKinds.has(a.kindId) && a.amount && dec(a.amount) > 0n) salaryByMember.set(a.memberId, a.amount);
  const calByMember = new Map(memberRows.map(m => [m.id, m.calendarId]));
  for (const memberId of memberIds) {
    const calendarId = calByMember.get(memberId);
    const calendar = (calendarId ? cal.calendars.get(calendarId) : null) ?? cal.defaultCalendar;
    const exceptions = exceptionsFor(cal.exceptionsByScope, 'member', memberId);
    const workingDays = monthDays.filter(d => isWorkingDayWith(calendar, d, cal.holidays, exceptions)).length;
    const shortHours = fmt(shortDaysTotal(calendar, monthDays, cal.holidays, exceptions), 2);
    const norm = monthNormHours(workingDays, (calendar ?? DEFAULT_CALENDAR).hoursPerDay, shortHours);
    const cost = laborHourCost({
      hourlyRate: empByMember.get(memberId)?.hourlyRate ?? null,
      salary: salaryByMember.get(memberId) ?? null,
      monthNormHours: norm,
      insuranceRate,
    });
    out.set(memberId, { memberId, ...cost });
  }
  return out;
}

/* ---------------- смена ---------------- */

/** Открыть смену (объект, дата, прораб). Повторный вызов на ту же тройку возвращает уже открытую смену */
export async function createShift(
  db: Db,
  ctx: ShiftCtx,
  objectId: string,
  input: { workDate: string; foremanId?: string | null | undefined; note?: string | undefined },
): Promise<string> {
  await assertObject(db, objectId);
  const foremanId = await resolveForeman(db, ctx, objectId, input.foremanId);
  const [existing] = await db
    .select({ id: objectShifts.id })
    .from(objectShifts)
    .where(and(eq(objectShifts.objectId, objectId), eq(objectShifts.workDate, input.workDate), eq(objectShifts.foremanId, foremanId)))
    .limit(1);
  if (existing) return existing.id;
  const [row] = await db
    .insert(objectShifts)
    .values({ workspaceId: ctx.workspaceId, objectId, workDate: input.workDate, foremanId, note: input.note ?? '', createdBy: ctx.memberId })
    .returning({ id: objectShifts.id });
  await db.insert(objectShiftLog).values({ workspaceId: ctx.workspaceId, shiftId: row!.id, authorId: ctx.memberId, action: 'created', after: { workDate: input.workDate, foremanId } });
  await recordEvent(db, {
    workspaceId: ctx.workspaceId,
    type: 'object_shift.created',
    entity: 'object_shift',
    recordId: row!.id,
    actorId: ctx.memberId,
    payload: { objectId, workDate: input.workDate, foremanId },
  });
  return row!.id;
}

/** Сохранить часы бригады и объёмы смены. Черновик правят прораб и admin/owner; подтверждённую — только admin/owner с причиной */
export async function saveShift(db: Db, ctx: ShiftCtx, id: string, input: ShiftSaveInput): Promise<void> {
  const shift = await loadShift(db, id, true);
  const object = await assertObject(db, shift.objectId);
  const confirmed = shift.status === 'confirmed';
  if (confirmed) {
    if (!isAdmin(ctx.role)) throw new DomainError(403, 'forbidden', 'Only an admin can edit a confirmed shift');
    if (!input.reason?.trim()) throw new DomainError(422, 'shift_reason_required', 'A reason is required to edit a confirmed shift');
  } else {
    await assertCanLead(db, ctx, shift.objectId);
  }
  const before = confirmed ? await shiftRows(db, id) : null;
  if (confirmed && before) await applyVolumes(db, before.volumes, -1);

  if (input.hours !== undefined) await replaceHours(db, shift, object, ctx, input.hours);
  if (input.volumes !== undefined) await replaceVolumes(db, shift, input.volumes);
  const set: Partial<typeof objectShifts.$inferInsert> = { updatedAt: new Date() };
  if (input.note !== undefined) set.note = input.note;
  await db.update(objectShifts).set(set).where(eq(objectShifts.id, id));

  if (confirmed) {
    const after = await shiftRows(db, id);
    await applyVolumes(db, after.volumes, 1);
    await snapshotCosts(db, ctx, shift, after.hours);
    await db.insert(objectShiftLog).values({
      workspaceId: ctx.workspaceId,
      shiftId: id,
      authorId: ctx.memberId,
      action: 'updated',
      before: logRows(before!),
      after: logRows(after),
      reason: input.reason!.trim(),
    });
    await recordEvent(db, {
      workspaceId: ctx.workspaceId,
      type: 'object_shift.updated',
      entity: 'object_shift',
      recordId: id,
      actorId: ctx.memberId,
      payload: { objectId: shift.objectId, workDate: shift.workDate },
    });
  } else {
    await recordEvent(db, {
      workspaceId: ctx.workspaceId,
      type: 'object_shift.updated',
      entity: 'object_shift',
      recordId: id,
      actorId: ctx.memberId,
      payload: { objectId: shift.objectId, workDate: shift.workDate },
    });
  }
}

const logRows = (rows: { hours: ShiftHourRow[]; volumes: ShiftVolumeRow[] }) => ({
  hours: rows.hours.map(h => ({ memberId: h.memberId, estimateItemId: h.estimateItemId, hours: h.hours, costRate: h.costRate, costAmount: h.costAmount, note: h.note })),
  volumes: rows.volumes.map(v => ({ estimateItemId: v.estimateItemId, qty: v.qty })),
});

/** Часы смены заменяются целиком: работник и позиция — участники воркспейса и позиции сметы этого объекта (вид work) */
async function replaceHours(db: Db, shift: ShiftRow, object: typeof objects.$inferSelect, ctx: ShiftCtx, input: ShiftHourInput[]): Promise<void> {
  const lines = mergeHourLines(input);
  assertMemberHours(lines);
  if (lines.length) {
    const memberIds = [...new Set(lines.map(l => l.memberId))];
    const found = await db.select({ id: members.id }).from(members).where(inArray(members.id, memberIds));
    const known = new Set(found.map(m => m.id));
    const items = await objectEstimateItemRows(db, object.id);
    const workItems = new Map(items.filter(i => i.kind === 'work').map(i => [i.id, i]));
    for (const l of lines) {
      if (!known.has(l.memberId)) throw new DomainError(422, 'invalid_reference', 'The worker is not a member of the workspace');
      if (l.estimateItemId && !workItems.has(l.estimateItemId)) throw new DomainError(422, 'invalid_reference', 'Hours can only be allocated to work items of the object estimate');
    }
  }
  await db.delete(objectShiftHours).where(eq(objectShiftHours.shiftId, shift.id));
  if (!lines.length) return;
  await db.insert(objectShiftHours).values(
    lines.map(l => ({
      workspaceId: ctx.workspaceId,
      shiftId: shift.id,
      memberId: l.memberId,
      estimateItemId: l.estimateItemId ?? null,
      hours: l.hours,
      note: l.note ?? '',
    })),
  );
}

/** Объёмы смены заменяются целиком: одна строка на позицию, объём больше нуля */
async function replaceVolumes(db: Db, shift: ShiftRow, input: ShiftVolumeInput[]): Promise<void> {
  const byItem = new Map<string, string>();
  for (const v of input) byItem.set(v.estimateItemId, fmt(dec(v.qty) + dec(byItem.get(v.estimateItemId) ?? '0'), 3));
  if (byItem.size) {
    const items = await objectEstimateItemRows(db, shift.objectId);
    const known = new Set(items.map(i => i.id));
    for (const itemId of byItem.keys()) if (!known.has(itemId)) throw new DomainError(422, 'invalid_reference', 'The estimate item does not belong to the object');
  }
  await db.delete(objectShiftVolumes).where(eq(objectShiftVolumes.shiftId, shift.id));
  if (!byItem.size) return;
  await db.insert(objectShiftVolumes).values([...byItem].map(([estimateItemId, qty]) => ({ workspaceId: shift.workspaceId, shiftId: shift.id, estimateItemId, qty })));
}

/** Выполненный объём позиций: direction 1 — прибавить (не больше qty позиции, 422 done_qty_exceeds), −1 — откатить */
async function applyVolumes(db: Db, volumes: ShiftVolumeRow[], direction: 1 | -1): Promise<void> {
  for (const v of volumes) {
    const [item] = await db
      .select({ id: objectEstimateItems.id, qty: objectEstimateItems.qty, doneQty: objectEstimateItems.doneQty })
      .from(objectEstimateItems)
      .where(eq(objectEstimateItems.id, v.estimateItemId))
      .limit(1);
    if (!item) continue;
    if (direction === 1) {
      const done = dec(item.doneQty) + dec(v.qty);
      if (done > dec(item.qty))
        throw new DomainError(422, 'done_qty_exceeds', 'The completed quantity cannot exceed the line quantity', { estimateItemId: v.estimateItemId, qty: item.qty, doneQty: fmt(done, 3) });
      await db.update(objectEstimateItems).set({ doneQty: fmt(done, 3) }).where(eq(objectEstimateItems.id, v.estimateItemId));
    } else {
      const done = dec(item.doneQty) - dec(v.qty);
      await db
        .update(objectEstimateItems)
        .set({ doneQty: fmt(done > 0n ? done : 0n, 3) })
        .where(eq(objectEstimateItems.id, v.estimateItemId));
    }
  }
}

/** Снимок стоимости часа и суммы строки: новая ставка прошлые затраты не меняет. Нет ставки — пусто (пробел, не ноль) */
async function snapshotCosts(db: Db, ctx: ShiftCtx, shift: ShiftRow, hours: ShiftHourRow[]): Promise<void> {
  const memberIds = [...new Set(hours.map(h => h.memberId))];
  const costs = await memberHourCosts(db, ctx.workspaceId, memberIds, shift.workDate);
  for (const h of hours) {
    const rate = costs.get(h.memberId)?.rate ?? null;
    await db
      .update(objectShiftHours)
      .set({ costRate: rate, costAmount: laborCostAmount(h.hours, rate), updatedAt: new Date() })
      .where(eq(objectShiftHours.id, h.id));
  }
  await db.update(objectShifts).set({ updatedAt: new Date() }).where(eq(objectShifts.id, shift.id));
}

/** Подтвердить смену: снимок ставок, объёмы в done_qty, проверка бюджета объекта (block — 422 budget_exceeded) */
export async function confirmShift(db: Db, ctx: ShiftCtx, id: string): Promise<{ warnings: string[] }> {
  const shift = await loadShift(db, id, true);
  if (shift.status === 'confirmed') throw new DomainError(409, 'shift_confirmed', 'The shift is already confirmed');
  await assertCanLead(db, ctx, shift.objectId);
  const rows = await shiftRows(db, id);
  if (!rows.hours.length && !rows.volumes.length) throw new DomainError(422, 'shift_empty', 'A shift without hours and volumes cannot be confirmed');
  assertMemberHours(rows.hours.map(h => ({ memberId: h.memberId, hours: h.hours, estimateItemId: h.estimateItemId })));
  await applyVolumes(db, rows.volumes, 1);
  await snapshotCosts(db, ctx, shift, rows.hours);
  const now = new Date();
  await db.update(objectShifts).set({ status: 'confirmed', confirmedBy: ctx.memberId, confirmedAt: now, updatedAt: now }).where(eq(objectShifts.id, id));
  await db.insert(objectShiftLog).values({ workspaceId: ctx.workspaceId, shiftId: id, authorId: ctx.memberId, action: 'confirmed', after: logRows(rows) });
  const warnings = await assertObjectBudget(db, { workspaceId: ctx.workspaceId, memberId: ctx.memberId }, shift.objectId);
  await recordEvent(db, {
    workspaceId: ctx.workspaceId,
    type: 'object_shift.confirmed',
    entity: 'object_shift',
    recordId: id,
    actorId: ctx.memberId,
    payload: { objectId: shift.objectId, workDate: shift.workDate, hours: sum(rows.hours.map(h => h.hours)) },
  });
  return { warnings };
}

/** Отменить подтверждение: только admin/owner с причиной; объёмы откатываются, снимок стоимости снимается */
export async function unconfirmShift(db: Db, ctx: ShiftCtx, id: string, reason: string): Promise<void> {
  const shift = await loadShift(db, id, true);
  if (shift.status !== 'confirmed') throw new DomainError(409, 'shift_not_confirmed', 'The shift is not confirmed');
  if (!isAdmin(ctx.role)) throw new DomainError(403, 'forbidden', 'Only an admin can unconfirm a shift');
  if (!reason.trim()) throw new DomainError(422, 'shift_reason_required', 'A reason is required to unconfirm a shift');
  const rows = await shiftRows(db, id);
  await applyVolumes(db, rows.volumes, -1);
  await db.update(objectShiftHours).set({ costRate: null, costAmount: null, updatedAt: new Date() }).where(eq(objectShiftHours.shiftId, id));
  await db.update(objectShifts).set({ status: 'draft', confirmedBy: null, confirmedAt: null, updatedAt: new Date() }).where(eq(objectShifts.id, id));
  await db.insert(objectShiftLog).values({ workspaceId: ctx.workspaceId, shiftId: id, authorId: ctx.memberId, action: 'unconfirmed', before: logRows(rows), reason: reason.trim() });
  await recordEvent(db, {
    workspaceId: ctx.workspaceId,
    type: 'object_shift.unconfirmed',
    entity: 'object_shift',
    recordId: id,
    actorId: ctx.memberId,
    payload: { objectId: shift.objectId, workDate: shift.workDate },
  });
}

/** Смена со строками, журналом и правами текущего участника; деньги — только owner/admin */
export async function shiftView(db: Db, ctx: ShiftCtx, id: string): Promise<ShiftView> {
  const shift = await loadShift(db, id);
  const showMoney = canSeeCost(ctx.role);
  const { hours, volumes } = await shiftRows(db, id);
  const items = await objectEstimateItemRows(db, shift.objectId);
  const itemById = new Map(items.map(i => [i.id, i]));
  const [object] = await db.select({ number: objects.number, name: objects.name }).from(objects).where(eq(objects.id, shift.objectId)).limit(1);
  const memberIds = [...new Set([shift.foremanId, ...hours.map(h => h.memberId)])];
  const memberRows = memberIds.length ? await db.select({ id: members.id, name: members.name, personnelNumber: members.personnelNumber }).from(members).where(inArray(members.id, memberIds)) : [];
  const memberById = new Map(memberRows.map(m => [m.id, m]));
  const logRowsDb = await db.select().from(objectShiftLog).where(eq(objectShiftLog.shiftId, id)).orderBy(desc(objectShiftLog.at));
  const authorIds = [...new Set(logRowsDb.map(l => l.authorId).filter((x): x is string => !!x))];
  const authors = authorIds.length ? await db.select({ id: members.id, name: members.name }).from(members).where(inArray(members.id, authorIds)) : [];
  const authorById = new Map(authors.map(a => [a.id, a.name]));
  const admin = isAdmin(ctx.role);
  const foreman = !admin && shift.foremanId === ctx.memberId ? await isForemanOf(db, shift.objectId, ctx.memberId) : false;
  const canWrite = admin || foreman;
  const hourViews: ShiftHourView[] = hours.map(h => ({
    id: h.id,
    memberId: h.memberId,
    memberName: memberById.get(h.memberId)?.name ?? '',
    personnelNumber: memberById.get(h.memberId)?.personnelNumber ?? null,
    estimateItemId: h.estimateItemId,
    estimateItemName: h.estimateItemId ? (itemById.get(h.estimateItemId)?.name ?? null) : null,
    hours: h.hours,
    costRate: showMoney ? h.costRate : null,
    costAmount: showMoney ? h.costAmount : null,
    note: h.note,
  }));
  const amount = hours.some(h => h.costAmount === null) ? null : sum(hours.map(h => h.costAmount!));
  return {
    id: shift.id,
    objectId: shift.objectId,
    objectNumber: object?.number ?? '',
    objectName: object?.name ?? '',
    workDate: shift.workDate,
    foremanId: shift.foremanId,
    foremanName: memberById.get(shift.foremanId)?.name ?? '',
    status: shift.status,
    confirmedBy: shift.confirmedBy,
    confirmedAt: shift.confirmedAt ? shift.confirmedAt.toISOString() : null,
    note: shift.note,
    hours: hourViews,
    volumes: volumes.map(v => ({
      id: v.id,
      estimateItemId: v.estimateItemId,
      estimateItemName: itemById.get(v.estimateItemId)?.name ?? '',
      unitCode: itemById.get(v.estimateItemId)?.unitCode ?? '',
      qty: v.qty,
    })),
    totalHours: sum(hours.map(h => h.hours)),
    totalAmount: showMoney ? amount : null,
    noRate: hours.filter(h => h.costRate === null).length,
    canSeeCost: showMoney,
    canWrite,
    log: logRowsDb.map(l => ({
      id: l.id,
      at: l.at.toISOString(),
      authorId: l.authorId,
      authorName: l.authorId ? (authorById.get(l.authorId) ?? null) : null,
      action: l.action,
      reason: l.reason,
      before: l.before,
      after: l.after,
    })),
    createdAt: shift.createdAt.toISOString(),
    updatedAt: shift.updatedAt.toISOString(),
  };
}

/** Смены объекта за период: статус, часы, сумма (только owner/admin) и число работников без ставки */
export async function objectShiftsView(
  db: Db,
  ctx: ShiftCtx,
  objectId: string,
  q: { from?: string | undefined; to?: string | undefined; limit?: number | undefined },
): Promise<{ objectId: string; canSeeCost: boolean; items: ShiftListItem[] }> {
  await assertObject(db, objectId);
  const where = [
    eq(objectShifts.objectId, objectId),
    q.from ? gte(objectShifts.workDate, q.from) : undefined,
    q.to ? lte(objectShifts.workDate, q.to) : undefined,
  ];
  const shifts = await db
    .select({ shift: objectShifts, foremanName: members.name })
    .from(objectShifts)
    .innerJoin(members, and(eq(members.workspaceId, objectShifts.workspaceId), eq(members.id, objectShifts.foremanId)))
    .where(and(...where))
    .orderBy(desc(objectShifts.workDate), desc(objectShifts.createdAt))
    .limit(q.limit ?? 100);
  const showMoney = canSeeCost(ctx.role);
  const ids = shifts.map(s => s.shift.id);
  const hours = ids.length ? await db.select().from(objectShiftHours).where(inArray(objectShiftHours.shiftId, ids)) : [];
  const byShift = new Map<string, ShiftHourRow[]>();
  for (const h of hours) byShift.set(h.shiftId, [...(byShift.get(h.shiftId) ?? []), h]);
  return {
    objectId,
    canSeeCost: showMoney,
    items: shifts.map(({ shift, foremanName }) => {
      const rows = byShift.get(shift.id) ?? [];
      const amount = rows.some(r => r.costAmount === null) ? null : sum(rows.map(r => r.costAmount!));
      return {
        id: shift.id,
        workDate: shift.workDate,
        status: shift.status,
        foremanId: shift.foremanId,
        foremanName,
        note: shift.note,
        totalHours: sum(rows.map(r => r.hours)),
        totalAmount: showMoney ? amount : null,
        confirmedAt: shift.confirmedAt ? shift.confirmedAt.toISOString() : null,
        employees: new Set(rows.map(r => r.memberId)).size,
        noRate: rows.filter(r => r.costRate === null).length,
      };
    }),
  };
}

/** Табель за период: работник × дни по подтверждённым сменам объекта (факт; черновики в табель не входят) */
export async function objectTimesheet(db: Db, objectId: string, q: { from: string; to: string }): Promise<ObjectTimesheet> {
  await assertObject(db, objectId);
  const days = dateRange(q.from, q.to);
  const shifts = await db
    .select({ id: objectShifts.id })
    .from(objectShifts)
    .where(and(eq(objectShifts.objectId, objectId), eq(objectShifts.status, 'confirmed'), gte(objectShifts.workDate, q.from), lte(objectShifts.workDate, q.to)));
  const ids = shifts.map(s => s.id);
  const rows = ids.length
    ? await db
        .select({ h: objectShiftHours, workDate: objectShifts.workDate, memberName: members.name, personnelNumber: members.personnelNumber })
        .from(objectShiftHours)
        .innerJoin(objectShifts, eq(objectShifts.id, objectShiftHours.shiftId))
        .innerJoin(members, and(eq(members.workspaceId, objectShiftHours.workspaceId), eq(members.id, objectShiftHours.memberId)))
        .where(inArray(objectShiftHours.shiftId, ids))
    : [];
  const dayIndex = new Map(days.map((d, i) => [d, i]));
  const byMember = new Map<string, { memberName: string; personnelNumber: string | null; hours: bigint[]; noRate: boolean }>();
  for (const r of rows) {
    const entry = byMember.get(r.h.memberId) ?? { memberName: r.memberName, personnelNumber: r.personnelNumber, hours: days.map(() => 0n), noRate: false };
    const i = dayIndex.get(r.workDate);
    if (i !== undefined) entry.hours[i] = entry.hours[i]! + dec(r.h.hours);
    if (r.h.costRate === null) entry.noRate = true;
    byMember.set(r.h.memberId, entry);
  }
  const totalByDay = days.map((_, i) => [...byMember.values()].reduce((s, e) => s + e.hours[i]!, 0n));
  return {
    objectId,
    from: q.from,
    to: q.to,
    days,
    rows: [...byMember].map(([memberId, e]) => ({
      memberId,
      memberName: e.memberName,
      personnelNumber: e.personnelNumber,
      hours: e.hours.map(h => fmt(h, 2)),
      total: fmt(e.hours.reduce((s, h) => s + h, 0n), 2),
      noRate: e.noRate,
    })),
    totalByDay: totalByDay.map(h => fmt(h, 2)),
    total: fmt(totalByDay.reduce((s, h) => s + h, 0n), 2),
  };
}

/* ---------------- бейджи и рабочие без входа ---------------- */

export interface BadgeView {
  memberId: string;
  name: string;
  personnelNumber: string | null;
  badgeCode: string;
}

/** Выпустить или перевыпустить бейдж: старый код просто заменяется (отзывается), новый уникален в воркспейсе */
export async function issueBadge(db: Db, ctx: ShiftCtx & { memberId: string }, memberId: string, personnelNumber?: string | null): Promise<BadgeView> {
  const [member] = await db.select().from(members).where(eq(members.id, memberId)).limit(1);
  if (!member) throw new DomainError(404, 'not_found', 'member not found');
  let code = '';
  for (let i = 0; i < 20; i++) {
    const candidate = badgeCode();
    const [clash] = await db.select({ id: members.id }).from(members).where(and(eq(members.workspaceId, ctx.workspaceId), eq(members.badgeCode, candidate))).limit(1);
    if (!clash) {
      code = candidate;
      break;
    }
  }
  if (!code) throw new DomainError(409, 'conflict', 'Could not generate a unique badge code');
  await db
    .update(members)
    .set({ badgeCode: code, ...(personnelNumber === undefined ? {} : { personnelNumber: personnelNumber || null }), updatedAt: new Date() })
    .where(eq(members.id, memberId));
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'member.updated', entity: 'member', recordId: memberId, actorId: ctx.memberId, payload: { badgeCode: code, reissued: !!member.badgeCode } });
  return { memberId, name: member.name, personnelNumber: personnelNumber === undefined ? member.personnelNumber : personnelNumber || null, badgeCode: code };
}

/** Работник по коду бейджа (скан камеры или ручной ввод): неактивный и неизвестный код — 404 badge_not_found */
export async function findMemberByBadge(db: Db, code: string): Promise<BadgeView> {
  const [member] = await db.select().from(members).where(eq(members.badgeCode, normalizeBadgeCode(code))).limit(1);
  if (!member || member.status !== 'active') throw new DomainError(404, 'badge_not_found', 'The badge code is unknown or revoked');
  return { memberId: member.id, name: member.name, personnelNumber: member.personnelNumber, badgeCode: member.badgeCode! };
}

/** Данные для печати бейджей: имя, табельный номер и код (QR рисует API) */
export async function badgesForPrint(db: Db, workspaceId: string, ids?: string[]): Promise<BadgeView[]> {
  const where = [eq(members.workspaceId, workspaceId), sql`${members.badgeCode} is not null and ${members.badgeCode} <> ''`];
  if (ids?.length) where.push(inArray(members.id, ids));
  const rows = await db
    .select({ memberId: members.id, name: members.name, personnelNumber: members.personnelNumber, badgeCode: members.badgeCode })
    .from(members)
    .where(and(...where))
    .orderBy(asc(members.name));
  return rows.map(r => ({ ...r, badgeCode: r.badgeCode! }));
}

export interface MemberView {
  id: string;
  name: string;
  email: string;
  title: string;
  role: string;
  status: string;
  userId: string | null;
  personnelNumber: string | null;
  badgeCode: string | null;
}

/** Рабочий без входа: участник воркспейса без user_id и без membership (status active).
    Почта служебная и уникальная — вход по ней невозможен, приглашения не создаётся. */
export async function createWorker(db: Db, ctx: ShiftCtx, input: { name: string; personnelNumber?: string | undefined; title?: string | undefined; id?: string | undefined }): Promise<MemberView> {
  const email = `worker-${uuidv7().slice(-12)}@workers.invalid`;
  const [row] = await db
    .insert(members)
    .values({
      ...(input.id ? { id: input.id } : {}),
      workspaceId: ctx.workspaceId,
      userId: null,
      email,
      name: input.name.trim(),
      title: input.title ?? '',
      personnelNumber: input.personnelNumber?.trim() || null,
      role: 'member',
      status: 'active',
    })
    .returning();
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'member.created', entity: 'member', recordId: row!.id, actorId: ctx.memberId, payload: { worker: true, personnelNumber: row!.personnelNumber } });
  return {
    id: row!.id,
    name: row!.name,
    email: row!.email,
    title: row!.title,
    role: row!.role,
    status: row!.status,
    userId: row!.userId,
    personnelNumber: row!.personnelNumber,
    badgeCode: row!.badgeCode,
  };
}
