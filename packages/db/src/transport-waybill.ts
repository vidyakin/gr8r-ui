/* Транспортная накладная (задача 1214; docs/architecture/trips.md, «Транспортная накладная»): номер ТН выдаётся один раз на область
   (рейс / точка рейса / доставка), печатная форма собирается из живых данных (shared/print/transport-waybill.ts). ЭТрН (ГИС ЭПД) не делаем. */
import { and, asc, desc, eq, isNull, ne, sql } from 'drizzle-orm';
import { dec, fmt, type TnCargoRow, type TnParty, type TransportWaybillPrintData } from '@gr8r/shared';
import type { Db } from './client';
import { DomainError } from './errors';
import { recordEvent } from './events';
import type { DocCtx } from './documents';
import {
  companies,
  deliveries,
  deliveryMethods,
  documentLines,
  documents,
  fleetDriverProfiles,
  fleetTripStops,
  fleetTrips,
  fleetVehicles,
  members,
  organizations,
  products,
  transportWaybills,
  units,
  warehouses,
} from './schema';

export type TransportWaybillRow = typeof transportWaybills.$inferSelect;

const notFound = (what: string) => new DomainError(404, 'not_found', `${what} not found`);

/** Следующий номер «ТН-00001»: сквозной по арендатору, под блокировкой */
async function nextTnNumber(db: Db, ws: string): Promise<string> {
  await db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`transport_waybills:${ws}`}, 0))`);
  const rows = await db.execute<{ n: number | null }>(sql`select max(substring(number from '[0-9]+$')::int) as n from transport_waybills where workspace_id = ${ws}`);
  return `ТН-${String((rows[0]?.n ?? 0) + 1).padStart(5, '0')}`;
}

export interface TnInput {
  tripId?: string;
  stopId?: string;
  deliveryId?: string;
}

/** Накладная области: есть — вернуть (тот же номер), нет — выдать номер. Область: точка рейса → доставка (в рейсе или без) → весь рейс */
export async function ensureTransportWaybill(db: Db, ctx: DocCtx, input: TnInput): Promise<TransportWaybillRow> {
  let { tripId, stopId, deliveryId } = input;
  if (stopId) {
    const [s] = await db.select().from(fleetTripStops).where(eq(fleetTripStops.id, stopId)).limit(1);
    if (!s) throw notFound('stop');
    tripId = s.tripId;
    deliveryId = s.deliveryId ?? undefined;
  } else if (deliveryId) {
    const [d] = await db.select({ id: deliveries.id }).from(deliveries).where(eq(deliveries.id, deliveryId)).limit(1);
    if (!d) throw notFound('delivery');
    const [s] = await db
      .select({ id: fleetTripStops.id, tripId: fleetTripStops.tripId })
      .from(fleetTripStops)
      .innerJoin(fleetTrips, eq(fleetTrips.id, fleetTripStops.tripId))
      .where(and(eq(fleetTripStops.deliveryId, deliveryId), ne(fleetTrips.status, 'cancelled'), tripId ? eq(fleetTrips.id, tripId) : undefined))
      .orderBy(desc(fleetTrips.dateFrom))
      .limit(1);
    if (tripId && !s) throw new DomainError(422, 'delivery_not_in_trip', 'The delivery is not in this trip');
    tripId = s?.tripId;
    stopId = s?.id;
  } else if (tripId) {
    const [t] = await db.select({ id: fleetTrips.id }).from(fleetTrips).where(eq(fleetTrips.id, tripId)).limit(1);
    if (!t) throw notFound('trip');
  } else {
    throw new DomainError(422, 'validation_error', 'tripId, stopId or deliveryId is required');
  }
  const number = await nextTnNumber(db, ctx.workspaceId); // берёт блокировку: параллельные запросы не выдадут два номера на одну область
  const [have] = await db
    .select()
    .from(transportWaybills)
    .where(
      and(
        tripId ? eq(transportWaybills.tripId, tripId) : isNull(transportWaybills.tripId),
        stopId ? eq(transportWaybills.stopId, stopId) : isNull(transportWaybills.stopId),
        deliveryId ? eq(transportWaybills.deliveryId, deliveryId) : isNull(transportWaybills.deliveryId),
      ),
    )
    .orderBy(asc(transportWaybills.createdAt))
    .limit(1);
  if (have) return have;
  const [row] = await db.insert(transportWaybills).values({ workspaceId: ctx.workspaceId, number, tripId: tripId ?? null, stopId: stopId ?? null, deliveryId: deliveryId ?? null, createdBy: ctx.memberId }).returning();
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'transport_waybill.created', entity: 'transport_waybill', recordId: row!.id, actorId: ctx.memberId, payload: { number } });
  return row!;
}

export async function getTransportWaybill(db: Db, id: string): Promise<TransportWaybillRow> {
  const [row] = await db.select().from(transportWaybills).where(eq(transportWaybills.id, id)).limit(1);
  if (!row) throw notFound('transport waybill');
  return row;
}

const DOC_RU: Record<string, string> = { customer_order: 'Заказ покупателя', invoice: 'Счёт', realization: 'Реализация (УПД)', act: 'Акт', work_order: 'Заказ-наряд' };
const emptyParty = (): TnParty => ({ name: '', inn: '', kpp: '', address: '', phone: '', contact: '' });

type Company = typeof companies.$inferSelect;
const companyParty = (c: Company, contact = ''): TnParty => ({ name: c.name, inn: c.inn, kpp: c.kpp, address: c.legalAddress || c.actualAddress || c.city, phone: '', contact });

/** Данные печатной формы: отправитель, получатель, груз, машина и водитель, перевозчик, стоимость */
export async function transportWaybillPrintData(db: Db, id: string): Promise<TransportWaybillPrintData> {
  const w = await getTransportWaybill(db, id);
  type Stop = typeof fleetTripStops.$inferSelect;
  let stops: Stop[] = [];
  let deliveryIds: string[] = [];
  if (w.deliveryId) {
    deliveryIds = [w.deliveryId];
    if (w.stopId) stops = await db.select().from(fleetTripStops).where(eq(fleetTripStops.id, w.stopId));
  } else if (w.stopId) {
    stops = await db.select().from(fleetTripStops).where(eq(fleetTripStops.id, w.stopId));
  } else if (w.tripId) {
    stops = await db.select().from(fleetTripStops).where(eq(fleetTripStops.tripId, w.tripId)).orderBy(asc(fleetTripStops.seq));
  }
  if (!w.deliveryId) deliveryIds = stops.flatMap(s => (s.deliveryId ? [s.deliveryId] : []));
  const [trip] = w.tripId ? await db.select().from(fleetTrips).where(eq(fleetTrips.id, w.tripId)).limit(1) : [];

  const unitRows = await db.select({ code: units.code, symbol: units.symbol }).from(units);
  const symbol = new Map(unitRows.map(u => [u.code, u.symbol]));
  const orgRows = await db.select().from(organizations).orderBy(asc(organizations.createdAt));

  const cargo: TnCargoRow[] = [];
  const docs: string[] = [];
  const consignees = new Map<string, TnParty & { place: string }>();
  let weight = 0n;
  let volume = 0n;
  let places = 0n;
  let price = 0n;
  let orgId: string | null = null;
  let loadingPlace = '';
  let carrierCompany: Company | null = null;
  let courierId: string | null = null;
  let loadingDate = trip?.dateFrom ?? '';

  for (const did of deliveryIds) {
    const [d] = await db.select().from(deliveries).where(eq(deliveries.id, did)).limit(1);
    if (!d) continue;
    const [doc] = await db.select().from(documents).where(eq(documents.id, d.documentId)).limit(1);
    const [co] = doc?.counterpartyId ? await db.select().from(companies).where(eq(companies.id, doc.counterpartyId)).limit(1) : [];
    const [wh] = doc?.warehouseId ? await db.select().from(warehouses).where(eq(warehouses.id, doc.warehouseId)).limit(1) : [];
    if (doc) {
      orgId ??= doc.organizationId;
      docs.push(`${DOC_RU[doc.type] ?? 'Документ'} № ${doc.number ?? ''} от ${doc.date.split('-').reverse().join('.')}`);
    }
    if (!loadingPlace && wh) loadingPlace = [wh.name, wh.address].filter(Boolean).join(', ');
    loadingDate ||= d.deliveryDate ?? '';
    const contact = [d.contactName, d.contactPhone].filter(Boolean).join(', ');
    const party = co ? companyParty(co, contact) : { ...emptyParty(), contact };
    const place = d.address || party.address;
    consignees.set(`${party.name}|${place}`, { ...party, place });
    const who = [party.name, place].filter(Boolean).join(', ');
    const lines = doc
      ? await db
          .select({ name: documentLines.name, qty: documentLines.qty, unitCode: documentLines.unitCode, weightKg: products.weightKg })
          .from(documentLines)
          .innerJoin(products, eq(products.id, documentLines.productId))
          .where(and(eq(documentLines.documentId, doc.id), eq(products.kind, 'goods')))
          .orderBy(asc(documentLines.sortOrder))
      : [];
    for (const l of lines) {
      const lw = l.weightKg ? dec(l.qty) * dec(l.weightKg) / 1_000_000n : null;
      const isPiece = l.unitCode === '796';
      if (isPiece) places += dec(l.qty);
      cargo.push({ name: `${l.name}, ${fmt(dec(l.qty), 3).replace(/\.?0+$/, '')} ${symbol.get(l.unitCode) ?? l.unitCode}`, places: isPiece ? fmt(dec(l.qty), 3).replace(/\.?0+$/, '') : '', weightKg: lw === null ? '' : fmt(lw, 3), volumeM3: '', consignee: who });
    }
    if (!lines.length) cargo.push({ name: doc ? `${DOC_RU[doc.type] ?? 'Документ'} № ${doc.number ?? ''}` : '', places: '', weightKg: '', volumeM3: '', consignee: who });
    weight += dec(d.weightKg);
    price += dec(d.price);
    if (!trip) {
      const [m] = d.methodId ? await db.select().from(deliveryMethods).where(eq(deliveryMethods.id, d.methodId)).limit(1) : [];
      const cid = d.carrierCompanyId ?? m?.carrierCompanyId ?? null;
      if (cid) carrierCompany = (await db.select().from(companies).where(eq(companies.id, cid)).limit(1))[0] ?? null;
      courierId = d.courierMemberId;
    }
  }
  for (const s of stops) {
    if (s.deliveryId) {
      volume += dec(s.volumeM3);
      continue;
    }
    if (s.kind === 'load') {
      loadingPlace ||= [s.title, s.address].filter(Boolean).join(', ');
      continue;
    }
    const party = { ...emptyParty(), name: s.title, address: s.address, contact: [s.contactName, s.contactPhone].filter(Boolean).join(', ') };
    consignees.set(`${party.name}|${s.address}`, { ...party, place: s.address });
    cargo.push({ name: s.comment || s.title || 'Груз', places: s.pallets > 0 ? `${s.pallets} пал.` : '', weightKg: dec(s.weightKg) > 0n ? fmt(dec(s.weightKg), 3) : '', volumeM3: dec(s.volumeM3) > 0n ? fmt(dec(s.volumeM3), 3) : '', consignee: [s.title, s.address].filter(Boolean).join(', ') });
    weight += dec(s.weightKg);
    volume += dec(s.volumeM3);
  }

  const org = orgRows.find(o => o.id === orgId) ?? orgRows[0];
  const orgParty: TnParty = org ? { name: org.fullName || org.name, inn: org.inn, kpp: org.kpp, address: org.legalAddress, phone: org.phone, contact: '' } : emptyParty();
  const list = [...consignees.values()];
  const only = list.length === 1 ? list[0]! : null;
  const consignee: TnParty | null = list.length > 1 ? null : only ? { name: only.name, inn: only.inn, kpp: only.kpp, address: only.address, phone: only.phone, contact: only.contact } : emptyParty();

  const [vehicle] = trip ? await db.select().from(fleetVehicles).where(eq(fleetVehicles.id, trip.vehicleId)).limit(1) : [];
  const driverIds = trip ? [trip.driverMemberId, ...(trip.coDriverMemberId ? [trip.coDriverMemberId] : [])] : courierId ? [courierId] : [];
  const drivers: { name: string; licenseNumber: string }[] = [];
  for (const mid of driverIds) {
    const [m] = await db.select({ name: members.name }).from(members).where(eq(members.id, mid)).limit(1);
    const [p] = await db.select({ n: fleetDriverProfiles.licenseNumber }).from(fleetDriverProfiles).where(eq(fleetDriverProfiles.memberId, mid)).limit(1);
    drivers.push({ name: m?.name ?? '', licenseNumber: p?.n ?? '' });
  }
  const only1 = list.length === 1;
  return {
    number: w.number,
    date: w.createdAt.toISOString().slice(0, 10),
    consignor: orgParty,
    loadingPlace,
    consignee,
    unloadingPlace: only1 ? only!.place : '',
    cargo,
    totals: { places: places > 0n ? fmt(places, 3).replace(/\.?0+$/, '') : '', weightKg: weight > 0n ? fmt(weight, 3) : '', volumeM3: volume > 0n ? fmt(volume, 3) : '' },
    documents: docs,
    loadingDate,
    carrier: carrierCompany ? companyParty(carrierCompany) : orgParty,
    vehicle: vehicle ? { plate: vehicle.plate, model: [vehicle.make, vehicle.model].filter(Boolean).join(' ') || vehicle.name, capacityKg: vehicle.capacityKg ? fmt(dec(vehicle.capacityKg), 0) : '' } : { plate: '', model: '', capacityKg: '' },
    drivers,
    price: price > 0n ? fmt(price, 2) : '',
    reference: trip ? `рейс ${trip.number}` : '',
    etrnStatus: w.etrnStatus,
  };
}
