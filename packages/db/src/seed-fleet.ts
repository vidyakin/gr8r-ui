/* Демо автопарка (задача 1210): четыре машины с нормами топлива, два водителя (должность «Водитель»), документы со сроками
   (один истекает, один просрочен), путевые листы разных статусов, заправки, регламент ТО, ремонт и штраф. Всё — настоящими сервисами. */
import { and, asc, eq, ne } from 'drizzle-orm';
import type { Db } from './client';
import type { DocCtx } from './documents';
import {
  cancelWaybill,
  closeWaybill,
  createFine,
  createFleetDocument,
  createFuelEntry,
  createRepair,
  createServicePlan,
  createVehicle,
  createWaybill,
  issueWaybill,
  postRepair,
  saveDriverProfile,
  saveFuelCard,
  updateWaybill,
} from './fleet';
import { memberIdsWithFunction } from './positions';
import { members } from './schema';

const iso = (daysAhead: number) => new Date(Date.now() + daysAhead * 864e5).toISOString().slice(0, 10);
const at = (daysAhead: number, hhmm: string) => `${iso(daysAhead)}T${hhmm}:00.000Z`;

export async function seedFleet(db: Db, ctx: DocCtx) {
  const ws = ctx.workspaceId;
  const withFn = await memberIdsWithFunction(db, 'driver');
  const active = await db.select({ id: members.id }).from(members).where(and(eq(members.workspaceId, ws), eq(members.status, 'active'), ne(members.id, ctx.memberId ?? ''))).orderBy(asc(members.createdAt), asc(members.id));
  const drivers = (withFn ? active.filter(m => withFn.has(m.id)) : active).slice(0, 2).map(m => m.id);
  if (!drivers.length) return;
  const [d1, d2 = drivers[0]!] = drivers as [string, string?];

  const gazel = await createVehicle(db, ctx, { plate: 'А123ВС77', name: 'ГАЗель Next', kind: 'van', make: 'ГАЗ', model: 'Next A31', vin: 'X96A31R2LM0001234', year: 2021, capacityKg: '1500', volumeM3: '14', pallets: 4, fuelType: 'diesel', fuelNormSummer: '12.5', fuelNormWinter: '14', tankL: '70', odometer: '84200', driverMemberId: d1 });
  const maz = await createVehicle(db, ctx, { plate: 'М456ОР77', name: 'МАЗ-5440', kind: 'tractor', make: 'МАЗ', model: '5440', year: 2019, capacityKg: '20000', volumeM3: '82', pallets: 33, fuelType: 'diesel', fuelNormSummer: '32', fuelNormWinter: '36', tankL: '400', odometer: '312500', driverMemberId: d2 });
  const transit = await createVehicle(db, ctx, { plate: 'Е789КХ199', name: 'Ford Transit', kind: 'van', make: 'Ford', model: 'Transit', year: 2018, capacityKg: '1200', volumeM3: '11', pallets: 3, fuelType: 'diesel', fuelNormSummer: '10', fuelNormWinter: '11.5', tankL: '80', odometer: '151300' });
  const largus = await createVehicle(db, ctx, { plate: 'Т321АА50', name: 'Lada Largus', kind: 'car', make: 'Lada', model: 'Largus', year: 2022, capacityKg: '700', volumeM3: '2.5', fuelType: 'petrol', fuelNormSummer: '8.5', fuelNormWinter: '9.5', tankL: '50', odometer: '42100' });

  await saveDriverProfile(db, ctx, d1, { licenseNumber: '77 21 345678', categories: ['B', 'C'], phone: '+7 925 000-11-22' });
  await saveDriverProfile(db, ctx, d2, { licenseNumber: '50 18 987654', categories: ['B', 'C', 'CE'], phone: '+7 903 000-33-44' });

  // документы со сроками: ОСАГО Transit истекает через 12 дней, техосмотр Largus просрочен вчера
  for (const [v, osago] of [[gazel, 200], [maz, 140], [transit, 12], [largus, 90]] as const) await createFleetDocument(db, ctx, { kind: 'osago', vehicleId: v.id, number: `ТТТ ${v.plate.slice(1, 4)}00${osago}`, issuedOn: iso(osago - 365), validUntil: iso(osago) });
  await createFleetDocument(db, ctx, { kind: 'kasko', vehicleId: gazel.id, number: 'КАСКО-2026-77', validUntil: iso(210), remindDays: 45 });
  await createFleetDocument(db, ctx, { kind: 'inspection', vehicleId: largus.id, number: 'ТО-0012', validUntil: iso(-1) });
  await createFleetDocument(db, ctx, { kind: 'inspection', vehicleId: gazel.id, validUntil: iso(120) });
  await createFleetDocument(db, ctx, { kind: 'tachograph', vehicleId: maz.id, number: 'ТАХО-7781', validUntil: iso(25), remindDays: 30 });
  await createFleetDocument(db, ctx, { kind: 'license', memberId: d1, number: '77 21 345678', validUntil: iso(900) });
  await createFleetDocument(db, ctx, { kind: 'license', memberId: d2, number: '50 18 987654', validUntil: iso(700) });
  await createFleetDocument(db, ctx, { kind: 'medical', memberId: d1, validUntil: iso(18), remindDays: 30 });
  await createFleetDocument(db, ctx, { kind: 'medical', memberId: d2, validUntil: iso(300) });

  const card = await saveFuelCard(db, ctx, null, { number: '7001-0042', name: 'Лукойл — ГАЗель', vehicleId: gazel.id });
  await saveFuelCard(db, ctx, null, { number: '7001-0057', name: 'Лукойл — МАЗ', vehicleId: maz.id });

  // путевые листы: закрытые с перерасходом и экономией, выданный сегодня, черновик на завтра, отменённый
  const checks = { medicalOk: true, medicalTime: '07:30', medicalBy: 'Фельдшер Н. Иванова', techOk: true, techTime: '07:45', techBy: 'Механик П. Сидоров' };
  const trip = async (v: typeof gazel, driver: string, days: number, route: string, fuelOut: string, back: { km: number; fuelBack: string; fill?: { liters: string; amount: string } }) => {
    const w = await createWaybill(db, ctx, { vehicleId: v.id, driverMemberId: driver, date: iso(days), route, departureAt: at(days, '08:00'), returnAt: at(days, '18:00'), fuelOut, ...checks });
    await issueWaybill(db, ctx, w.id);
    if (back.fill) await createFuelEntry(db, ctx, { vehicleId: v.id, cardId: v.id === gazel.id ? card.id : null, date: iso(days), liters: back.fill.liters, amount: back.fill.amount, station: 'Лукойл, Алтуфьевское ш.' });
    await updateWaybill(db, ctx, w.id, { odometerBack: String(Number(w.odometerOut) + back.km), fuelBack: back.fuelBack });
    return closeWaybill(db, ctx, w.id);
  };
  await trip(gazel, d1, -6, 'Склад — клиенты по Москве (7 точек)', '40', { km: 118, fuelBack: '36', fill: { liters: '12', amount: '720' } });
  await trip(gazel, d1, -4, 'Склад — Подольск — Серпухов', '36', { km: 186, fuelBack: '18', fill: { liters: '10', amount: '600' } });
  const long = await trip(maz, d2, -5, 'Москва — Тула — Орёл — Москва', '220', { km: 860, fuelBack: '95', fill: { liters: '180', amount: '10800' } });
  await trip(transit, d2, -2, 'Москва — Клин', '55', { km: 160, fuelBack: '38' });
  // штраф: водитель определяется по путевому листу на дату нарушения
  await createFine(db, ctx, { vehicleId: maz.id, date: long.date, uin: '18810177260000012345', article: 'КоАП 12.9 ч.2 (превышение скорости)', amount: '500', status: 'paid', paidOn: iso(-1) });
  await createFine(db, ctx, { vehicleId: gazel.id, date: iso(-4), uin: '18810177260000054321', article: 'КоАП 12.19 ч.4 (парковка)', amount: '3000', chargeDriver: true });

  const today = await createWaybill(db, ctx, { vehicleId: gazel.id, driverMemberId: d1, date: iso(0), route: 'Склад — доставка заказов дня', departureAt: at(0, '08:30'), fuelOut: '45', ...checks });
  await issueWaybill(db, ctx, today.id);
  await createWaybill(db, ctx, { vehicleId: maz.id, driverMemberId: d2, date: iso(1), route: 'Москва — Казань', fuelOut: '300' });
  const cancelled = await createWaybill(db, ctx, { vehicleId: largus.id, driverMemberId: d1, date: iso(-3), route: 'Поездка отменена' });
  await cancelWaybill(db, ctx, cancelled.id);

  // регламент ТО и ремонт: ГАЗель — ТО по пробегу, МАЗ — замена шин (работы)
  await createServicePlan(db, ctx, { vehicleId: gazel.id, name: 'ТО-1 (масло, фильтры)', everyKm: 15000, everyMonths: 12, lastKm: '72000', lastDate: iso(-160) });
  await createServicePlan(db, ctx, { vehicleId: gazel.id, name: 'Замена ремня ГРМ', everyKm: 90000, lastKm: '0', lastDate: iso(-900) });
  await createServicePlan(db, ctx, { vehicleId: maz.id, name: 'ТО-2 (КПП, мосты)', everyKm: 30000, everyMonths: 12, lastKm: '290000', lastDate: iso(-100) });
  await createServicePlan(db, ctx, { vehicleId: transit.id, name: 'ТО-1', everyKm: 15000, everyMonths: 12, lastKm: '150000', lastDate: iso(-300) });
  const rep = await createRepair(db, ctx, {
    vehicleId: maz.id,
    kind: 'repair',
    date: iso(-8),
    odometer: '311600',
    description: 'Замена тормозных колодок и диагностика пневмосистемы',
    lines: [
      { kind: 'part', name: 'Колодки тормозные (комплект, закупка)', qty: '1', price: '9800' },
      { kind: 'work', name: 'Замена колодок', qty: '2', price: '1500' },
      { kind: 'work', name: 'Диагностика пневмосистемы', qty: '1', price: '2200' },
    ],
  });
  await postRepair(db, ctx, rep.id);
}
