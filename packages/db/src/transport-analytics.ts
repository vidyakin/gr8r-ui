/* Аналитика транспорта (задача 1216): стоимость доставки на заказ и на км, доля доставок вовремя (OTD),
   загрузка машин и выработка водителей/курьеров за период. Финансовые поля маскируются для не-admin. */
import { and, asc, eq, gte, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm';
import {
  computeRatio,
  computeUtilizationPct,
  dateRange,
  dec,
  diffDays,
  div,
  evaluateOnTime,
  fmt,
  marginPct,
  maskTransportAnalytics,
  mul,
  routeStraightKm,
  tripOverloads,
  tripPeakLoad,
  zonedParts,
  type TransportAnalyticsReport,
  type TransportCostDayRow,
  type TransportDriverOutputRow,
  type TransportOtdDayRow,
  type TransportOtdRow,
  type TransportVehicleUtilizationRow,
} from '@erp/shared';
import type { Db } from './client';
import { canSeeCost } from './cost';
import type { DocCtx } from './documents';
import { DomainError } from './errors';
import { workspaceTimeZone } from './planning';
import { memberIdsWithFunction } from './positions';
import {
  deliveries,
  documents,
  fleetDriverProfiles,
  fleetFines,
  fleetFuelEntries,
  fleetRepairs,
  fleetTripCarriers,
  fleetTripCosts,
  fleetTrips,
  fleetTripStops,
  fleetVehicles,
  fleetWaybills,
  members,
  payrollLines,
  transportOrders,
} from './schema';

export interface TransportAnalyticsQuery {
  from: string;
  to: string;
}

function assertPeriod(from: string, to: string): void {
  if (from > to) throw new DomainError(422, 'report_period_invalid', 'The period start is after its end');
  if (diffDays(from, to) > 366) throw new DomainError(422, 'report_period_invalid', 'The period is longer than a year');
}

const hhmm = (h: number, m: number) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
const pct = (num: bigint, den: bigint): string | null => (den > 0n ? fmt(div(mul(num, dec(100)), den), 1) : null);

export async function transportAnalytics(db: Db, ctx: DocCtx, q: TransportAnalyticsQuery): Promise<TransportAnalyticsReport> {
  assertPeriod(q.from, q.to);
  const ws = ctx.workspaceId;
  const tz = await workspaceTimeZone(db, ws);
  const periodDays = diffDays(q.from, q.to) + 1;

  // 1. Рейсы периода (относятся к периоду по дате окончания, как в начислении зарплаты)
  const trips = await db
    .select()
    .from(fleetTrips)
    .where(and(eq(fleetTrips.workspaceId, ws), ne(fleetTrips.status, 'cancelled'), gte(fleetTrips.dateTo, q.from), lte(fleetTrips.dateTo, q.to)))
    .orderBy(asc(fleetTrips.dateFrom), asc(fleetTrips.number));
  const tripIds = trips.map(t => t.id);

  // 2. Точки, перевозчики, прочие затраты, начисления по рейсам
  const stops = tripIds.length
    ? await db.select().from(fleetTripStops).where(and(eq(fleetTripStops.workspaceId, ws), inArray(fleetTripStops.tripId, tripIds))).orderBy(asc(fleetTripStops.seq))
    : [];
  const carriers = tripIds.length
    ? await db.select().from(fleetTripCarriers).where(and(eq(fleetTripCarriers.workspaceId, ws), inArray(fleetTripCarriers.tripId, tripIds)))
    : [];
  const extraCosts = tripIds.length
    ? await db.select().from(fleetTripCosts).where(and(eq(fleetTripCosts.workspaceId, ws), inArray(fleetTripCosts.tripId, tripIds)))
    : [];
  const payrollRows = tripIds.length
    ? await db
        .select({ tripId: payrollLines.tripId, memberId: payrollLines.memberId, amount: payrollLines.amount, insurance: payrollLines.insurance })
        .from(payrollLines)
        .innerJoin(documents, eq(documents.id, payrollLines.documentId))
        .where(and(eq(payrollLines.workspaceId, ws), inArray(payrollLines.tripId, tripIds), eq(documents.status, 'posted')))
    : [];

  // 3. Заявки на перевозку, относящиеся к рейсам периода или оформленные в периоде без рейса
  const orders = await db
    .select()
    .from(transportOrders)
    .where(
      and(
        eq(transportOrders.workspaceId, ws),
        ne(transportOrders.status, 'cancelled'),
        tripIds.length
          ? or(inArray(transportOrders.tripId, tripIds), and(isNull(transportOrders.tripId), gte(transportOrders.date, q.from), lte(transportOrders.date, q.to)))
          : and(gte(transportOrders.date, q.from), lte(transportOrders.date, q.to)),
      ),
    );

  // 4. Автопарк за период: машины, закрытые путевые листы, топливо, ремонты, штрафы
  const allVehicles = await db.select().from(fleetVehicles).where(eq(fleetVehicles.workspaceId, ws)).orderBy(asc(fleetVehicles.plate));
  const closedWaybills = await db
    .select()
    .from(fleetWaybills)
    .where(and(eq(fleetWaybills.workspaceId, ws), eq(fleetWaybills.status, 'closed'), gte(fleetWaybills.date, q.from), lte(fleetWaybills.date, q.to)));
  const fuelEntries = await db
    .select()
    .from(fleetFuelEntries)
    .where(and(eq(fleetFuelEntries.workspaceId, ws), gte(fleetFuelEntries.date, q.from), lte(fleetFuelEntries.date, q.to)));
  const postedRepairs = await db
    .select()
    .from(fleetRepairs)
    .where(and(eq(fleetRepairs.workspaceId, ws), eq(fleetRepairs.status, 'posted'), gte(fleetRepairs.date, q.from), lte(fleetRepairs.date, q.to)));
  const paidFines = await db
    .select()
    .from(fleetFines)
    .where(and(eq(fleetFines.workspaceId, ws), eq(fleetFines.status, 'paid'), eq(fleetFines.chargeDriver, false), gte(fleetFines.date, q.from), lte(fleetFines.date, q.to)));

  // 5. Доставки периода (по дню доставки, иначе дню создания — как в deliveryReport)
  const delDayExpr = sql<string>`coalesce(${deliveries.deliveryDate}, (${deliveries.createdAt} at time zone 'utc')::date)`;
  const deliveryRows = await db
    .select({ d: deliveries, docNumber: documents.number, courierName: members.name, day: sql<string>`(${delDayExpr})::text` })
    .from(deliveries)
    .innerJoin(documents, eq(documents.id, deliveries.documentId))
    .leftJoin(members, eq(members.id, deliveries.courierMemberId))
    .where(and(eq(deliveries.workspaceId, ws), gte(delDayExpr, q.from), lte(delDayExpr, q.to)));

  const deliveryIds = deliveryRows.map(r => r.d.id);
  const deliveryStops = deliveryIds.length
    ? await db
        .select({ s: fleetTripStops, tripNumber: fleetTrips.number, tripStatus: fleetTrips.status })
        .from(fleetTripStops)
        .innerJoin(fleetTrips, eq(fleetTrips.id, fleetTripStops.tripId))
        .where(and(eq(fleetTripStops.workspaceId, ws), inArray(fleetTripStops.deliveryId, deliveryIds), ne(fleetTrips.status, 'cancelled')))
    : [];

  // 6. Участники, профили водителей и должности
  const allMembers = await db.select({ id: members.id, name: members.name, status: members.status }).from(members).where(eq(members.workspaceId, ws)).orderBy(asc(members.name));
  const driverProfiles = await db.select({ memberId: fleetDriverProfiles.memberId }).from(fleetDriverProfiles).where(eq(fleetDriverProfiles.workspaceId, ws));
  const driverRoleIds = await memberIdsWithFunction(db, 'driver');
  const courierRoleIds = await memberIdsWithFunction(db, 'courier');

  // Индексы по рейсам
  const stopsByTrip = new Map<string, (typeof stops)[number][]>();
  for (const s of stops) stopsByTrip.set(s.tripId, [...(stopsByTrip.get(s.tripId) ?? []), s]);

  const carrierByTrip = new Map(carriers.map(c => [c.tripId, c]));
  const extraCostByTrip = new Map<string, bigint>();
  for (const c of extraCosts) extraCostByTrip.set(c.tripId, (extraCostByTrip.get(c.tripId) ?? 0n) + dec(c.amount));

  const payrollByTrip = new Map<string, bigint>();
  const payrollByDriver = new Map<string, { amount: bigint; cost: bigint }>();
  const tripsWithPayroll = new Set<string>();
  for (const p of payrollRows) {
    const amt = dec(p.amount);
    const total = amt + dec(p.insurance);
    if (p.tripId) {
      payrollByTrip.set(p.tripId, (payrollByTrip.get(p.tripId) ?? 0n) + total);
      if (total > 0n) tripsWithPayroll.add(p.tripId);
    }
    const prev = payrollByDriver.get(p.memberId) ?? { amount: 0n, cost: 0n };
    payrollByDriver.set(p.memberId, { amount: prev.amount + amt, cost: prev.cost + total });
  }

  const fuelByWaybill = new Map<string, bigint>();
  for (const f of fuelEntries) if (f.waybillId) fuelByWaybill.set(f.waybillId, (fuelByWaybill.get(f.waybillId) ?? 0n) + dec(f.amount));

  const waybillKmByTrip = new Map<string, bigint>();
  const fuelCostByTrip = new Map<string, bigint>();
  for (const w of closedWaybills) {
    if (!w.tripId) continue;
    waybillKmByTrip.set(w.tripId, (waybillKmByTrip.get(w.tripId) ?? 0n) + dec(w.distanceKm));
    fuelCostByTrip.set(w.tripId, (fuelCostByTrip.get(w.tripId) ?? 0n) + (fuelByWaybill.get(w.id) ?? 0n));
  }

  const stopByDelivery = new Map<string, (typeof deliveryStops)[number]>();
  for (const ds of deliveryStops) if (ds.s.deliveryId) stopByDelivery.set(ds.s.deliveryId, ds);

  // Расстояние и собственные затраты по рейсу
  const tripKmMap = new Map<string, bigint>();
  const tripHasOwnCost = new Set<string>();
  for (const t of trips) {
    const ss = stopsByTrip.get(t.id) ?? [];
    const straight = routeStraightKm(ss.map(s => ({ lat: s.lat === null ? null : Number(s.lat), lon: s.lon === null ? null : Number(s.lon) })))?.km ?? '0';
    const wbKm = waybillKmByTrip.get(t.id);
    const km = wbKm !== undefined && wbKm > 0n ? wbKm : dec(t.routeKm ?? straight);
    tripKmMap.set(t.id, km);
    const ownCost = (fuelCostByTrip.get(t.id) ?? 0n) + (payrollByTrip.get(t.id) ?? 0n) + dec(carrierByTrip.get(t.id)?.rate ?? '0') + (extraCostByTrip.get(t.id) ?? 0n);
    if (ownCost > 0n) tripHasOwnCost.add(t.id);
  }

  // Дневные бакеты для графика и структуры
  const dayMap = new Map<string, { orders: number; trips: number; km: bigint; cost: bigint; revenue: bigint }>();
  const dayBucket = (d: string) => {
    let b = dayMap.get(d);
    if (!b) {
      b = { orders: 0, trips: 0, km: 0n, cost: 0n, revenue: 0n };
      dayMap.set(d, b);
    }
    return b;
  };

  // Затраты по статьям
  let fuelCost = 0n;
  for (const f of fuelEntries) {
    const a = dec(f.amount);
    fuelCost += a;
    dayBucket(f.date).cost += a;
  }
  let repairCost = 0n;
  for (const r of postedRepairs) {
    const a = dec(r.partsCost) + dec(r.directCost);
    repairCost += a;
    dayBucket(r.date).cost += a;
  }
  let finesCost = 0n;
  for (const fn of paidFines) {
    const a = dec(fn.amount);
    finesCost += a;
    dayBucket(fn.date).cost += a;
  }
  let driverPayCost = 0n;
  for (const t of trips) {
    const pay = payrollByTrip.get(t.id) ?? 0n;
    driverPayCost += pay;
    dayBucket(t.dateTo).cost += pay;
  }
  let carrierCost = 0n;
  for (const c of carriers) {
    const rate = dec(c.rate);
    carrierCost += rate;
    const t = trips.find(x => x.id === c.tripId);
    if (t) dayBucket(t.dateTo).cost += rate;
  }
  let otherTripCost = 0n;
  for (const c of extraCosts) {
    const amt = dec(c.amount);
    otherTripCost += amt;
    const t = trips.find(x => x.id === c.tripId);
    if (t) dayBucket(t.dateTo).cost += amt;
  }

  const tripIdSet = new Set(tripIds);
  let totalKm = 0n;
  for (const t of trips) {
    const km = tripKmMap.get(t.id) ?? 0n;
    totalKm += km;
    const b = dayBucket(t.dateTo);
    b.trips += 1;
    b.km += km;
  }
  for (const w of closedWaybills) {
    if (w.tripId && tripIdSet.has(w.tripId)) continue;
    const km = dec(w.distanceKm);
    totalKm += km;
    dayBucket(w.date).km += km;
  }

  let deliveryCost = 0n;
  let totalRevenue = 0n;
  let deliveredCount = 0;
  for (const r of deliveryRows) {
    const linked = stopByDelivery.get(r.d.id);
    const inTripWithKm = linked && tripIdSet.has(linked.s.tripId) && (tripKmMap.get(linked.s.tripId) ?? 0n) > 0n;
    const effDay = r.d.deliveredAt ?? r.day;
    if (!inTripWithKm) {
      const km = dec(r.d.distanceKm);
      totalKm += km;
      dayBucket(effDay).km += km;
    }
    if (r.d.status === 'delivered') {
      deliveredCount += 1;
      const rev = dec(r.d.price);
      totalRevenue += rev;
      const b = dayBucket(effDay);
      b.orders += 1;
      b.revenue += rev;
      if (!linked || !tripHasOwnCost.has(linked.s.tripId)) {
        const oc = dec(r.d.ourCost);
        deliveryCost += oc;
        b.cost += oc;
      }
    }
  }

  let doneTransportOrdersCount = 0;
  for (const o of orders) {
    const rev = dec(o.amount);
    totalRevenue += rev;
    const t = o.tripId ? trips.find(x => x.id === o.tripId) : undefined;
    const d = t ? t.dateTo : o.date;
    const b = dayBucket(d);
    b.revenue += rev;
    if (o.status === 'done') {
      doneTransportOrdersCount += 1;
      b.orders += 1;
    }
  }

  const ordersCount = deliveredCount + doneTransportOrdersCount;
  const tripsCount = trips.length;
  const doneTripsCount = trips.filter(t => t.status === 'done').length;
  const totalCost = fuelCost + repairCost + finesCost + driverPayCost + carrierCost + otherTripCost + deliveryCost;
  const margin = totalRevenue - totalCost;
  const byDay: TransportCostDayRow[] = [...dayMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({
      date,
      orders: v.orders,
      trips: v.trips,
      km: fmt(v.km, 1),
      cost: fmt(v.cost, 2),
      revenue: fmt(v.revenue, 2),
    }));

  // 7. OTD (доля доставок вовремя)
  const otdRows: TransportOtdRow[] = [];
  const otdByCourier = new Map<string, { onTime: number; evaluated: number }>();
  const bumpCourierOtd = (memberId: string | null, status: TransportOtdRow['status']) => {
    if (!memberId || status === 'no_window') return;
    const cur = otdByCourier.get(memberId) ?? { onTime: 0, evaluated: 0 };
    cur.evaluated += 1;
    if (status === 'on_time') cur.onTime += 1;
    otdByCourier.set(memberId, cur);
  };

  for (const r of deliveryRows) {
    if (r.d.status !== 'delivered' && r.d.status !== 'failed') continue;
    const linked = stopByDelivery.get(r.d.id);
    const targetDate = r.d.deliveryDate ?? linked?.s.day ?? null;
    const windowFrom = (r.d.windowFrom ?? linked?.s.windowFrom)?.slice(0, 5) ?? null;
    const windowTo = (r.d.windowTo ?? linked?.s.windowTo)?.slice(0, 5) ?? null;
    const ts = linked?.s.arrivedAt ?? linked?.s.doneAt ?? null;
    const zp = ts ? zonedParts(ts, tz) : null;
    const actualDate = zp ? zp.date : r.d.deliveredAt;
    const actualTime = zp ? hhmm(zp.hour, zp.minute) : null;
    const ev = evaluateOnTime({ status: r.d.status, targetDate, windowTo, actualDate, actualTime });
    otdRows.push({
      id: r.d.id,
      source: 'delivery',
      label: r.docNumber ?? (r.d.contactName || r.d.address || r.d.id.slice(0, 8)),
      documentId: r.d.documentId,
      tripId: linked?.s.tripId ?? null,
      tripNumber: linked?.tripNumber ?? null,
      courierName: r.courierName ?? null,
      targetDate,
      windowFrom,
      windowTo,
      actualDate,
      actualTime,
      status: ev.status,
      delayMinutes: ev.delayMinutes,
    });
    bumpCourierOtd(r.d.courierMemberId, ev.status);
  }

  const memberNameMap = new Map(allMembers.map(m => [m.id, m.name]));
  const tripMap = new Map(trips.map(t => [t.id, t]));
  for (const s of stops) {
    if (s.deliveryId || s.kind === 'load') continue;
    if (s.status !== 'done' && s.status !== 'failed') continue;
    const t = tripMap.get(s.tripId);
    const ts = s.arrivedAt ?? s.doneAt ?? null;
    const zp = ts ? zonedParts(ts, tz) : null;
    const actualDate = zp ? zp.date : null;
    const actualTime = zp ? hhmm(zp.hour, zp.minute) : null;
    const ev = evaluateOnTime({ status: s.status === 'failed' ? 'failed' : 'delivered', targetDate: s.day, windowTo: s.windowTo, actualDate, actualTime });
    otdRows.push({
      id: s.id,
      source: 'trip_stop',
      label: s.title || s.address || (t ? `${t.number} #${s.seq}` : `#${s.seq}`),
      documentId: null,
      tripId: s.tripId,
      tripNumber: t?.number ?? null,
      courierName: t?.driverMemberId ? (memberNameMap.get(t.driverMemberId) ?? null) : null,
      targetDate: s.day,
      windowFrom: s.windowFrom?.slice(0, 5) ?? null,
      windowTo: s.windowTo?.slice(0, 5) ?? null,
      actualDate,
      actualTime,
      status: ev.status,
      delayMinutes: ev.delayMinutes,
    });
    if (t?.driverMemberId) bumpCourierOtd(t.driverMemberId, ev.status);
  }

  const otdOnTime = otdRows.filter(x => x.status === 'on_time').length;
  const otdLate = otdRows.filter(x => x.status === 'late').length;
  const otdFailed = otdRows.filter(x => x.status === 'failed').length;
  const otdNoWindow = otdRows.filter(x => x.status === 'no_window').length;
  const otdEvaluated = otdOnTime + otdLate + otdFailed;
  const otdDayMap = new Map<string, { onTime: number; late: number; failed: number }>();
  for (const r of otdRows) {
    const d = r.targetDate ?? r.actualDate;
    if (!d || r.status === 'no_window') continue;
    const cur = otdDayMap.get(d) ?? { onTime: 0, late: 0, failed: 0 };
    if (r.status === 'on_time') cur.onTime += 1;
    else if (r.status === 'late') cur.late += 1;
    else if (r.status === 'failed') cur.failed += 1;
    otdDayMap.set(d, cur);
  }
  const otdByDay: TransportOtdDayRow[] = [...otdDayMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({
      date,
      onTime: v.onTime,
      late: v.late,
      failed: v.failed,
      otdPct: pct(dec(v.onTime), dec(v.onTime + v.late + v.failed)),
    }));

  // 8. Загрузка машин
  const usedVehicleIds = new Set<string>([
    ...trips.flatMap(t => (t.vehicleId ? [t.vehicleId] : [])),
    ...closedWaybills.map(w => w.vehicleId),
    ...fuelEntries.map(f => f.vehicleId),
    ...postedRepairs.map(r => r.vehicleId),
    ...paidFines.map(f => f.vehicleId),
  ]);
  const vehicleRows: TransportVehicleUtilizationRow[] = allVehicles
    .filter(v => !v.archivedAt || usedVehicleIds.has(v.id))
    .map(v => {
      const vTrips = trips.filter(t => t.vehicleId === v.id);
      const activeDaySet = new Set<string>();
      let km = 0n;
      let weightSum = 0n;
      let volumeSum = 0n;
      let palletsSum = 0;
      let overloadsCount = 0;
      for (const t of vTrips) {
        const sDay = t.dateFrom < q.from ? q.from : t.dateFrom;
        const eDay = t.dateTo > q.to ? q.to : t.dateTo;
        if (sDay <= eDay) for (const d of dateRange(sDay, eDay)) activeDaySet.add(d);
        km += tripKmMap.get(t.id) ?? 0n;
        const ss = stopsByTrip.get(t.id) ?? [];
        const load = tripPeakLoad(ss.map(s => ({ seq: s.seq, kind: s.kind, weightKg: s.weightKg, volumeM3: s.volumeM3, pallets: s.pallets })));
        weightSum += dec(load.weightKg);
        volumeSum += dec(load.volumeM3);
        palletsSum += load.pallets;
        if (tripOverloads(load, { capacityKg: v.capacityKg, volumeM3: v.volumeM3, pallets: v.pallets }).length) overloadsCount += 1;
      }
      for (const w of closedWaybills) {
        if (w.vehicleId !== v.id || (w.tripId && tripIdSet.has(w.tripId))) continue;
        km += dec(w.distanceKm);
        activeDaySet.add(w.date);
      }
      const vFuel = fuelEntries.filter(f => f.vehicleId === v.id);
      const liters = vFuel.reduce((s, f) => s + dec(f.liters), 0n);
      const vFuelCost = vFuel.reduce((s, f) => s + dec(f.amount), 0n);
      const vRepairCost = postedRepairs.filter(r => r.vehicleId === v.id).reduce((s, r) => s + dec(r.partsCost) + dec(r.directCost), 0n);
      const vFinesCost = paidFines.filter(f => f.vehicleId === v.id).reduce((s, f) => s + dec(f.amount), 0n);
      const vTotalCost = vFuelCost + vRepairCost + vFinesCost;
      const tc = vTrips.length;
      const avgWeight = tc > 0 ? div(weightSum, dec(tc)) : 0n;
      const avgVolume = tc > 0 ? div(volumeSum, dec(tc)) : 0n;
      const avgPallets = tc > 0 ? div(dec(palletsSum), dec(tc)) : 0n;
      return {
        vehicleId: v.id,
        plate: v.plate,
        name: v.name,
        kind: v.kind,
        tripsCount: tc,
        doneTripsCount: vTrips.filter(t => t.status === 'done').length,
        activeDays: activeDaySet.size,
        periodDays,
        timeUtilizationPct: fmt(div(mul(dec(activeDaySet.size), dec(100)), dec(periodDays)), 1),
        distanceKm: fmt(km, 1),
        fuelLiters: fmt(liters, 1),
        capacityKg: v.capacityKg,
        avgWeightKg: fmt(avgWeight, 1),
        weightUtilizationPct: tc > 0 ? computeUtilizationPct(fmt(avgWeight, 3), v.capacityKg) : null,
        volumeM3: v.volumeM3,
        avgVolumeM3: fmt(avgVolume, 2),
        volumeUtilizationPct: tc > 0 ? computeUtilizationPct(fmt(avgVolume, 3), v.volumeM3) : null,
        pallets: v.pallets,
        avgPallets: fmt(avgPallets, 1),
        palletsUtilizationPct: tc > 0 ? computeUtilizationPct(fmt(avgPallets, 3), v.pallets) : null,
        overloadsCount,
        fuelCost: fmt(vFuelCost, 2),
        repairCost: fmt(vRepairCost, 2),
        finesCost: fmt(vFinesCost, 2),
        totalCost: fmt(vTotalCost, 2),
        costPerKm: km > 0n ? fmt(div(vTotalCost, km), 2) : null,
      };
    });

  // Средняя загрузка машин по весу среди машин с рейсами и заданной грузоподъёмностью
  const loadedVehicles = vehicleRows.filter(v => v.weightUtilizationPct !== null);
  const avgVehicleLoadPct = loadedVehicles.length
    ? fmt(div(loadedVehicles.reduce((s, v) => s + dec(v.weightUtilizationPct!), 0n), dec(loadedVehicles.length)), 1)
    : null;

  // 9. Выработка водителей и курьеров
  const profileIds = new Set(driverProfiles.map(p => p.memberId));
  const tripPeople = new Set<string>([
    ...trips.flatMap(t => [t.driverMemberId, t.coDriverMemberId].filter((x): x is string => !!x)),
    ...closedWaybills.map(w => w.driverMemberId),
  ]);
  const courierPeople = new Set<string>(deliveryRows.flatMap(r => (r.d.courierMemberId ? [r.d.courierMemberId] : [])));
  const relevantMembers = allMembers.filter(
    m =>
      tripPeople.has(m.id) ||
      courierPeople.has(m.id) ||
      payrollByDriver.has(m.id) ||
      profileIds.has(m.id) ||
      driverRoleIds?.has(m.id) ||
      courierRoleIds?.has(m.id),
  );

  const driverRows: TransportDriverOutputRow[] = relevantMembers
    .map(m => {
      const mTrips = trips.filter(t => t.driverMemberId === m.id || t.coDriverMemberId === m.id);
      const mStopsDone = mTrips.reduce((s, t) => s + (stopsByTrip.get(t.id) ?? []).filter(st => st.status === 'done').length, 0);
      const mDeliveries = deliveryRows.filter(r => r.d.courierMemberId === m.id);
      const mDoneDel = mDeliveries.filter(r => r.d.status === 'delivered');
      const mFailedDel = mDeliveries.filter(r => r.d.status === 'failed');
      let km = 0n;
      for (const t of mTrips) if (t.driverMemberId === m.id) km += tripKmMap.get(t.id) ?? 0n;
      for (const w of closedWaybills) {
        if (w.driverMemberId !== m.id || (w.tripId && tripIdSet.has(w.tripId))) continue;
        km += dec(w.distanceKm);
      }
      for (const r of mDeliveries) {
        const linked = stopByDelivery.get(r.d.id);
        if (linked && tripIdSet.has(linked.s.tripId) && (tripKmMap.get(linked.s.tripId) ?? 0n) > 0n) continue;
        km += dec(r.d.distanceKm);
      }
      const pay = payrollByDriver.get(m.id) ?? { amount: 0n, cost: 0n };
      let delCost = 0n;
      for (const r of mDoneDel) {
        const linked = stopByDelivery.get(r.d.id);
        if (linked && tripsWithPayroll.has(linked.s.tripId)) continue;
        delCost += dec(r.d.ourCost);
      }
      const totCost = pay.cost + delCost;
      const otdStat = otdByCourier.get(m.id);
      const roles: ('driver' | 'courier')[] = [];
      if (mTrips.length > 0 || profileIds.has(m.id) || driverRoleIds?.has(m.id)) roles.push('driver');
      if (mDeliveries.length > 0 || courierRoleIds?.has(m.id)) roles.push('courier');
      return {
        memberId: m.id,
        memberName: m.name,
        roles,
        tripsCount: mTrips.length,
        doneTripsCount: mTrips.filter(t => t.status === 'done').length,
        stopsDone: mStopsDone,
        deliveriesTotal: mDeliveries.length,
        deliveriesCompleted: mDoneDel.length,
        deliveriesFailed: mFailedDel.length,
        otdPct: otdStat && otdStat.evaluated > 0 ? pct(dec(otdStat.onTime), dec(otdStat.evaluated)) : null,
        distanceKm: fmt(km, 1),
        payrollAmount: fmt(pay.amount, 2),
        payrollCost: fmt(pay.cost, 2),
        deliveryCost: fmt(delCost, 2),
        totalCost: fmt(totCost, 2),
        costPerDelivery: mDoneDel.length > 0 ? fmt(div(totCost, dec(mDoneDel.length)), 2) : null,
        costPerKm: km > 0n ? fmt(div(totCost, km), 2) : null,
      };
    })
    .sort((a, b) => b.deliveriesCompleted + b.tripsCount - (a.deliveriesCompleted + a.tripsCount) || a.memberName.localeCompare(b.memberName));

  const costPerOrder = ordersCount > 0 ? computeRatio(fmt(totalCost, 2), String(ordersCount), 2) : null;
  const costPerTrip = tripsCount > 0 ? computeRatio(fmt(totalCost, 2), String(tripsCount), 2) : null;
  const costPerKm = totalKm > 0n ? fmt(div(totalCost, totalKm), 2) : null;
  const otdPctVal = pct(dec(otdOnTime), dec(otdEvaluated));
  const mPct = totalRevenue > 0n ? marginPct(margin, totalRevenue) : null;

  const report: TransportAnalyticsReport = {
    from: q.from,
    to: q.to,
    canSeeCost: true,
    summary: {
      ordersCount,
      deliveriesCompleted: deliveredCount,
      deliveriesTotal: deliveryRows.length,
      tripsCount,
      doneTripsCount,
      totalKm: fmt(totalKm, 1),
      otdPct: otdPctVal,
      avgVehicleLoadPct,
      totalCost: fmt(totalCost, 2),
      totalRevenue: fmt(totalRevenue, 2),
      margin: fmt(margin, 2),
      marginPct: mPct,
      costPerOrder,
      costPerTrip,
      costPerKm,
    },
    cost: {
      fuelCost: fmt(fuelCost, 2),
      repairCost: fmt(repairCost, 2),
      finesCost: fmt(finesCost, 2),
      driverPayCost: fmt(driverPayCost, 2),
      carrierCost: fmt(carrierCost, 2),
      otherTripCost: fmt(otherTripCost, 2),
      deliveryCost: fmt(deliveryCost, 2),
      totalCost: fmt(totalCost, 2),
      totalRevenue: fmt(totalRevenue, 2),
      margin: fmt(margin, 2),
      marginPct: mPct,
      costPerOrder,
      costPerTrip,
      costPerKm,
    },
    byDay,
    otd: {
      total: otdRows.length,
      onTime: otdOnTime,
      late: otdLate,
      failed: otdFailed,
      noWindow: otdNoWindow,
      otdPct: otdPctVal,
      byDay: otdByDay,
      rows: otdRows,
    },
    vehicles: vehicleRows,
    drivers: driverRows,
  };

  return maskTransportAnalytics(report, canSeeCost(ctx.role));
}
