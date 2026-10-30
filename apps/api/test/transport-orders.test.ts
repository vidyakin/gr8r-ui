/* Задача 1223 (docs/architecture/transport-orders.md): тарифы по направлениям, заявки на перевозку (заявка → рейс → счёт/акт),
   экспедирование (наём перевозчика на рейс, прочие затраты рейса, маржа рейса), права и изоляция по арендатору. */
import { beforeAll, describe, expect, test } from 'bun:test';
import { Client } from './helpers';

let owner: Client;
let member: Client;
let guest: Client;
let other: Client;
let orgId: string;
let customer: string;
let carrierCompany: string;
let serviceProduct: string;
let costItem: string;
let truck: string;
let drv1: string;

const mk = async (c: Client, path: string, body: Record<string, unknown>) => {
  const r = await c.post(path, body);
  if (r.status >= 300) throw new Error(`${path} ${JSON.stringify(body)}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};
const day = (n = 0) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'Заявки WS' });
  const ws = owner.workspaceId!;
  member = new Client();
  await member.signup();
  const inv = await owner.post(`/workspaces/${ws}/invites`, { email: member.user!.email, role: 'member' });
  await member.post('/invites/accept', { token: inv.body.token });
  member.workspaceId = ws;
  guest = new Client();
  await guest.signup();
  const invG = await owner.post(`/workspaces/${ws}/invites`, { email: guest.user!.email, role: 'guest' });
  await guest.post('/invites/accept', { token: invG.body.token });
  guest.workspaceId = ws;
  other = new Client();
  await other.signup({ workspaceName: 'Чужие заявки WS' });

  orgId = (await owner.get('/organizations')).body.items[0].id;
  customer = (await mk(owner, '/companies', { name: 'ООО «Заказчик»' })).id;
  carrierCompany = (await mk(owner, '/companies', { name: 'ООО «Перевозчик»' })).id;
  serviceProduct = (await mk(owner, '/products', { name: 'Перевозка', kind: 'service', unitCode: '876', price: 0, vatRate: 'none' })).id;
  costItem = ((await owner.get('/cost-items')).body.items as any[])[0].id;
  truck = (await mk(owner, '/fleet/vehicles', { plate: 'А123АА77', kind: 'truck', capacityKg: 5000, fuelNormSummer: 25 })).id;
  const people = (await owner.get('/members')).body.items as any[];
  drv1 = people.find(m => m.email === member.user!.email).id;
});

describe('тарифы по направлениям', () => {
  let rateId: string;
  test('создание, расчёт подсказки по направлению, редактирование, архив', async () => {
    const r = await owner.post('/transport-orders/rate-schedules', { name: 'Москва — Казань', fromPlace: 'Москва', toPlace: 'Казань', rateKind: 'per_km', rate: '50', distanceKm: '800' });
    expect(r.status).toBe(201);
    rateId = r.body.id;
    expect(r.body).toMatchObject({ fromPlace: 'Москва', toPlace: 'Казань', rateKind: 'per_km' });

    const suggest = await owner.get(`/transport-orders/rate-schedules/suggest?fromPlace=${encodeURIComponent('Москва')}&toPlace=${encodeURIComponent('Казань')}`);
    expect(suggest.body.item.id).toBe(rateId);

    const upd = await owner.patch(`/transport-orders/rate-schedules/${rateId}`, { rate: '60' });
    expect(upd.body.rate).toBe('60.00');

    expect((await member.post(`/transport-orders/rate-schedules/${rateId}/archive`, {})).body.archivedAt).toBeTruthy();
    const list = (await owner.get('/transport-orders/rate-schedules')).body.items as any[];
    expect(list.find((x: any) => x.id === rateId)).toBeUndefined();
    const archivedList = (await owner.get('/transport-orders/rate-schedules?archived=only')).body.items as any[];
    expect(archivedList.find((x: any) => x.id === rateId)).toBeTruthy();
  });

  test('гость читает, но не создаёт', async () => {
    expect((await guest.get('/transport-orders/rate-schedules')).status).toBe(200);
    expect((await guest.post('/transport-orders/rate-schedules', { name: 'x' })).status).toBe(403);
  });
});

describe('заявка на перевозку: жизненный цикл, рейс, счёт/акт', () => {
  let orderId: string;
  let tripId: string;

  test('создание заявки с точками маршрута считает сумму по ставке', async () => {
    const order = await mk(owner, '/transport-orders', {
      date: day(0),
      organizationId: orgId,
      customerCompanyId: customer,
      fromPlace: 'Москва',
      toPlace: 'Казань',
      cargoName: 'Стройматериалы',
      weightKg: '2000',
      rateKind: 'per_km',
      rate: '50',
      distanceKm: '800',
      points: [
        { kind: 'load', address: 'Москва, ул. Складская, 1' },
        { kind: 'unload', address: 'Казань, ул. Приёмная, 2' },
      ],
    });
    orderId = order.id;
    expect(order).toMatchObject({ number: expect.stringMatching(/^ЗП-\d{4}-\d{5}$/), status: 'draft', amount: '40000.00' });
    expect((await owner.patch(`/transport-orders/${orderId}`, { comment: 'Звонить заранее' })).body.comment).toBe('Звонить заранее');

    const got = await owner.get(`/transport-orders/${orderId}`);
    expect(got.body.points).toHaveLength(2);
    expect(got.body.points[0]).toMatchObject({ kind: 'load', address: 'Москва, ул. Складская, 1' });
    expect(got.body.customerName).toBeTruthy();
    expect((await owner.get('/transport-orders')).body.items.find((x: any) => x.id === orderId).customerName).toBe(got.body.customerName);
  });

  test('комментарий сохраняется при создании', async () => {
    const o = await mk(owner, '/transport-orders', { date: day(0), organizationId: orgId, customerCompanyId: customer, comment: 'С гидробортом' });
    expect(o.comment).toBe('С гидробортом');
    await owner.del(`/transport-orders/${o.id}`);
  });

  test('сумму можно задать вручную (договорная), статус меняется по переходам', async () => {
    const upd = await owner.patch(`/transport-orders/${orderId}`, { amount: '35000' });
    expect(upd.body.amount).toBe('35000.00');

    expect((await owner.post(`/transport-orders/${orderId}/status`, { status: 'in_progress' })).status).toBe(409); // нельзя перескочить draft → in_progress
    expect((await owner.post(`/transport-orders/${orderId}/status`, { status: 'confirmed' })).body.status).toBe('confirmed');
    expect((await owner.patch(`/transport-orders/${orderId}`, { comment: 'правка после подтверждения' })).status).toBe(200);
  });

  test('заявка создаёт рейс через точки (sourceKind=transport_order) и привязывается к нему', async () => {
    const trip = await mk(owner, '/trips', { dateFrom: day(0), vehicleId: truck, driverMemberId: drv1, kind: 'intercity', dateTo: day(1) });
    tripId = trip.id;
    const draft = await mk(owner, '/transport-orders', { date: day(0), organizationId: orgId, customerCompanyId: customer, points: [{ kind: 'load', address: 'А' }] });
    expect((await owner.post(`/transport-orders/${draft.id}/trip`, { tripId })).body.error.code).toBe('transport_order_not_confirmed');
    await owner.del(`/transport-orders/${draft.id}`);

    const attached = await owner.post(`/transport-orders/${orderId}/trip`, { tripId });
    expect(attached.status).toBe(200);
    expect(attached.body.tripId).toBe(tripId);

    const tripView = await owner.get(`/trips/${tripId}`);
    const stops = tripView.body.stops as any[];
    expect(stops).toHaveLength(2);
    expect(stops.every((s: any) => s.sourceKind === 'transport_order' && s.sourceId === orderId)).toBe(true);
    expect(stops.map((s: any) => s.kind)).toEqual(['load', 'unload']);
    expect(stops[0].weightKg).toBe(stops[1].weightKg);

    expect((await owner.post(`/transport-orders/${orderId}/trip`, { tripId })).status).toBe(409); // уже привязана
  });

  test('отмена заявки убирает её незавершённые точки из открытого рейса', async () => {
    const o = await mk(owner, '/transport-orders', { date: day(0), organizationId: orgId, customerCompanyId: customer, amount: '100', points: [{ kind: 'load', address: 'Отменяемая погрузка' }] });
    await owner.post(`/transport-orders/${o.id}/status`, { status: 'confirmed' });
    await owner.post(`/transport-orders/${o.id}/trip`, { tripId });
    expect(((await owner.get(`/trips/${tripId}`)).body.stops as any[]).some(s => s.sourceId === o.id)).toBe(true);
    expect((await owner.post(`/transport-orders/${o.id}/status`, { status: 'cancelled' })).status).toBe(200);
    expect(((await owner.get(`/trips/${tripId}`)).body.stops as any[]).some(s => s.sourceId === o.id)).toBe(false);
    expect((await owner.post(`/transport-orders/${o.id}/trip`, { tripId })).status).toBe(409);
  });

  test('счёт и акт на услугу «Перевозка» на сумму заявки, повторно не создаются', async () => {
    const inv = await owner.post(`/transport-orders/${orderId}/invoice`, { productId: serviceProduct });
    expect(inv.status).toBe(201);
    const doc = await owner.get(`/documents/${inv.body.documentId}`);
    expect(doc.body.type).toBe('invoice');
    expect(doc.body.lines[0]).toMatchObject({ qty: '1.000', price: '35000.00' });
    expect((await owner.post(`/transport-orders/${orderId}/invoice`, { productId: serviceProduct })).body.error.code).toBe('already_billed');

    const act = await owner.post(`/transport-orders/${orderId}/act`, { productId: serviceProduct });
    expect(act.status).toBe(201);
    expect((await owner.get(`/documents/${act.body.documentId}`)).body.type).toBe('act');
  });

  test('заявку в работе нельзя удалить и нельзя переводить статус задом наперёд', async () => {
    expect((await owner.del(`/transport-orders/${orderId}`)).body.error.code).toBe('transport_order_not_draft');
    expect((await owner.post(`/transport-orders/${orderId}/status`, { status: 'draft' })).status).toBe(409);
  });

  test('член команды редактирует, гость — только читает', async () => {
    expect((await member.get(`/transport-orders/${orderId}`)).status).toBe(200);
    expect((await guest.post('/transport-orders', { date: day(0), organizationId: orgId, customerCompanyId: customer })).status).toBe(403);
  });

  test('изоляция по арендатору: другой воркспейс не видит заявку', async () => {
    expect((await other.get(`/transport-orders/${orderId}`)).status).toBe(404);
    expect((await other.get('/transport-orders')).body.items).toHaveLength(0);
  });

  describe('экспедирование: наём перевозчика и маржа рейса', () => {
    test('наём перевозчика на рейс: одна запись на рейс, ставка и реквизиты для договора-заявки', async () => {
      const carrier = await owner.put(`/transport-orders/trips/${tripId}/carrier`, { carrierCompanyId: carrierCompany, rate: '28000', vehiclePlate: 'К777КК16', driverName: 'Иванов И.И.', contractNumber: 'ДЗ-1', contractDate: day(0) });
      expect(carrier.status).toBe(200);
      expect(carrier.body).toMatchObject({ tripId, rate: '28000.00', vehiclePlate: 'К777КК16' });

      const second = await owner.put(`/transport-orders/trips/${tripId}/carrier`, { carrierCompanyId: carrierCompany, rate: '30000' });
      expect(second.body.rate).toBe('30000.00'); // повторный put на тот же рейс обновляет запись, не дублирует

      const got = await owner.get(`/transport-orders/trips/${tripId}/carrier`);
      expect(got.body.item.rate).toBe('30000.00');
    });

    test('печать договора-заявки перевозчику: стороны, маршрут, машина, водитель, ставка', async () => {
      await owner.put(`/transport-orders/trips/${tripId}/carrier`, { carrierCompanyId: carrierCompany, rate: '30000', vehiclePlate: 'К777КК16', driverName: 'Иванов И.И.' });
      const print = await owner.get<string>(`/transport-orders/trips/${tripId}/contract/print`);
      expect(print.status).toBe(200);
      expect(print.headers.get('content-type')).toContain('text/html');
      for (const s of ['ООО «Перевозчик»', 'К777КК16', 'Иванов И.И.', '30 000,00', 'Москва, ул. Складская, 1', 'Казань, ул. Приёмная, 2']) expect(print.body).toContain(s);
      expect((await other.get(`/transport-orders/trips/${tripId}/contract/print`)).status).toBe(404);
    });

    test('прочие затраты рейса статьёй затрат', async () => {
      const cost = await owner.post(`/transport-orders/trips/${tripId}/costs`, { costItemId: costItem, amount: '1500', comment: 'Платная дорога' });
      expect(cost.status).toBe(201);
      const list = (await owner.get(`/transport-orders/trips/${tripId}/costs`)).body.items as any[];
      expect(list).toHaveLength(1);
      await owner.patch(`/transport-orders/trips/${tripId}/costs/${cost.body.id}`, { amount: '2000' });
      const after = (await owner.get(`/transport-orders/trips/${tripId}/costs`)).body.items as any[];
      expect(after[0].amount).toBe('2000.00');
      await owner.del(`/transport-orders/trips/${tripId}/costs/${cost.body.id}`);
      expect((await owner.get(`/transport-orders/trips/${tripId}/costs`)).body.items).toHaveLength(0);
    });

    test('маржа рейса: доход заявок рейса минус ставка перевозчику; маржа экспедитора отдельно', async () => {
      await owner.post(`/transport-orders/trips/${tripId}/costs`, { costItemId: costItem, amount: '1500' });
      const margin = await owner.get(`/transport-orders/trips/${tripId}/margin`);
      expect(margin.status).toBe(200);
      expect(margin.body.income).toBe('35000.00');
      expect(margin.body.carrierRate).toBe('30000.00');
      expect(margin.body.otherCosts).toBe('1500.00');
      expect(margin.body.forwarding).toMatchObject({ margin: '5000.00' });
      expect(margin.body.fuelAmount).toBe('0.00');
      expect((await member.get(`/transport-orders/trips/${tripId}/margin`)).status).toBe(403);

      await owner.del(`/transport-orders/trips/${tripId}/carrier`);
      const after = await owner.get(`/transport-orders/trips/${tripId}/margin`);
      expect(after.body.forwarding).toBeNull();
      expect(after.body.carrierRate).toBe('0.00');
    });
  });
});
