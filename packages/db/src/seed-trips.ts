/* Демо рейсов (задача 1211): городской рейс на сегодня (в пути, первая доставка вручена), второй городской на вторую половину дня (план),
   междугородний на завтра и два дня после (Москва — Казань, ручные точки погрузки и выгрузки с координатами). Доставки — из сида доставок
   и ещё несколько на заказах покупателей без доставки. Всё — настоящими сервисами. */
import { and, asc, eq, inArray, ne, notExists, sql } from 'drizzle-orm';
import type { Db } from './client';
import { saveDelivery } from './delivery';
import type { DocCtx } from './documents';
import { updateWaybill } from './fleet';
import { addStop, createTrip, setStopStatus, startTrip } from './trips';
import { deliveries, deliveryMethods, documents, fleetTripStops, fleetWaybills } from './schema';

const iso = (daysAhead: number) => new Date(Date.now() + daysAhead * 864e5).toISOString().slice(0, 10);

export async function seedTrips(db: Db, ctx: DocCtx, o: { gazelId: string; mazId: string; transitId: string; driver1: string; driver2: string }) {
  const ws = ctx.workspaceId;
  const [method] = await db.select({ id: deliveryMethods.id }).from(deliveryMethods).where(and(eq(deliveryMethods.workspaceId, ws), eq(deliveryMethods.kind, 'own_courier'))).orderBy(asc(deliveryMethods.createdAt)).limit(1);
  // доставки без рейса: уже назначенная сегодня + свежие на заказах без доставки
  const free = await db
    .select({ id: deliveries.id })
    .from(deliveries)
    .where(and(eq(deliveries.workspaceId, ws), inArray(deliveries.status, ['new', 'assigned']), eq(deliveries.deliveryDate, iso(0))))
    .orderBy(asc(deliveries.createdAt));
  const orders = method
    ? await db
        .select({ id: documents.id })
        .from(documents)
        .where(and(eq(documents.workspaceId, ws), inArray(documents.type, ['customer_order', 'realization']), ne(documents.status, 'cancelled'), notExists(db.select({ x: sql`1` }).from(deliveries).where(eq(deliveries.documentId, documents.id)))))
        .orderBy(asc(documents.createdAt))
        .limit(5)
    : [];
  const fresh: string[] = [];
  const spots = [
    { address: 'Москва, Ленинградский пр-т, 39', window: ['09:00', '11:00'], weight: '320' },
    { address: 'Москва, ул. Тверская, 15', window: ['11:00', '13:00'], weight: '180' },
    { address: 'Москва, Варшавское ш., 125', window: ['15:00', '17:00'], weight: '410' },
    { address: 'Москва, Волгоградский пр-т, 32', window: ['17:00', '19:00'], weight: '260' },
    { address: 'Москва, ул. Новый Арбат, 24', window: ['16:00', '18:00'], weight: '90' },
  ];
  for (const [i, ord] of orders.entries()) {
    const sp = spots[i]!;
    const d = await saveDelivery(db, ctx, ord.id, { methodId: method!.id, distanceKm: '12', deliveryDate: iso(0), address: sp.address, windowFrom: sp.window[0]!, windowTo: sp.window[1]!, weightKg: sp.weight });
    fresh.push(d.id);
  }
  const pool = [...free.map(f => f.id), ...fresh];

  // 1. сегодня, ГАЗель: утро — в пути, первая точка вручена
  const t1 = await createTrip(db, ctx, { kind: 'city', name: 'Развоз по Москве, утро', dateFrom: iso(0), startTime: '08:30', endTime: '13:30', vehicleId: o.gazelId, driverMemberId: o.driver1 });
  for (const id of pool.slice(0, 3)) await addStop(db, ctx, t1.id, { sourceKind: 'delivery', deliveryId: id });
  const [todayWaybill] = await db.select({ id: fleetWaybills.id }).from(fleetWaybills).where(and(eq(fleetWaybills.workspaceId, ws), eq(fleetWaybills.vehicleId, o.gazelId), eq(fleetWaybills.date, iso(0)), eq(fleetWaybills.status, 'issued'))).limit(1);
  if (todayWaybill) await updateWaybill(db, ctx, todayWaybill.id, { tripId: t1.id });
  await startTrip(db, ctx, t1.id);
  const [firstStop] = await db.select({ id: fleetTripStops.id }).from(fleetTripStops).where(eq(fleetTripStops.tripId, t1.id)).orderBy(asc(fleetTripStops.seq)).limit(1);
  if (firstStop) await setStopStatus(db, ctx, t1.id, firstStop.id, 'done');

  // 2. сегодня, Ford Transit: вторая половина дня — план
  const t2 = await createTrip(db, ctx, { kind: 'city', name: 'Развоз по Москве, день', dateFrom: iso(0), startTime: '14:00', endTime: '19:00', vehicleId: o.transitId, driverMemberId: o.driver2 });
  for (const id of pool.slice(3, 5)) await addStop(db, ctx, t2.id, { sourceKind: 'delivery', deliveryId: id });
  await addStop(db, ctx, t2.id, { kind: 'load', title: 'Забрать у поставщика', address: 'Москва, Дмитровское ш., 100', lat: 55.8, lon: 37.58, windowFrom: '14:00', windowTo: '15:00', weightKg: '120', index: 0 });

  // 3. междугородний: Москва — Казань, МАЗ, завтра на три дня, второй водитель
  const t3 = await createTrip(db, ctx, { kind: 'intercity', name: 'Москва — Казань', dateFrom: iso(1), dateTo: iso(3), vehicleId: o.mazId, driverMemberId: o.driver2, coDriverMemberId: o.driver1 });
  await addStop(db, ctx, t3.id, { kind: 'load', title: 'Погрузка на складе', address: 'Москва, Волгоградский пр-т, 32', lat: 55.7, lon: 37.72, day: iso(1), windowFrom: '07:00', windowTo: '10:00', weightKg: '17500', volumeM3: '60', pallets: 28 });
  await addStop(db, ctx, t3.id, { kind: 'unload', title: 'Выгрузка, терминал Казань', address: 'Казань, ул. Тихорецкая, 9', lat: 55.79, lon: 49.12, day: iso(2), windowFrom: '10:00', windowTo: '16:00', weightKg: '17500', volumeM3: '60', pallets: 28 });
  await addStop(db, ctx, t3.id, { kind: 'load', title: 'Обратная загрузка', address: 'Казань, ул. Тихорецкая, 9', lat: 55.79, lon: 49.12, day: iso(2), weightKg: '8000', volumeM3: '30', pallets: 12 });
  await addStop(db, ctx, t3.id, { kind: 'unload', title: 'Выгрузка, Москва', address: 'Москва, Волгоградский пр-т, 32', lat: 55.7, lon: 37.72, day: iso(3), weightKg: '8000', volumeM3: '30', pallets: 12 });
  const [tomorrowWaybill] = await db.select({ id: fleetWaybills.id }).from(fleetWaybills).where(and(eq(fleetWaybills.workspaceId, ws), eq(fleetWaybills.vehicleId, o.mazId), eq(fleetWaybills.date, iso(1)), eq(fleetWaybills.status, 'draft'))).limit(1);
  if (tomorrowWaybill) await updateWaybill(db, ctx, tomorrowWaybill.id, { tripId: t3.id });
}
