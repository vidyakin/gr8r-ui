/* Автопарк (задача 1210; docs/architecture/fleet.md): машины, водители, документы со сроками, путевые листы, топливо, регламент ТО,
   ремонты с запчастями со склада, штрафы, затраты на машину. Расчёты норм и сроков — чистые функции из @gr8r/shared (fleet.ts).
   Затраты не копятся в своей бухгалтерии: каждая запись несёт статью затрат, сумму и день (как доставка), запчасти со склада
   списывает обычный документ «Списание». */
import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import {
  FLEET_COST_ITEMS,
  FLEET_DOC_KINDS,
  FLEET_FINE_COST_KEY,
  FLEET_FUEL_COST_KEY,
  FLEET_REPAIR_COST_KEY,
  WAYBILL_BLOCKING_DOCS,
  addDaysIso,
  dec,
  div,
  docTermState,
  fmt,
  fuelNormPer100,
  mul,
  parseFuelCsv,
  serviceDue,
  waybillFuel,
  type FleetDocKind,
  type FuelCsvRow,
  type WaybillPrintData,
} from '@gr8r/shared';
import type { Db } from './client';
import { DomainError } from './errors';
import { recordEvent } from './events';
import { assertPeriodOpen } from './cost-closing';
import { cancelDocument, createDocument, ensureCostItems, postDocument, unpostDocument, type DocCtx } from './documents';
import { memberIdsWithFunction } from './positions';
import {
  companies,
  costItems,
  fleetDocuments,
  fleetDriverProfiles,
  fleetFines,
  fleetFuelCards,
  fleetFuelEntries,
  fleetRepairLines,
  fleetRepairs,
  fleetServicePlans,
  fleetVehicles,
  fleetWaybills,
  members,
  notifications,
  organizations,
  products,
  stockMoves,
  warehouses,
} from './schema';

export type VehicleRow = typeof fleetVehicles.$inferSelect;
export type FleetDocumentRow = typeof fleetDocuments.$inferSelect;
export type WaybillRow = typeof fleetWaybills.$inferSelect;
export type FuelEntryRow = typeof fleetFuelEntries.$inferSelect;
export type RepairRow = typeof fleetRepairs.$inferSelect;
export type FineRow = typeof fleetFines.$inferSelect;

const today = () => new Date().toISOString().slice(0, 10);
const isAdmin = (role: string | undefined) => role === 'owner' || role === 'admin';
const notFound = (what: string) => new DomainError(404, 'not_found', `${what} not found`);
const like = (q: string) => `%${q.replace(/[%_\\]/g, m => '\\' + m)}%`;

async function event(db: Db, ctx: DocCtx, entity: string, action: string, id: string, payload: Record<string, unknown> = {}) {
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: `${entity}.${action}`, entity, recordId: id, actorId: ctx.memberId, payload });
}

/** Статья затрат по системному ключу (создаётся при первом обращении, если воркспейс появился до автопарка) */
async function costItemId(db: Db, ws: string, key: string): Promise<string> {
  const find = async () => (await db.select({ id: costItems.id }).from(costItems).where(and(eq(costItems.workspaceId, ws), eq(costItems.systemKey, key))).limit(1))[0]?.id;
  const have = await find();
  if (have) return have;
  await ensureCostItems(db, ws);
  const id = await find();
  if (!id) throw new DomainError(404, 'not_found', `cost item ${key} not found`);
  return id;
}
export { FLEET_COST_ITEMS };

