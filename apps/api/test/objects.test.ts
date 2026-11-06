/* Объекты объектного учёта (задача 1268): CRUD и архив, изоляция арендаторов, аналитика object_id
   в документах, платежах, задачах и времени, маскирование денег в карточке, автосоздание проекта задач. */
import { beforeAll, describe, expect, test } from 'bun:test';
import { addMember, Client } from './helpers';

let owner: Client;
let member: Client;
let other: Client;
let customer: string;
let otherCustomer: string;
let product: string;
let cashRegister: string;
let incomeItem: string;
let objectId: string;
let projectId: string;

const mk = async (c: Client, path: string, body: Record<string, unknown>) => {
  const r = await c.post(path, body);
  if (r.status >= 300) throw new Error(`${path} ${JSON.stringify(body)}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'Objects WS' });
  member = await addMember(owner, 'member');
  other = new Client();
  await other.signup({ workspaceName: 'Other objects WS' });
  customer = (await mk(owner, '/companies', { name: 'ООО «Заказчик стройки»' })).id;
  otherCustomer = (await mk(other, '/companies', { name: 'Чужой заказчик' })).id;
  product = (await mk(owner, '/products', { name: 'Монтаж кабеля', kind: 'service', price: 0, vatRate: 'none' })).id;
  const org = await mk(owner, '/organizations', { name: 'ООО «Подрядчик»' });
  cashRegister = (await mk(owner, '/cash-registers', { name: 'Касса офиса', organizationId: org.id })).id;
  incomeItem = (await mk(owner, '/cash-flow-items', { name: 'Прочий доход', kind: 'income' })).id;
});

describe('объект: справочник и архив', () => {
  test('создание создаёт проект задач и подставляет накладные', async () => {
    const res = await owner.post('/objects', {
      number: 'OBJ-100',
      name: 'ЖК Северный, корп. 2 — электромонтаж',
      customerId: customer,
      address: 'г. Москва, ул. Северная, 2',
      startDate: '2026-09-01',
      dueDate: '2027-06-30',
      status: 'active',
      revenueMode: 'acts',
      overheadPct: '12',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ number: 'OBJ-100', name: 'ЖК Северный, корп. 2 — электромонтаж', status: 'active', revenueMode: 'acts', overheadPct: '12.00', customerName: 'ООО «Заказчик стройки»' });
    expect(res.body.projectId).toBeTruthy();
    objectId = res.body.id;
    projectId = res.body.projectId;
    const project = await owner.get(`/projects/${projectId}`);
    expect(project.status).toBe(200);
    expect(project.body).toMatchObject({ name: 'ЖК Северный, корп. 2 — электромонтаж', module: 'general' });
  });

  test('список: поиск и фильтр по статусу', async () => {
    const list = await owner.get('/objects?q=Северный&status=active');
    expect(list.status).toBe(200);
    expect(list.body.total).toBe(1);
    expect(list.body.items[0].id).toBe(objectId);
    expect((await owner.get('/objects?status=done')).body.total).toBe(0);
  });

  test('правка полей и прорабов', async () => {
    const memberId = (await owner.get('/members')).body.items.find((m: any) => m.email === member.user!.email).id;
    const res = await owner.patch(`/objects/${objectId}`, { name: 'ЖК Северный — электромонтаж', status: 'hold', foremen: [memberId] });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: 'ЖК Северный — электромонтаж', status: 'hold' });
    expect(res.body.foremen).toEqual([memberId]);
    const ok = await owner.patch(`/objects/${objectId}`, { status: 'active' });
    expect(ok.body.status).toBe('active');
  });

  test('удаление = архив; member не может, admin/owner может', async () => {
    expect((await member.del(`/objects/${objectId}`)).status).toBe(403);
    const del = await owner.del(`/objects/${objectId}`);
    expect(del.status).toBe(200);
    expect(del.body).toEqual({ id: objectId, deleted: false, archived: true });
    expect((await owner.get(`/objects/${objectId}`)).status).toBe(404);
    expect((await owner.get('/objects')).body.total).toBe(0);
    expect((await owner.get('/objects?archived=only')).body.total).toBe(1);
  });
});

describe('изоляция арендаторов', () => {
  test('чужой объект — 404, чужой заказчик — 422', async () => {
    // вернём объект из архива прямым обновлением не нужно: создаём новый
    const created = await owner.post('/objects', { number: 'OBJ-101', name: 'Склад Химки', customerId: customer });
    expect(created.status).toBe(201);
    const id = created.body.id;
    expect((await other.get(`/objects/${id}`)).status).toBe(404);
    expect((await other.patch(`/objects/${id}`, { name: 'Взлом' })).status).toBe(404);
    expect((await other.del(`/objects/${id}`)).status).toBe(404);
    const foreign = await owner.post('/objects', { number: 'OBJ-102', name: 'Чужой', customerId: otherCustomer });
    expect(foreign.status).toBe(422);
    expect(foreign.body.error.code).toBe('invalid_reference');
    objectId = id;
    projectId = created.body.projectId;
  });
});

describe('аналитика object_id и карточка', () => {
  test('документ, платёж, задача и время сохраняют объект и попадают в сводку', async () => {
    const doc = await mk(owner, '/documents', {
      type: 'receipt',
      counterpartyId: customer,
      date: '2026-10-10',
      objectId,
      lines: [{ productId: product, qty: '1', price: '500', vatRate: 'none' }],
    });
    expect(doc.objectId).toBe(objectId);
    const detail = await owner.get(`/documents/${doc.id}`);
    expect(detail.body.object).toMatchObject({ id: objectId, number: 'OBJ-101' });

    const payment = await mk(owner, '/payments', {
      type: 'cash_receipt',
      operation: 'other_income',
      organizationId: (await owner.get('/organizations')).body.items[0].id,
      cashRegisterId: cashRegister,
      date: '2026-10-11',
      lines: [{ amount: '100', objectId, cashFlowItemId: incomeItem }],
    });
    expect(payment.id).toBeTruthy();
    const paymentDetail = await owner.get(`/payments/${payment.id}`);
    expect(paymentDetail.body.lines[0].objectId).toBe(objectId);

    const task = await mk(owner, '/tasks', { projectId, title: 'Проложить кабель', objectId });
    expect(task.objectId).toBe(objectId);
    const time = await mk(owner, '/time-logs', { taskId: task.id, hours: '2', logDate: '2026-10-12', objectId });
    expect(time.objectId).toBe(objectId);

    // список задач по объекту — только задачи объекта (вторая задача без объекта в нём не видна)
    await mk(owner, '/tasks', { projectId, title: 'Задача без объекта' });
    const byObject = await owner.get(`/tasks?objectId=${objectId}`);
    expect(byObject.body.items.map((x: { id: string }) => x.id)).toEqual([task.id]);

    // чужой объект в задаче и времени — 422
    expect((await owner.post('/tasks', { projectId, title: 'Чужая', objectId: '00000000-0000-7000-8000-000000000000' })).status).toBe(422);

    const s = await owner.get(`/objects/${objectId}/summary`);
    expect(s.status).toBe(200);
    expect(s.body.taskCount).toBe(1);
    expect(s.body.documents).toHaveLength(1);
    expect(s.body.documents[0]).toMatchObject({ id: doc.id, number: null, status: 'draft', total: '500.00' });
    expect(s.body.payments).toHaveLength(1);
    expect(s.body.payments[0].amount).toBe('100.00');
    expect(s.body.canSeeCost).toBe(true);
  });

  test('member видит карточку без денег, owner — с деньгами', async () => {
    const s = await member.get(`/objects/${objectId}/summary`);
    expect(s.status).toBe(200);
    expect(s.body.canSeeCost).toBe(false);
    expect(s.body.taskCount).toBe(1);
    expect(s.body.documents[0].total).toBeNull();
    expect(s.body.payments[0].amount).toBeNull();
  });
});