/** Следующий номер документа автопарка «ПЛ-2026-00001»: под блокировкой, чтобы параллельные запросы не взяли один номер */
export async function nextNumber(db: Db, ws: string, table: 'fleet_waybills' | 'fleet_repairs' | 'fleet_trips', prefix: string, date: string): Promise<string> {
  await db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`fleet:${table}:${ws}`}, 0))`);
  const year = date.slice(0, 4);
  const like = `${prefix}-${year}-%`;
  const rows = await db.execute<{ n: number | null }>(sql`select max(substring(number from '[0-9]+$')::int) as n from ${sql.identifier(table)} where workspace_id = ${ws} and number like ${like}`);
  const n = (rows[0]?.n ?? 0) + 1;
  return `${prefix}-${year}-${String(n).padStart(5, '0')}`;
}

/* ---------------- машины ---------------- */

export interface VehicleInput {
  plate: string;
  name?: string;
  kind?: VehicleRow['kind'];
  make?: string;
  model?: string;
  vin?: string;
  year?: number | null;
  capacityKg?: string | null;
  volumeM3?: string | null;
  pallets?: number | null;
  fuelType?: VehicleRow['fuelType'];
  fuelNormSummer?: string | null;
  fuelNormWinter?: string | null;
  tankL?: string | null;
  odometer?: string;
  status?: VehicleRow['status'];
  driverMemberId?: string | null;
  comment?: string;
}

export async function loadVehicle(db: Db, id: string, lock = false): Promise<VehicleRow> {
  const q = db.select().from(fleetVehicles).where(eq(fleetVehicles.id, id)).limit(1);
  const [row] = await (lock ? q.for('update') : q);
  if (!row) throw notFound('vehicle');
  return row;
}

export async function assertMember(db: Db, id: string | null | undefined): Promise<void> {
  if (!id) return;
  const [m] = await db.select({ id: members.id }).from(members).where(eq(members.id, id)).limit(1);
  if (!m) throw new DomainError(422, 'invalid_reference', 'The member does not exist');
}

export async function listVehicles(db: Db, q: { q?: string; status?: VehicleRow['status']; archived?: 'exclude' | 'include' | 'only' } = {}) {
  const rows = await db
    .select({ v: fleetVehicles, driverName: members.name })
    .from(fleetVehicles)
    .leftJoin(members, eq(members.id, fleetVehicles.driverMemberId))
    .where(
      and(
        q.archived === 'only' ? sql`${fleetVehicles.archivedAt} is not null` : q.archived === 'include' ? undefined : isNull(fleetVehicles.archivedAt),
        q.status ? eq(fleetVehicles.status, q.status) : undefined,
        q.q ? or(sql`${fleetVehicles.plate} ilike ${like(q.q)}`, sql`${fleetVehicles.name} ilike ${like(q.q)}`, sql`${fleetVehicles.model} ilike ${like(q.q)}`) : undefined,
      ),
    )
    .orderBy(asc(fleetVehicles.plate));
  const docs = await db.select().from(fleetDocuments).where(and(eq(fleetDocuments.ownerKind, 'vehicle'), isNull(fleetDocuments.archivedAt)));
  const now = today();
  return rows.map(r => {
    const mine = docs.filter(d => d.vehicleId === r.v.id).map(d => docTermState(d.validUntil, d.remindDays, now).state);
    return { ...r.v, driverName: r.driverName ?? null, docsExpired: mine.filter(s => s === 'expired').length, docsExpiring: mine.filter(s => s === 'expiring').length };
  });
}

export async function getVehicle(db: Db, id: string) {
  const v = await loadVehicle(db, id);
  const [driver] = v.driverMemberId ? await db.select({ name: members.name }).from(members).where(eq(members.id, v.driverMemberId)).limit(1) : [];
  return { ...v, driverName: driver?.name ?? null, documents: await listFleetDocuments(db, { vehicleId: id }), servicePlans: await listServicePlans(db, id) };
}

export async function createVehicle(db: Db, ctx: DocCtx, input: VehicleInput): Promise<VehicleRow> {
  await assertMember(db, input.driverMemberId);
  const [row] = await db
    .insert(fleetVehicles)
    .values({ workspaceId: ctx.workspaceId, ...input, plate: input.plate.trim().toUpperCase() })
    .returning();
  await event(db, ctx, 'fleet_vehicle', 'created', row!.id, { plate: row!.plate });
  return row!;
}

export async function updateVehicle(db: Db, ctx: DocCtx, id: string, input: Partial<VehicleInput>): Promise<VehicleRow> {
  await loadVehicle(db, id);
  await assertMember(db, input.driverMemberId);
  const set = { ...input, ...(input.plate ? { plate: input.plate.trim().toUpperCase() } : {}), updatedAt: new Date() };
  const [row] = await db.update(fleetVehicles).set(set).where(eq(fleetVehicles.id, id)).returning();
  await event(db, ctx, 'fleet_vehicle', 'updated', id, { changes: Object.keys(input) });
  return row!;
}

export async function archiveVehicle(db: Db, ctx: DocCtx, id: string, archive: boolean): Promise<void> {
  await loadVehicle(db, id);
  await db.update(fleetVehicles).set({ archivedAt: archive ? new Date() : null, updatedAt: new Date() }).where(eq(fleetVehicles.id, id));
  await event(db, ctx, 'fleet_vehicle', archive ? 'archived' : 'restored', id);
}

/* ---------------- водители ---------------- */

export interface DriverProfileInput {
  licenseNumber?: string;
  categories?: string[];
  phone?: string;
  comment?: string;
}

/** Водители: участники с должностью с функцией `driver`; нет такой должности в воркспейсе — все активные участники */
export async function listDrivers(db: Db) {
  const ids = await memberIdsWithFunction(db, 'driver');
  const all = await db.select({ id: members.id, name: members.name, email: members.email }).from(members).where(eq(members.status, 'active')).orderBy(asc(members.name));
  const list = ids ? all.filter(m => ids.has(m.id)) : all;
  const profiles = await db.select().from(fleetDriverProfiles);
  const docs = await db.select().from(fleetDocuments).where(and(eq(fleetDocuments.ownerKind, 'driver'), isNull(fleetDocuments.archivedAt)));
  const vehicles = await db.select({ id: fleetVehicles.id, plate: fleetVehicles.plate, driverMemberId: fleetVehicles.driverMemberId }).from(fleetVehicles).where(isNull(fleetVehicles.archivedAt));
  const now = today();
  return list.map(m => {
    const p = profiles.find(x => x.memberId === m.id);
    const states = docs.filter(d => d.memberId === m.id).map(d => docTermState(d.validUntil, d.remindDays, now).state);
    return {
      memberId: m.id,
      name: m.name,
      email: m.email,
      licenseNumber: p?.licenseNumber ?? '',
      categories: p?.categories ?? [],
      phone: p?.phone ?? '',
      comment: p?.comment ?? '',
      vehicles: vehicles.filter(v => v.driverMemberId === m.id).map(v => ({ id: v.id, plate: v.plate })),
      docsExpired: states.filter(s => s === 'expired').length,
      docsExpiring: states.filter(s => s === 'expiring').length,
    };
  });
}

export async function saveDriverProfile(db: Db, ctx: DocCtx, memberId: string, input: DriverProfileInput) {
  await assertMember(db, memberId);
  const [row] = await db
    .insert(fleetDriverProfiles)
    .values({ workspaceId: ctx.workspaceId, memberId, ...input })
    .onConflictDoUpdate({ target: [fleetDriverProfiles.workspaceId, fleetDriverProfiles.memberId], set: { ...input, updatedAt: new Date() } })
    .returning();
  await event(db, ctx, 'fleet_driver', 'updated', memberId);
  return row!;
}

async function driverProfile(db: Db, memberId: string) {
  const [p] = await db.select().from(fleetDriverProfiles).where(eq(fleetDriverProfiles.memberId, memberId)).limit(1);
  return p ?? null;
}

/* ---------------- документы со сроками ---------------- */

export interface FleetDocumentInput {
  kind: FleetDocKind;
  vehicleId?: string | null;
  memberId?: string | null;
  number?: string;
  issuedOn?: string | null;
  validUntil?: string | null;
  remindDays?: number;
  comment?: string;
}

export async function listFleetDocuments(db: Db, q: { vehicleId?: string; memberId?: string; kind?: FleetDocKind; term?: 'ok' | 'expiring' | 'expired'; archived?: 'exclude' | 'include' | 'only' } = {}) {
  const rows = await db
    .select({ d: fleetDocuments, plate: fleetVehicles.plate, memberName: members.name })
    .from(fleetDocuments)
    .leftJoin(fleetVehicles, eq(fleetVehicles.id, fleetDocuments.vehicleId))
    .leftJoin(members, eq(members.id, fleetDocuments.memberId))
    .where(
      and(
        q.archived === 'only' ? sql`${fleetDocuments.archivedAt} is not null` : q.archived === 'include' ? undefined : isNull(fleetDocuments.archivedAt),
        q.vehicleId ? eq(fleetDocuments.vehicleId, q.vehicleId) : undefined,
        q.memberId ? eq(fleetDocuments.memberId, q.memberId) : undefined,
        q.kind ? eq(fleetDocuments.kind, q.kind) : undefined,
      ),
    )
    .orderBy(sql`${fleetDocuments.validUntil} asc nulls last`, asc(fleetDocuments.createdAt));
  const now = today();
  return rows
    .map(r => ({ ...r.d, plate: r.plate ?? null, memberName: r.memberName ?? null, ...docTermState(r.d.validUntil, r.d.remindDays, now) }))
    .filter(r => !q.term || (q.term === 'ok' ? r.state === 'ok' || r.state === 'unlimited' : r.state === q.term));
}

async function checkDocOwner(db: Db, input: { kind: string; vehicleId?: string | null; memberId?: string | null }) {
  const owner = FLEET_DOC_KINDS[input.kind as FleetDocKind];
  if (!owner) throw new DomainError(422, 'fleet_document_kind', 'Unknown document kind');
  if (owner === 'vehicle') {
    if (!input.vehicleId || input.memberId) throw new DomainError(422, 'fleet_document_owner', 'This document belongs to a vehicle');
    await loadVehicle(db, input.vehicleId);
  } else {
    if (!input.memberId || input.vehicleId) throw new DomainError(422, 'fleet_document_owner', 'This document belongs to a driver');
    await assertMember(db, input.memberId);
  }
  return owner;
}

export async function createFleetDocument(db: Db, ctx: DocCtx, input: FleetDocumentInput): Promise<FleetDocumentRow> {
  const ownerKind = await checkDocOwner(db, input);
  const [row] = await db
    .insert(fleetDocuments)
    .values({ workspaceId: ctx.workspaceId, ownerKind, kind: input.kind, vehicleId: input.vehicleId ?? null, memberId: input.memberId ?? null, number: input.number ?? '', issuedOn: input.issuedOn ?? null, validUntil: input.validUntil ?? null, remindDays: input.remindDays ?? 30, comment: input.comment ?? '' })
    .returning();
  await event(db, ctx, 'fleet_document', 'created', row!.id, { kind: input.kind });
  return row!;
}

export async function updateFleetDocument(db: Db, ctx: DocCtx, id: string, input: Partial<FleetDocumentInput>): Promise<FleetDocumentRow> {
  const [cur] = await db.select().from(fleetDocuments).where(eq(fleetDocuments.id, id)).limit(1);
  if (!cur) throw notFound('document');
  if (input.kind || input.vehicleId !== undefined || input.memberId !== undefined) await checkDocOwner(db, { kind: input.kind ?? cur.kind, vehicleId: input.vehicleId === undefined ? cur.vehicleId : input.vehicleId, memberId: input.memberId === undefined ? cur.memberId : input.memberId });
  const set: Partial<typeof fleetDocuments.$inferInsert> = { updatedAt: new Date() };
  for (const k of ['kind', 'vehicleId', 'memberId', 'number', 'issuedOn', 'validUntil', 'remindDays', 'comment'] as const) if (input[k] !== undefined) (set as Record<string, unknown>)[k] = input[k];
  if (input.kind) set.ownerKind = FLEET_DOC_KINDS[input.kind];
  // продление срока снимает отметку «напоминание отправлено»
  if (input.validUntil !== undefined && input.validUntil !== cur.validUntil) {
    set.notifiedStage = 0;
    set.notifiedFor = null;
  }
  const [row] = await db.update(fleetDocuments).set(set).where(eq(fleetDocuments.id, id)).returning();
  await event(db, ctx, 'fleet_document', 'updated', id, { changes: Object.keys(input) });
  return row!;
}

export async function deleteFleetDocument(db: Db, ctx: DocCtx, id: string): Promise<void> {
  const [cur] = await db.select({ id: fleetDocuments.id }).from(fleetDocuments).where(eq(fleetDocuments.id, id)).limit(1);
  if (!cur) throw notFound('document');
  await db.delete(fleetDocuments).where(eq(fleetDocuments.id, id));
  await event(db, ctx, 'fleet_document', 'deleted', id);
}

/** Проход воркера «сроки документов»: уведомления администраторам (и водителю для его документов) и событие для автоматизаций.
    Одно напоминание на ступень (истекает / истёк) и срок: отметка notified_* ставится в той же транзакции, повторный проход ничего не создаёт */
export async function runFleetDocumentReminders(db: Db, ws: string, now: string = today()): Promise<number> {
  const rows = await db
    .select({ d: fleetDocuments, plate: fleetVehicles.plate, memberName: members.name })
    .from(fleetDocuments)
    .leftJoin(fleetVehicles, eq(fleetVehicles.id, fleetDocuments.vehicleId))
    .leftJoin(members, eq(members.id, fleetDocuments.memberId))
    .where(and(eq(fleetDocuments.workspaceId, ws), isNull(fleetDocuments.archivedAt), sql`${fleetDocuments.validUntil} is not null`, sql`${fleetDocuments.validUntil} <= (${now}::date + ${fleetDocuments.remindDays})`))
    .for('update', { of: fleetDocuments, skipLocked: true })
    .limit(500);
  if (!rows.length) return 0;
  const admins = (await db.select({ id: members.id }).from(members).where(and(eq(members.workspaceId, ws), eq(members.status, 'active'), inArray(members.role, ['owner', 'admin'])))).map(m => m.id);
  let n = 0;
  for (const r of rows) {
    const { state, daysLeft } = docTermState(r.d.validUntil, r.d.remindDays, now);
    if (state !== 'expiring' && state !== 'expired') continue;
    const stage = state === 'expired' ? 2 : 1;
    if (r.d.notifiedFor === r.d.validUntil && r.d.notifiedStage >= stage) continue;
    await db.update(fleetDocuments).set({ notifiedFor: r.d.validUntil, notifiedStage: stage }).where(eq(fleetDocuments.id, r.d.id));
    const who = r.plate ?? r.memberName ?? '';
    const text = stage === 2 ? `Срок документа истёк: ${who}, ${r.d.kind} ${r.d.number}`.trim() : `Срок документа истекает через ${daysLeft} дн.: ${who}, ${r.d.kind} ${r.d.number}`.trim();
    const recipients = new Set([...admins, ...(r.d.memberId ? [r.d.memberId] : [])]);
    for (const rid of recipients) {
      const [nt] = await db.insert(notifications).values({ workspaceId: ws, recipientId: rid, type: 'update', actorId: null, text, snippet: `${r.d.validUntil}` }).returning({ id: notifications.id });
      await recordEvent(db, { workspaceId: ws, type: 'notification.created', entity: 'notification', recordId: nt!.id, actorId: null, payload: { recipientId: rid, via: 'fleet_document' } });
    }
    await recordEvent(db, {
      workspaceId: ws,
      type: `fleet_document.${stage === 2 ? 'expired' : 'expiring'}`,
      entity: 'fleet_document',
      recordId: r.d.id,
      actorId: null,
      payload: { record: { ...r.d }, subject: who, daysLeft, documentKind: r.d.kind, ownerKind: r.d.ownerKind },
    });
    n++;
  }
  return n;
}

/* ---------------- путевые листы ---------------- */

export interface WaybillInput {
  vehicleId: string;
  driverMemberId: string;
  date: string;
  route?: string;
  departureAt?: string | null;
  returnAt?: string | null;
  odometerOut?: string;
  fuelOut?: string;
  odometerBack?: string | null;
  fuelBack?: string | null;
  medicalOk?: boolean;
  medicalTime?: string;
  medicalBy?: string;
  techOk?: boolean;
  techTime?: string;
  techBy?: string;
  tripId?: string | null;
  comment?: string;
}

async function loadWaybill(db: Db, id: string, lock = false): Promise<WaybillRow> {
  const q = db.select().from(fleetWaybills).where(eq(fleetWaybills.id, id)).limit(1);
  const [row] = await (lock ? q.for('update') : q);
  if (!row) throw notFound('waybill');
  return row;
}

const dt = (v: string | null | undefined) => (v ? new Date(v) : null);

/** Заправлено по листу, л */
async function filledLiters(db: Db, waybillId: string): Promise<string> {
  const [r] = await db.select({ s: sql<string>`coalesce(sum(${fleetFuelEntries.liters}), 0)::text` }).from(fleetFuelEntries).where(eq(fleetFuelEntries.waybillId, waybillId));
  return r?.s ?? '0';
}

export async function waybillView(db: Db, w: WaybillRow) {
  const filled = await filledLiters(db, w.id);
  const fuel = waybillFuel({ fuelOut: w.fuelOut, fuelBack: w.fuelBack, fuelFilled: filled, odometerOut: w.odometerOut, odometerBack: w.odometerBack, normPer100: w.normPer100 });
  return { ...w, fuelFilled: filled, fuel };
}

export async function listWaybills(db: Db, q: { from?: string; to?: string; vehicleId?: string; driverId?: string; status?: WaybillRow['status']; q?: string; limit?: number; offset?: number }) {
  const where = and(
    q.from ? gte(fleetWaybills.date, q.from) : undefined,
    q.to ? lte(fleetWaybills.date, q.to) : undefined,
    q.vehicleId ? eq(fleetWaybills.vehicleId, q.vehicleId) : undefined,
    q.driverId ? eq(fleetWaybills.driverMemberId, q.driverId) : undefined,
    q.status ? eq(fleetWaybills.status, q.status) : undefined,
    q.q ? or(sql`${fleetWaybills.number} ilike ${like(q.q)}`, sql`${fleetVehicles.plate} ilike ${like(q.q)}`, sql`${members.name} ilike ${like(q.q)}`) : undefined,
  );
  const base = db.select({ w: fleetWaybills, plate: fleetVehicles.plate, driverName: members.name }).from(fleetWaybills).innerJoin(fleetVehicles, eq(fleetVehicles.id, fleetWaybills.vehicleId)).innerJoin(members, eq(members.id, fleetWaybills.driverMemberId)).where(where);
  const rows = await base.orderBy(desc(fleetWaybills.date), desc(fleetWaybills.number)).limit(q.limit ?? 50).offset(q.offset ?? 0);
  const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(fleetWaybills).innerJoin(fleetVehicles, eq(fleetVehicles.id, fleetWaybills.vehicleId)).innerJoin(members, eq(members.id, fleetWaybills.driverMemberId)).where(where);
  const filled = rows.length ? await db.select({ id: fleetFuelEntries.waybillId, s: sql<string>`sum(${fleetFuelEntries.liters})::text` }).from(fleetFuelEntries).where(inArray(fleetFuelEntries.waybillId, rows.map(r => r.w.id))).groupBy(fleetFuelEntries.waybillId) : [];
  const items = rows.map(r => {
    const f = filled.find(x => x.id === r.w.id)?.s ?? '0';
    return { ...r.w, plate: r.plate, driverName: r.driverName, fuelFilled: f, fuel: waybillFuel({ fuelOut: r.w.fuelOut, fuelBack: r.w.fuelBack, fuelFilled: f, odometerOut: r.w.odometerOut, odometerBack: r.w.odometerBack, normPer100: r.w.normPer100 }) };
  });
  return { items, total: n, limit: q.limit ?? 50, offset: q.offset ?? 0 };
}

export async function getWaybill(db: Db, id: string) {
  const w = await loadWaybill(db, id);
  const [r] = await db.select({ plate: fleetVehicles.plate, driverName: members.name }).from(fleetVehicles).innerJoin(members, eq(members.id, w.driverMemberId)).where(eq(fleetVehicles.id, w.vehicleId)).limit(1);
  const fuelEntries = await db.select().from(fleetFuelEntries).where(eq(fleetFuelEntries.waybillId, id)).orderBy(asc(fleetFuelEntries.date));
  return { ...(await waybillView(db, w)), plate: r?.plate ?? '', driverName: r?.driverName ?? '', fuelEntries };
}

/** Создаёт путевой лист. Им же пользуется рейс (задача 1211): tripId связывает лист с рейсом */
export async function createWaybill(db: Db, ctx: DocCtx, input: WaybillInput): Promise<WaybillRow> {
  const v = await loadVehicle(db, input.vehicleId);
  if (v.archivedAt) throw new DomainError(422, 'vehicle_archived', 'The vehicle is archived');
  await assertMember(db, input.driverMemberId);
  const number = await nextNumber(db, ctx.workspaceId, 'fleet_waybills', 'ПЛ', input.date);
  const [org] = await db.select({ id: organizations.id }).from(organizations).where(isNull(organizations.archivedAt)).orderBy(desc(organizations.isDefault), asc(organizations.createdAt)).limit(1);
  const norm = fuelNormPer100({ summer: v.fuelNormSummer, winter: v.fuelNormWinter }, input.date);
  const [row] = await db
    .insert(fleetWaybills)
    .values({
      workspaceId: ctx.workspaceId,
      number,
      date: input.date,
      vehicleId: input.vehicleId,
      driverMemberId: input.driverMemberId,
      tripId: input.tripId ?? null,
      organizationId: org?.id ?? null,
      route: input.route ?? '',
      departureAt: dt(input.departureAt),
      returnAt: dt(input.returnAt),
      odometerOut: input.odometerOut ?? v.odometer,
      fuelOut: input.fuelOut ?? '0',
      normPer100: norm,
      medicalOk: input.medicalOk ?? false,
      medicalTime: input.medicalTime ?? '',
      medicalBy: input.medicalBy ?? '',
      techOk: input.techOk ?? false,
      techTime: input.techTime ?? '',
      techBy: input.techBy ?? '',
      comment: input.comment ?? '',
    })
    .returning();
  await event(db, ctx, 'fleet_waybill', 'created', row!.id, { number });
  return row!;
}

export async function updateWaybill(db: Db, ctx: DocCtx, id: string, input: Partial<WaybillInput>): Promise<WaybillRow> {
  const cur = await loadWaybill(db, id, true);
  if (cur.status === 'closed' || cur.status === 'cancelled') throw new DomainError(409, 'waybill_closed', 'A closed or cancelled waybill cannot be changed');
  const set: Partial<typeof fleetWaybills.$inferInsert> = { updatedAt: new Date() };
  for (const k of ['route', 'odometerOut', 'fuelOut', 'odometerBack', 'fuelBack', 'medicalOk', 'medicalTime', 'medicalBy', 'techOk', 'techTime', 'techBy', 'tripId', 'comment'] as const) if (input[k] !== undefined) (set as Record<string, unknown>)[k] = input[k];
  if (input.departureAt !== undefined) set.departureAt = dt(input.departureAt);
  if (input.returnAt !== undefined) set.returnAt = dt(input.returnAt);
  if (cur.status === 'draft') {
    if (input.vehicleId && input.vehicleId !== cur.vehicleId) await loadVehicle(db, input.vehicleId);
    if (input.driverMemberId) await assertMember(db, input.driverMemberId);
    if (input.vehicleId) set.vehicleId = input.vehicleId;
    if (input.driverMemberId) set.driverMemberId = input.driverMemberId;
    if (input.date) set.date = input.date;
    if (input.vehicleId || input.date) {
      const v = await loadVehicle(db, input.vehicleId ?? cur.vehicleId);
      set.normPer100 = fuelNormPer100({ summer: v.fuelNormSummer, winter: v.fuelNormWinter }, input.date ?? cur.date);
    }
  } else if (input.vehicleId || input.driverMemberId || input.date) throw new DomainError(409, 'waybill_not_draft', 'The vehicle, driver and date can be changed in a draft only');
  const odoOut = set.odometerOut ?? cur.odometerOut;
  const odoBack = set.odometerBack === undefined ? cur.odometerBack : set.odometerBack;
  if (odoBack !== null && odoBack !== undefined && dec(odoBack) < dec(odoOut)) throw new DomainError(422, 'waybill_odometer', 'The odometer on return is below the odometer on departure');
  const [row] = await db.update(fleetWaybills).set(set).where(eq(fleetWaybills.id, id)).returning();
  await event(db, ctx, 'fleet_waybill', 'updated', id, { changes: Object.keys(input) });
  return row!;
}

/** Выдача путевого листа: отметки медосмотра и техконтроля обязательны; просроченные ОСАГО машины и права водителя не допускаются */
export async function issueWaybill(db: Db, ctx: DocCtx, id: string): Promise<WaybillRow> {
  const w = await loadWaybill(db, id, true);
  if (w.status !== 'draft') throw new DomainError(409, 'invalid_status', 'Only a draft waybill can be issued');
  if (!w.medicalOk || !w.techOk) throw new DomainError(422, 'waybill_checks_required', 'Record the medical check and the technical check before issuing the waybill');
  const docs = await db
    .select()
    .from(fleetDocuments)
    .where(and(isNull(fleetDocuments.archivedAt), or(eq(fleetDocuments.vehicleId, w.vehicleId), eq(fleetDocuments.memberId, w.driverMemberId))));
  const expired = docs.filter(d => {
    const blocking = d.ownerKind === 'vehicle' ? WAYBILL_BLOCKING_DOCS.vehicle : WAYBILL_BLOCKING_DOCS.driver;
    return blocking.includes(d.kind as FleetDocKind) && d.validUntil !== null && d.validUntil < w.date;
  });
  // документ с датой позже уже есть (продлили) — просрочка снимается
  const stillBad = expired.filter(e => !docs.some(d => d.id !== e.id && d.kind === e.kind && d.ownerKind === e.ownerKind && (d.vehicleId === e.vehicleId && d.memberId === e.memberId) && (d.validUntil === null || d.validUntil >= w.date)));
  if (stillBad.length) throw new DomainError(422, 'fleet_document_expired', 'A required document has expired', { documents: stillBad.map(d => ({ id: d.id, kind: d.kind, validUntil: d.validUntil })) });
  const [row] = await db.update(fleetWaybills).set({ status: 'issued', issuedAt: new Date(), updatedAt: new Date() }).where(eq(fleetWaybills.id, id)).returning();
  await event(db, ctx, 'fleet_waybill', 'issued', id, { number: w.number });
  return row!;
}

/** Закрытие: расчёт пробега, нормы и факта; пробег машины обновляется */
export async function closeWaybill(db: Db, ctx: DocCtx, id: string): Promise<WaybillRow> {
  const w = await loadWaybill(db, id, true);
  if (w.status !== 'issued') throw new DomainError(409, 'invalid_status', 'Only an issued waybill can be closed');
  if (w.odometerBack === null || w.fuelBack === null) throw new DomainError(422, 'waybill_return_required', 'Enter the odometer and the fuel on return');
  const filled = await filledLiters(db, id);
  const f = waybillFuel({ fuelOut: w.fuelOut, fuelBack: w.fuelBack, fuelFilled: filled, odometerOut: w.odometerOut, odometerBack: w.odometerBack, normPer100: w.normPer100 });
  if (!f) throw new DomainError(422, 'waybill_odometer', 'The odometer on return is below the odometer on departure');
  const [row] = await db.update(fleetWaybills).set({ status: 'closed', closedAt: new Date(), distanceKm: f.distanceKm, normLiters: f.normLiters, actualLiters: f.actualLiters, updatedAt: new Date() }).where(eq(fleetWaybills.id, id)).returning();
  await db.update(fleetVehicles).set({ odometer: sql`greatest(${fleetVehicles.odometer}, ${w.odometerBack})`, updatedAt: new Date() }).where(eq(fleetVehicles.id, w.vehicleId));
  await event(db, ctx, 'fleet_waybill', 'closed', id, { number: w.number, distanceKm: f.distanceKm, deltaLiters: f.deltaLiters });
  return row!;
}

export async function cancelWaybill(db: Db, ctx: DocCtx, id: string): Promise<WaybillRow> {
  const w = await loadWaybill(db, id, true);
  if (w.status !== 'draft' && w.status !== 'issued') throw new DomainError(409, 'invalid_status', 'Only a draft or issued waybill can be cancelled');
  const [row] = await db.update(fleetWaybills).set({ status: 'cancelled', updatedAt: new Date() }).where(eq(fleetWaybills.id, id)).returning();
  await event(db, ctx, 'fleet_waybill', 'cancelled', id, { number: w.number });
  return row!;
}

export async function deleteWaybill(db: Db, ctx: DocCtx, id: string): Promise<void> {
  const w = await loadWaybill(db, id, true);
  if (w.status !== 'draft') throw new DomainError(409, 'waybill_not_draft', 'Only a draft waybill can be deleted');
  await db.delete(fleetWaybills).where(eq(fleetWaybills.id, id));
  await event(db, ctx, 'fleet_waybill', 'deleted', id, { number: w.number });
}

const KIND_RU: Record<string, string> = { car: 'легковой', van: 'фургон', truck: 'грузовой', tractor: 'тягач', trailer: 'прицеп', special: 'спецтехника', misc: 'прочее' };
const FUEL_RU: Record<string, string> = { petrol: 'бензин', diesel: 'дизельное топливо', gas: 'газ', electric: 'электричество' };
const hhmm = (d: Date | null) => (d ? `${d.toISOString().slice(0, 10).split('-').reverse().join('.')} ${d.toISOString().slice(11, 16)}` : '');

/** Данные печатной формы путевого листа */
export async function waybillPrintData(db: Db, id: string): Promise<WaybillPrintData> {
  const w = await getWaybill(db, id);
  const v = await loadVehicle(db, w.vehicleId);
  const [org] = w.organizationId ? await db.select().from(organizations).where(eq(organizations.id, w.organizationId)).limit(1) : [];
  const prof = await driverProfile(db, w.driverMemberId);
  const f = w.fuel;
  const normLiters = w.normLiters ?? f?.normLiters ?? '';
  const orgAny = org as unknown as { fullName?: string; name?: string; legalAddress?: string; address?: string } | undefined;
  return {
    number: w.number,
    date: w.date,
    organization: orgAny?.fullName || orgAny?.name || '',
    organizationAddress: orgAny?.legalAddress || orgAny?.address || '',
    vehicle: { plate: v.plate, model: [v.make, v.model].filter(Boolean).join(' ') || v.name, kind: KIND_RU[v.kind] ?? v.kind },
    driver: { name: w.driverName, licenseNumber: prof?.licenseNumber ?? '' },
    route: w.route,
    departureAt: hhmm(w.departureAt),
    returnAt: hhmm(w.returnAt),
    odometerOut: fmt(dec(w.odometerOut), 0),
    odometerBack: w.odometerBack === null ? '' : fmt(dec(w.odometerBack), 0),
    distanceKm: f ? fmt(dec(f.distanceKm), 0) : '',
    fuelType: FUEL_RU[v.fuelType] ?? v.fuelType,
    fuelOut: fmt(dec(w.fuelOut), 1),
    fuelFilled: fmt(dec(w.fuelFilled), 1),
    fuelBack: w.fuelBack === null ? '' : fmt(dec(w.fuelBack), 1),
    normPer100: fmt(dec(w.normPer100), 1),
    normLiters: normLiters ? fmt(dec(normLiters), 1) : '',
    actualLiters: f ? fmt(dec(f.actualLiters), 1) : '',
    medical: { ok: w.medicalOk, time: w.medicalTime, by: w.medicalBy },
    tech: { ok: w.techOk, time: w.techTime, by: w.techBy },
    comment: w.comment,
  };
}

/* ---------------- топливо ---------------- */

export async function listFuelCards(db: Db) {
  const rows = await db.select({ c: fleetFuelCards, plate: fleetVehicles.plate }).from(fleetFuelCards).leftJoin(fleetVehicles, eq(fleetVehicles.id, fleetFuelCards.vehicleId)).where(isNull(fleetFuelCards.archivedAt)).orderBy(asc(fleetFuelCards.number));
  return rows.map(r => ({ ...r.c, plate: r.plate ?? null }));
}
export async function saveFuelCard(db: Db, ctx: DocCtx, id: string | null, input: { number?: string; name?: string; vehicleId?: string | null }) {
  if (input.vehicleId) await loadVehicle(db, input.vehicleId);
  if (!id) {
    const [row] = await db.insert(fleetFuelCards).values({ workspaceId: ctx.workspaceId, number: input.number ?? '', name: input.name ?? '', vehicleId: input.vehicleId ?? null }).returning();
    await event(db, ctx, 'fleet_fuel_card', 'created', row!.id);
    return row!;
  }
  const [row] = await db.update(fleetFuelCards).set({ ...input, updatedAt: new Date() }).where(eq(fleetFuelCards.id, id)).returning();
  if (!row) throw notFound('fuel card');
  await event(db, ctx, 'fleet_fuel_card', 'updated', id);
  return row;
}
export async function archiveFuelCard(db: Db, ctx: DocCtx, id: string) {
  const [row] = await db.update(fleetFuelCards).set({ archivedAt: new Date() }).where(eq(fleetFuelCards.id, id)).returning({ id: fleetFuelCards.id });
  if (!row) throw notFound('fuel card');
  await event(db, ctx, 'fleet_fuel_card', 'archived', id);
}

export interface FuelEntryInput {
  vehicleId: string;
  cardId?: string | null;
  waybillId?: string | null;
  date: string;
  liters: string;
  amount: string;
  odometer?: string | null;
  station?: string;
  comment?: string;
}

/** Путевой лист машины на дату заправки: выданный или закрытый, дата попадает в его период */
async function waybillOn(db: Db, vehicleId: string, date: string): Promise<WaybillRow | null> {
  const [w] = await db
    .select()
    .from(fleetWaybills)
    .where(and(eq(fleetWaybills.vehicleId, vehicleId), inArray(fleetWaybills.status, ['issued', 'closed']), lte(fleetWaybills.date, date), sql`coalesce(${fleetWaybills.returnAt}::date, ${fleetWaybills.date}) >= ${date}::date`))
    .orderBy(desc(fleetWaybills.date))
    .limit(1);
  return w ?? null;
}

async function insertFuel(db: Db, ctx: DocCtx, input: FuelEntryInput, extra: { source: 'manual' | 'csv'; externalKey?: string | null }): Promise<FuelEntryRow> {
  await assertPeriodOpen(db, ctx.workspaceId, input.date);
  const v = await loadVehicle(db, input.vehicleId);
  let waybillId = input.waybillId ?? null;
  if (waybillId) {
    const w = await loadWaybill(db, waybillId);
    if (w.vehicleId !== input.vehicleId) throw new DomainError(422, 'invalid_reference', 'The waybill belongs to another vehicle');
  } else waybillId = (await waybillOn(db, input.vehicleId, input.date))?.id ?? null;
  const [row] = await db
    .insert(fleetFuelEntries)
    .values({ workspaceId: ctx.workspaceId, vehicleId: input.vehicleId, cardId: input.cardId ?? null, waybillId, date: input.date, liters: input.liters, amount: input.amount, odometer: input.odometer ?? null, station: input.station ?? '', comment: input.comment ?? '', source: extra.source, externalKey: extra.externalKey ?? null, expenseCostItemId: await costItemId(db, ctx.workspaceId, FLEET_FUEL_COST_KEY) })
    .returning();
  if (input.odometer && dec(input.odometer) > dec(v.odometer)) await db.update(fleetVehicles).set({ odometer: input.odometer, updatedAt: new Date() }).where(eq(fleetVehicles.id, v.id));
  await event(db, ctx, 'fleet_fuel', 'created', row!.id, { vehicleId: input.vehicleId, liters: input.liters });
  return row!;
}

export const createFuelEntry = (db: Db, ctx: DocCtx, input: FuelEntryInput) => insertFuel(db, ctx, input, { source: 'manual' });

export async function updateFuelEntry(db: Db, ctx: DocCtx, id: string, input: Partial<FuelEntryInput>): Promise<FuelEntryRow> {
  const [cur] = await db.select().from(fleetFuelEntries).where(eq(fleetFuelEntries.id, id)).limit(1);
  if (!cur) throw notFound('fuel entry');
  await assertPeriodOpen(db, ctx.workspaceId, cur.date);
  if (input.date) await assertPeriodOpen(db, ctx.workspaceId, input.date);
  if (input.vehicleId) await loadVehicle(db, input.vehicleId);
  const [row] = await db.update(fleetFuelEntries).set({ ...input, updatedAt: new Date() }).where(eq(fleetFuelEntries.id, id)).returning();
  await event(db, ctx, 'fleet_fuel', 'updated', id, { changes: Object.keys(input) });
  return row!;
}

export async function deleteFuelEntry(db: Db, ctx: DocCtx, id: string): Promise<void> {
  const [cur] = await db.select().from(fleetFuelEntries).where(eq(fleetFuelEntries.id, id)).limit(1);
  if (!cur) throw notFound('fuel entry');
  await assertPeriodOpen(db, ctx.workspaceId, cur.date);
  await db.delete(fleetFuelEntries).where(eq(fleetFuelEntries.id, id));
  await event(db, ctx, 'fleet_fuel', 'deleted', id);
}

export async function listFuelEntries(db: Db, q: { from?: string; to?: string; vehicleId?: string; waybillId?: string; limit?: number; offset?: number }) {
  const where = and(q.from ? gte(fleetFuelEntries.date, q.from) : undefined, q.to ? lte(fleetFuelEntries.date, q.to) : undefined, q.vehicleId ? eq(fleetFuelEntries.vehicleId, q.vehicleId) : undefined, q.waybillId ? eq(fleetFuelEntries.waybillId, q.waybillId) : undefined);
  const rows = await db
    .select({ e: fleetFuelEntries, plate: fleetVehicles.plate, card: fleetFuelCards.number, waybill: fleetWaybills.number })
    .from(fleetFuelEntries)
    .innerJoin(fleetVehicles, eq(fleetVehicles.id, fleetFuelEntries.vehicleId))
    .leftJoin(fleetFuelCards, eq(fleetFuelCards.id, fleetFuelEntries.cardId))
    .leftJoin(fleetWaybills, eq(fleetWaybills.id, fleetFuelEntries.waybillId))
    .where(where)
    .orderBy(desc(fleetFuelEntries.date), desc(fleetFuelEntries.createdAt))
    .limit(q.limit ?? 50)
    .offset(q.offset ?? 0);
  const [tot] = await db.select({ n: sql<number>`count(*)::int`, liters: sql<string>`coalesce(sum(${fleetFuelEntries.liters}),0)::text`, amount: sql<string>`coalesce(sum(${fleetFuelEntries.amount}),0)::text` }).from(fleetFuelEntries).where(where);
  return { items: rows.map(r => ({ ...r.e, plate: r.plate, card: r.card ?? null, waybillNumber: r.waybill ?? null })), total: tot?.n ?? 0, totals: { liters: tot?.liters ?? '0', amount: tot?.amount ?? '0' }, limit: q.limit ?? 50, offset: q.offset ?? 0 };
}

export interface FuelImportResult {
  rows: (Omit<FuelCsvRow, 'error'> & { status: 'created' | 'duplicate' | 'error'; error?: string })[];
  created: number;
  duplicates: number;
  errors: number;
}

/** Загрузка выписки топливной карты: машина — по номеру карты, иначе по госномеру; повторная загрузка тех же строк дублей не создаёт */
export async function importFuelCsv(db: Db, ctx: DocCtx, csv: string, dryRun = false): Promise<FuelImportResult> {
  const parsed = parseFuelCsv(csv);
  const cards = await db.select().from(fleetFuelCards);
  const vehicles = await db.select({ id: fleetVehicles.id, plate: fleetVehicles.plate }).from(fleetVehicles);
  const norm = (s: string) => s.replace(/\s/g, '').toLowerCase();
  const out: FuelImportResult = { rows: [], created: 0, duplicates: 0, errors: 0 };
  for (const r of parsed) {
    if (r.error) {
      out.rows.push({ ...r, status: 'error', error: r.error });
      out.errors++;
      continue;
    }
    const card = r.card ? cards.find(c => norm(c.number) === norm(r.card)) : undefined;
    const vehicleId = card?.vehicleId ?? vehicles.find(v => r.plate && norm(v.plate) === norm(r.plate))?.id;
    if (!vehicleId) {
      out.rows.push({ ...r, status: 'error', error: 'vehicle_not_found' });
      out.errors++;
      continue;
    }
    const key = `csv:${norm(r.card || r.plate)}:${r.date}:${dec(r.liters)}:${dec(r.amount)}`;
    const [dup] = await db.select({ id: fleetFuelEntries.id }).from(fleetFuelEntries).where(eq(fleetFuelEntries.externalKey, key)).limit(1);
    if (dup) {
      out.rows.push({ ...r, status: 'duplicate' });
      out.duplicates++;
      continue;
    }
    if (!dryRun) {
      try {
        await insertFuel(db, ctx, { vehicleId, cardId: card?.id ?? null, date: r.date, liters: r.liters, amount: r.amount, odometer: r.odometer, station: r.station }, { source: 'csv', externalKey: key });
      } catch (e) {
        // доменная ошибка строки (например, закрытый период) не откатывает остальные строки: до записи SQL-ошибок не было
        if (e instanceof DomainError) {
          out.rows.push({ ...r, status: 'error', error: e.code });
          out.errors++;
          continue;
        }
        throw e;
      }
    }
    out.rows.push({ ...r, status: 'created' });
    out.created++;
  }
  return out;
}

/* ---------------- регламент ТО ---------------- */

export interface ServicePlanInput {
  vehicleId: string;
  name: string;
  everyKm?: number | null;
  everyMonths?: number | null;
  lastKm?: string | null;
  lastDate?: string | null;
}

export async function listServicePlans(db: Db, vehicleId?: string) {
  const rows = await db
    .select({ p: fleetServicePlans, plate: fleetVehicles.plate, odometer: fleetVehicles.odometer })
    .from(fleetServicePlans)
    .innerJoin(fleetVehicles, eq(fleetVehicles.id, fleetServicePlans.vehicleId))
    .where(and(isNull(fleetServicePlans.archivedAt), vehicleId ? eq(fleetServicePlans.vehicleId, vehicleId) : undefined))
    .orderBy(asc(fleetVehicles.plate), asc(fleetServicePlans.name));
  const now = today();
  return rows.map(r => ({ ...r.p, plate: r.plate, odometer: r.odometer, due: serviceDue({ everyKm: r.p.everyKm, everyMonths: r.p.everyMonths, lastKm: r.p.lastKm, lastDate: r.p.lastDate }, r.odometer, now) }));
}

export async function createServicePlan(db: Db, ctx: DocCtx, input: ServicePlanInput) {
  await loadVehicle(db, input.vehicleId);
  if (!input.everyKm && !input.everyMonths) throw new DomainError(422, 'service_interval_required', 'Set the interval in km or months');
  const [row] = await db.insert(fleetServicePlans).values({ workspaceId: ctx.workspaceId, ...input }).returning();
  await event(db, ctx, 'fleet_service_plan', 'created', row!.id);
  return row!;
}
export async function updateServicePlan(db: Db, ctx: DocCtx, id: string, input: Partial<ServicePlanInput>) {
  const [row] = await db.update(fleetServicePlans).set({ ...input, updatedAt: new Date() }).where(eq(fleetServicePlans.id, id)).returning();
  if (!row) throw notFound('service plan');
  await event(db, ctx, 'fleet_service_plan', 'updated', id);
  return row;
}
export async function archiveServicePlan(db: Db, ctx: DocCtx, id: string) {
  const [row] = await db.update(fleetServicePlans).set({ archivedAt: new Date() }).where(eq(fleetServicePlans.id, id)).returning({ id: fleetServicePlans.id });
  if (!row) throw notFound('service plan');
  await event(db, ctx, 'fleet_service_plan', 'archived', id);
}

/* ---------------- ТО и ремонты ---------------- */

export interface RepairLineInput {
  kind: 'part' | 'work';
  productId?: string | null;
  name: string;
  qty?: string;
  price?: string;
}
export interface RepairInput {
  vehicleId: string;
  kind?: 'maintenance' | 'repair';
  date: string;
  odometer?: string | null;
  planId?: string | null;
  warehouseId?: string | null;
  contractorId?: string | null;
  description?: string;
  lines?: RepairLineInput[];
}

async function loadRepair(db: Db, id: string, lock = false): Promise<RepairRow> {
  const q = db.select().from(fleetRepairs).where(eq(fleetRepairs.id, id)).limit(1);
  const [row] = await (lock ? q.for('update') : q);
  if (!row) throw notFound('repair');
  return row;
}

async function writeRepairLines(db: Db, ws: string, repairId: string, lines: RepairLineInput[]): Promise<void> {
  await db.delete(fleetRepairLines).where(eq(fleetRepairLines.repairId, repairId));
  if (!lines.length) return;
  const ids = lines.map(l => l.productId).filter((x): x is string => !!x);
  if (ids.length) {
    const have = await db.select({ id: products.id }).from(products).where(inArray(products.id, ids));
    if (have.length !== new Set(ids).size) throw new DomainError(422, 'invalid_reference', 'The product does not exist');
  }
  if (lines.some(l => l.kind === 'work' && l.productId)) throw new DomainError(422, 'repair_work_product', 'A work line cannot take a product from the warehouse');
  await db.insert(fleetRepairLines).values(lines.map((l, i) => ({ workspaceId: ws, repairId, kind: l.kind, productId: l.productId ?? null, name: l.name, qty: l.qty ?? '1', price: l.price ?? '0', sortOrder: i })));
}

export async function listRepairs(db: Db, q: { from?: string; to?: string; vehicleId?: string; kind?: 'maintenance' | 'repair'; status?: RepairRow['status']; q?: string; limit?: number; offset?: number }) {
  const where = and(q.from ? gte(fleetRepairs.date, q.from) : undefined, q.to ? lte(fleetRepairs.date, q.to) : undefined, q.vehicleId ? eq(fleetRepairs.vehicleId, q.vehicleId) : undefined, q.kind ? eq(fleetRepairs.kind, q.kind) : undefined, q.status ? eq(fleetRepairs.status, q.status) : undefined, q.q ? or(sql`${fleetRepairs.number} ilike ${like(q.q)}`, sql`${fleetRepairs.description} ilike ${like(q.q)}`, sql`${fleetVehicles.plate} ilike ${like(q.q)}`) : undefined);
  const rows = await db.select({ r: fleetRepairs, plate: fleetVehicles.plate }).from(fleetRepairs).innerJoin(fleetVehicles, eq(fleetVehicles.id, fleetRepairs.vehicleId)).where(where).orderBy(desc(fleetRepairs.date), desc(fleetRepairs.number)).limit(q.limit ?? 50).offset(q.offset ?? 0);
  const [tot] = await db.select({ n: sql<number>`count(*)::int` }).from(fleetRepairs).innerJoin(fleetVehicles, eq(fleetVehicles.id, fleetRepairs.vehicleId)).where(where);
  return { items: rows.map(r => ({ ...r.r, plate: r.plate })), total: tot?.n ?? 0, limit: q.limit ?? 50, offset: q.offset ?? 0 };
}

export async function getRepair(db: Db, id: string) {
  const r = await loadRepair(db, id);
  const lines = await db.select().from(fleetRepairLines).where(eq(fleetRepairLines.repairId, id)).orderBy(asc(fleetRepairLines.sortOrder));
  const [v] = await db.select({ plate: fleetVehicles.plate }).from(fleetVehicles).where(eq(fleetVehicles.id, r.vehicleId)).limit(1);
  return { ...r, plate: v?.plate ?? '', lines };
}

async function assertRepairRefs(db: Db, input: Partial<RepairInput>) {
  if (input.vehicleId) await loadVehicle(db, input.vehicleId);
  if (input.warehouseId) {
    const [w] = await db.select({ id: warehouses.id }).from(warehouses).where(eq(warehouses.id, input.warehouseId)).limit(1);
    if (!w) throw new DomainError(422, 'invalid_reference', 'The warehouse does not exist');
  }
  if (input.contractorId) {
    const [c] = await db.select({ id: companies.id }).from(companies).where(eq(companies.id, input.contractorId)).limit(1);
    if (!c) throw new DomainError(422, 'invalid_reference', 'The contractor does not exist');
  }
  if (input.planId) {
    const [p] = await db.select({ id: fleetServicePlans.id, vehicleId: fleetServicePlans.vehicleId }).from(fleetServicePlans).where(eq(fleetServicePlans.id, input.planId)).limit(1);
    if (!p || (input.vehicleId && p.vehicleId !== input.vehicleId)) throw new DomainError(422, 'invalid_reference', 'The service plan does not belong to the vehicle');
  }
}

export async function createRepair(db: Db, ctx: DocCtx, input: RepairInput): Promise<RepairRow> {
  await assertRepairRefs(db, input);
  const number = await nextNumber(db, ctx.workspaceId, 'fleet_repairs', 'РМ', input.date);
  const [row] = await db
    .insert(fleetRepairs)
    .values({ workspaceId: ctx.workspaceId, number, kind: input.kind ?? 'repair', vehicleId: input.vehicleId, date: input.date, odometer: input.odometer ?? null, planId: input.planId ?? null, warehouseId: input.warehouseId ?? null, contractorId: input.contractorId ?? null, description: input.description ?? '' })
    .returning();
  await writeRepairLines(db, ctx.workspaceId, row!.id, input.lines ?? []);
  await event(db, ctx, 'fleet_repair', 'created', row!.id, { number });
  return row!;
}

export async function updateRepair(db: Db, ctx: DocCtx, id: string, input: Partial<RepairInput>): Promise<RepairRow> {
  const cur = await loadRepair(db, id, true);
  if (cur.status !== 'draft') throw new DomainError(409, 'repair_not_draft', 'Unpost the repair before changing it');
  await assertRepairRefs(db, { ...input, vehicleId: input.vehicleId ?? cur.vehicleId });
  const { lines, ...head } = input;
  const [row] = await db.update(fleetRepairs).set({ ...head, updatedAt: new Date() }).where(eq(fleetRepairs.id, id)).returning();
  if (lines) await writeRepairLines(db, ctx.workspaceId, id, lines);
  await event(db, ctx, 'fleet_repair', 'updated', id, { changes: Object.keys(input) });
  return row!;
}

export async function deleteRepair(db: Db, ctx: DocCtx, id: string): Promise<void> {
  const r = await loadRepair(db, id, true);
  if (r.status !== 'draft') throw new DomainError(409, 'repair_not_draft', 'Only a draft repair can be deleted');
  await db.delete(fleetRepairs).where(eq(fleetRepairs.id, id));
  await event(db, ctx, 'fleet_repair', 'deleted', id, { number: r.number });
}

/** Проведение: запчасти со склада списывает обычный документ «Списание» со статьёй «Ремонт и ТО транспорта»; работы и купленные запчасти —
    прямой расход на ту же статью (сумма хранится в ремонте). ТО по регламенту отмечает пункт выполненным и обновляет пробег */
export async function postRepair(db: Db, ctx: DocCtx, id: string): Promise<RepairRow> {
  const r = await loadRepair(db, id, true);
  if (r.status !== 'draft') throw new DomainError(409, 'invalid_status', 'Only a draft repair can be posted');
  await assertPeriodOpen(db, ctx.workspaceId, r.date);
  const lines = await db.select().from(fleetRepairLines).where(eq(fleetRepairLines.repairId, id)).orderBy(asc(fleetRepairLines.sortOrder));
  const stockLines = lines.filter(l => l.productId);
  const itemId = await costItemId(db, ctx.workspaceId, FLEET_REPAIR_COST_KEY);
  let writeOffId: string | null = null;
  let partsCost = '0';
  if (stockLines.length) {
    if (!r.warehouseId) throw new DomainError(422, 'warehouse_required', 'Select the warehouse the parts are taken from');
    writeOffId = await createDocument(db, ctx, { type: 'write_off', warehouseId: r.warehouseId, costItemId: itemId, date: r.date, comment: `Ремонт ${r.number}`, lines: stockLines.map(l => ({ productId: l.productId!, qty: l.qty, price: '0', discountPct: '0' })) });
    await postDocument(db, ctx, writeOffId);
    const [c] = await db.select({ s: sql<string>`coalesce(sum(-${stockMoves.qty} * ${stockMoves.cost}), 0)::text` }).from(stockMoves).where(and(eq(stockMoves.documentId, writeOffId), sql`${stockMoves.qty} < 0`));
    partsCost = fmt(dec(c?.s ?? '0'), 2);
  }
  const direct = lines.filter(l => !l.productId).reduce((s, l) => s + mul(dec(l.qty), dec(l.price)), 0n);
  const [row] = await db.update(fleetRepairs).set({ status: 'posted', postedAt: new Date(), writeOffDocumentId: writeOffId, partsCost, directCost: fmt(direct, 2), expenseCostItemId: itemId, updatedAt: new Date() }).where(eq(fleetRepairs.id, id)).returning();
  const v = await loadVehicle(db, r.vehicleId, true);
  if (r.odometer && dec(r.odometer) > dec(v.odometer)) await db.update(fleetVehicles).set({ odometer: r.odometer, updatedAt: new Date() }).where(eq(fleetVehicles.id, v.id));
  if (r.planId) await db.update(fleetServicePlans).set({ lastKm: r.odometer ?? v.odometer, lastDate: r.date, updatedAt: new Date() }).where(eq(fleetServicePlans.id, r.planId));
  await event(db, ctx, 'fleet_repair', 'posted', id, { number: r.number, partsCost, directCost: fmt(direct, 2) });
  return row!;
}

export async function unpostRepair(db: Db, ctx: DocCtx, id: string): Promise<RepairRow> {
  const r = await loadRepair(db, id, true);
  if (r.status !== 'posted') throw new DomainError(409, 'invalid_status', 'Only a posted repair can be unposted');
  await assertPeriodOpen(db, ctx.workspaceId, r.date);
  if (r.writeOffDocumentId) {
    await unpostDocument(db, ctx, r.writeOffDocumentId);
    await cancelDocument(db, ctx, r.writeOffDocumentId);
  }
  const [row] = await db.update(fleetRepairs).set({ status: 'draft', postedAt: null, writeOffDocumentId: null, partsCost: '0', directCost: '0', updatedAt: new Date() }).where(eq(fleetRepairs.id, id)).returning();
  await event(db, ctx, 'fleet_repair', 'unposted', id, { number: r.number });
  return row!;
}

/* ---------------- штрафы ---------------- */

export interface FineInput {
  vehicleId: string;
  driverMemberId?: string | null;
  date: string;
  uin?: string;
  article?: string;
  amount: string;
  status?: 'unpaid' | 'paid' | 'appealed';
  paidOn?: string | null;
  chargeDriver?: boolean;
  comment?: string;
}

export async function listFines(db: Db, q: { from?: string; to?: string; vehicleId?: string; driverId?: string; status?: FineRow['status']; q?: string; limit?: number; offset?: number }) {
  const where = and(q.from ? gte(fleetFines.date, q.from) : undefined, q.to ? lte(fleetFines.date, q.to) : undefined, q.vehicleId ? eq(fleetFines.vehicleId, q.vehicleId) : undefined, q.driverId ? eq(fleetFines.driverMemberId, q.driverId) : undefined, q.status ? eq(fleetFines.status, q.status) : undefined, q.q ? or(sql`${fleetFines.uin} ilike ${like(q.q)}`, sql`${fleetFines.article} ilike ${like(q.q)}`, sql`${fleetVehicles.plate} ilike ${like(q.q)}`) : undefined);
  const rows = await db.select({ f: fleetFines, plate: fleetVehicles.plate, driverName: members.name, waybill: fleetWaybills.number }).from(fleetFines).innerJoin(fleetVehicles, eq(fleetVehicles.id, fleetFines.vehicleId)).leftJoin(members, eq(members.id, fleetFines.driverMemberId)).leftJoin(fleetWaybills, eq(fleetWaybills.id, fleetFines.waybillId)).where(where).orderBy(desc(fleetFines.date)).limit(q.limit ?? 50).offset(q.offset ?? 0);
  const [tot] = await db.select({ n: sql<number>`count(*)::int`, amount: sql<string>`coalesce(sum(${fleetFines.amount}),0)::text` }).from(fleetFines).innerJoin(fleetVehicles, eq(fleetVehicles.id, fleetFines.vehicleId)).where(where);
  return { items: rows.map(r => ({ ...r.f, plate: r.plate, driverName: r.driverName ?? null, waybillNumber: r.waybill ?? null })), total: tot?.n ?? 0, totals: { amount: tot?.amount ?? '0' }, limit: q.limit ?? 50, offset: q.offset ?? 0 };
}

async function fineExtras(db: Db, ctx: DocCtx, input: { vehicleId: string; date: string; driverMemberId?: string | null; status?: string; paidOn?: string | null }) {
  const w = await waybillOn(db, input.vehicleId, input.date);
  if (input.driverMemberId) await assertMember(db, input.driverMemberId);
  return {
    driverMemberId: input.driverMemberId ?? w?.driverMemberId ?? null,
    waybillId: w?.id ?? null,
    paidOn: input.status === 'paid' ? input.paidOn ?? today() : input.paidOn ?? null,
    expenseCostItemId: await costItemId(db, ctx.workspaceId, FLEET_FINE_COST_KEY),
  };
}

export async function createFine(db: Db, ctx: DocCtx, input: FineInput): Promise<FineRow> {
  await loadVehicle(db, input.vehicleId);
  const ex = await fineExtras(db, ctx, input);
  const [row] = await db.insert(fleetFines).values({ workspaceId: ctx.workspaceId, vehicleId: input.vehicleId, date: input.date, uin: input.uin ?? '', article: input.article ?? '', amount: input.amount, status: input.status ?? 'unpaid', chargeDriver: input.chargeDriver ?? false, comment: input.comment ?? '', ...ex }).returning();
  await event(db, ctx, 'fleet_fine', 'created', row!.id, { amount: input.amount });
  return row!;
}

export async function updateFine(db: Db, ctx: DocCtx, id: string, input: Partial<FineInput>): Promise<FineRow> {
  const [cur] = await db.select().from(fleetFines).where(eq(fleetFines.id, id)).limit(1);
  if (!cur) throw notFound('fine');
  const vehicleId = input.vehicleId ?? cur.vehicleId;
  if (input.vehicleId) await loadVehicle(db, input.vehicleId);
  const set: Partial<typeof fleetFines.$inferInsert> = { updatedAt: new Date() };
  for (const k of ['vehicleId', 'date', 'uin', 'article', 'amount', 'status', 'chargeDriver', 'comment', 'driverMemberId', 'paidOn'] as const) if (input[k] !== undefined) (set as Record<string, unknown>)[k] = input[k];
  if (input.status === 'paid' && !input.paidOn && !cur.paidOn) set.paidOn = today();
  if (input.status && input.status !== 'paid' && input.paidOn === undefined) set.paidOn = null;
  if (input.driverMemberId) await assertMember(db, input.driverMemberId);
  // водитель не задан вручную — переопределяем по листу, если изменились машина или дата
  if ((input.vehicleId || input.date) && input.driverMemberId === undefined) {
    const w = await waybillOn(db, vehicleId, input.date ?? cur.date);
    set.driverMemberId = w?.driverMemberId ?? null;
    set.waybillId = w?.id ?? null;
  }
  const [row] = await db.update(fleetFines).set(set).where(eq(fleetFines.id, id)).returning();
  await event(db, ctx, 'fleet_fine', 'updated', id, { changes: Object.keys(input) });
  return row!;
}

export async function deleteFine(db: Db, ctx: DocCtx, id: string): Promise<void> {
  const [row] = await db.delete(fleetFines).where(eq(fleetFines.id, id)).returning({ id: fleetFines.id });
  if (!row) throw notFound('fine');
  await event(db, ctx, 'fleet_fine', 'deleted', id);
}

/* ---------------- затраты и перерасход по машинам ---------------- */

export interface VehicleCostRow {
  vehicleId: string;
  plate: string;
  distanceKm: string;
  fuelLiters: string;
  fuelAmount: string;
  /** Факт минус норма по закрытым листам, л */
  fuelDeltaLiters: string;
  repairAmount: string;
  finesAmount: string;
  total: string;
  perKm: string | null;
}

export async function fleetCosts(db: Db, ctx: DocCtx, q: { from: string; to: string }): Promise<{ items: VehicleCostRow[]; totals: Omit<VehicleCostRow, 'vehicleId' | 'plate'> }> {
  if (!isAdmin(ctx.role)) throw new DomainError(403, 'forbidden', 'Fleet costs are visible to admins and owners');
  const vehicles = await db.select({ id: fleetVehicles.id, plate: fleetVehicles.plate }).from(fleetVehicles).orderBy(asc(fleetVehicles.plate));
  const fuel = await db.select({ id: fleetFuelEntries.vehicleId, l: sql<string>`sum(${fleetFuelEntries.liters})::text`, a: sql<string>`sum(${fleetFuelEntries.amount})::text` }).from(fleetFuelEntries).where(and(gte(fleetFuelEntries.date, q.from), lte(fleetFuelEntries.date, q.to))).groupBy(fleetFuelEntries.vehicleId);
  const rep = await db.select({ id: fleetRepairs.vehicleId, a: sql<string>`sum(${fleetRepairs.partsCost} + ${fleetRepairs.directCost})::text` }).from(fleetRepairs).where(and(eq(fleetRepairs.status, 'posted'), gte(fleetRepairs.date, q.from), lte(fleetRepairs.date, q.to))).groupBy(fleetRepairs.vehicleId);
  const fines = await db.select({ id: fleetFines.vehicleId, a: sql<string>`sum(${fleetFines.amount})::text` }).from(fleetFines).where(and(eq(fleetFines.status, 'paid'), eq(fleetFines.chargeDriver, false), gte(fleetFines.date, q.from), lte(fleetFines.date, q.to))).groupBy(fleetFines.vehicleId);
  const way = await db.select({ id: fleetWaybills.vehicleId, km: sql<string>`sum(${fleetWaybills.distanceKm})::text`, d: sql<string>`sum(${fleetWaybills.actualLiters} - ${fleetWaybills.normLiters})::text` }).from(fleetWaybills).where(and(eq(fleetWaybills.status, 'closed'), gte(fleetWaybills.date, q.from), lte(fleetWaybills.date, q.to))).groupBy(fleetWaybills.vehicleId);
  const items: VehicleCostRow[] = vehicles.map(v => {
    const f = fuel.find(x => x.id === v.id);
    const w = way.find(x => x.id === v.id);
    const fuelAmount = dec(f?.a ?? '0');
    const repairAmount = dec(rep.find(x => x.id === v.id)?.a ?? '0');
    const finesAmount = dec(fines.find(x => x.id === v.id)?.a ?? '0');
    const total = fuelAmount + repairAmount + finesAmount;
    const km = dec(w?.km ?? '0');
    return { vehicleId: v.id, plate: v.plate, distanceKm: fmt(km, 0), fuelLiters: fmt(dec(f?.l ?? '0'), 1), fuelAmount: fmt(fuelAmount, 2), fuelDeltaLiters: fmt(dec(w?.d ?? '0'), 1), repairAmount: fmt(repairAmount, 2), finesAmount: fmt(finesAmount, 2), total: fmt(total, 2), perKm: km > 0n ? fmt(div(total, km), 2) : null };
  });
  const sum = (k: 'distanceKm' | 'fuelLiters' | 'fuelAmount' | 'fuelDeltaLiters' | 'repairAmount' | 'finesAmount' | 'total') => items.reduce((s, i) => s + dec(i[k]), 0n);
  const km = sum('distanceKm');
  return { items, totals: { distanceKm: fmt(km, 0), fuelLiters: fmt(sum('fuelLiters'), 1), fuelAmount: fmt(sum('fuelAmount'), 2), fuelDeltaLiters: fmt(sum('fuelDeltaLiters'), 1), repairAmount: fmt(sum('repairAmount'), 2), finesAmount: fmt(sum('finesAmount'), 2), total: fmt(sum('total'), 2), perKm: null } };
}

/** Сводка для заголовка раздела: сколько документов просрочено/истекает и ТО пора делать */
export async function fleetSummary(db: Db) {
  const now = today();
  const docs = await db.select().from(fleetDocuments).where(isNull(fleetDocuments.archivedAt));
  const states = docs.map(d => docTermState(d.validUntil, d.remindDays, now).state);
  const plans = await listServicePlans(db);
  const [v] = await db.select({ n: sql<number>`count(*)::int` }).from(fleetVehicles).where(and(isNull(fleetVehicles.archivedAt), eq(fleetVehicles.status, 'active')));
  return { vehicles: v?.n ?? 0, docsExpired: states.filter(s => s === 'expired').length, docsExpiring: states.filter(s => s === 'expiring').length, serviceOverdue: plans.filter(p => p.due.overdue).length, serviceSoon: plans.filter(p => p.due.soon).length, today: now, soonDate: addDaysIso(now, 30) };
}
