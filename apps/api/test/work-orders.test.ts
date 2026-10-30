/* Заказ-наряд: состояния и категории, виды заказ-нарядов со своими состояниями, проведение при входе в «выполнен»
   (выручка, долг клиента, расход товаров и материалов) и его откат, отмена с причиной, RLS новых таблиц,
   исполнитель из чужого воркспейса. */
import { beforeAll, describe, expect, test } from 'bun:test';
import { Client } from './helpers';

let owner: Client;
let member: Client;
let guest: Client;
let other: Client;
let ws: string;
let warehouse: string;
let customer: string;
let otherMemberId: string;

const mk = async (c: Client, path: string, body: Record<string, unknown>) => {
  const r = await c.post(path, body);
  if (r.status !== 201) throw new Error(`${path} ${JSON.stringify(body)}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};

/** Свой товар на тест: остатки не смешиваются с другими тестами */
let counter = 0;
const goods = async (name: string, purchasePrice = 100) => (await mk(owner, '/products', { name: `${name} ${++counter}`, kind: 'goods', unitCode: '006', price: 200, purchasePrice })).id;
const work = async (name: string, price = 500) => (await mk(owner, '/products', { name: `${name} ${++counter}`, kind: 'work', unitCode: '356', price })).id;

const workOrder = async (lines: { productId: string; qty: number | string; price: number | string }[], extra: Record<string, unknown> = {}) =>
  mk(owner, '/documents', { type: 'work_order', counterpartyId: customer, warehouseId: warehouse, lines, ...extra });

const setState = (id: string, state: string, body: Record<string, unknown> = {}) => owner.post(`/documents/${id}/state`, { state, ...body });
const balance = async (productId: string) => {
  const r = await owner.get(`/stock/balances?productId=${productId}&warehouseId=${warehouse}`);
  return (r.body.items[0] as { qty: string } | undefined)?.qty ?? '0';
};
/** Выручка проведённых продаж (долг клиента и выручка — это проведённые документы группы sales) */
const salesSum = async (c: Client = owner) => {
  const r = await c.get('/documents?group=sales&status=posted&limit=200');
  return r.body.sum.total as string;
};
/** Приход на склад: цена прихода = сумма строки без НДС / количество */
const receive = async (productId: string, qty: number, price: number) => {
  const d = await mk(owner, '/documents', { type: 'receipt', counterpartyId: customer, warehouseId: warehouse, priceIncludesVat: false, lines: [{ productId, qty, price }] });
  const r = await owner.post(`/documents/${d.id}/post`);
  if (r.status !== 200) throw new Error(`receipt: ${r.status} ${JSON.stringify(r.body)}`);
  return d.id;
};

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'Заказ-наряды WS' });
  ws = owner.workspaceId!;
  member = new Client();
  await member.signup();
  guest = new Client();
  await guest.signup();
  for (const [c, role] of [[member, 'member'], [guest, 'guest']] as const) {
    const inv = await owner.post(`/workspaces/${ws}/invites`, { email: c.user!.email, role });
    await c.post('/invites/accept', { token: inv.body.token });
    c.workspaceId = ws;
  }
  other = new Client();
  await other.signup({ workspaceName: 'Чужой WS' });
  warehouse = (await owner.get('/warehouses')).body.items[0].id;
  customer = (await mk(owner, '/companies', { name: 'ООО «Заказчик»', inn: '7728168971' })).id;
  const members = (await owner.get('/members')).body.items as any[];
  otherMemberId = members[0].id;
});

describe('work order: states and categories', () => {
  test('a new work order gets the default kind and the first state of the new category', async () => {
    const kinds = (await owner.get('/work-order-kinds')).body.items as any[];
    expect(kinds.length).toBe(1);
    expect(kinds[0]).toMatchObject({ name: 'Основной', isDefault: true });
    const states = (await owner.get('/document-states')).body.items as any[];
    expect(states.map(s => s.category).sort()).toEqual(['cancelled', 'delivered', 'done', 'in_progress', 'new', 'scheduled']);

    const doc = await workOrder([{ productId: await work('Монтаж'), qty: 2, price: 500 }]);
    expect(doc.state).toBe('new');
    expect(doc.status).toBe('draft');
    expect(doc.number).toBeNull();
    expect(doc.kindName).toBe('Основной');
    // состояния задаёт воркспейс: у документа свой набор
    expect(doc.states.map((s: any) => s.key)).toEqual(['new', 'scheduled', 'in_progress', 'done', 'delivered', 'cancelled']);
  });

  test('moving through the categories: the work order is posted when it reaches Done', async () => {
    const service = await work('Ремонт');
    const part = await goods('Запчасть');
    await receive(part, 10, 100);
    const doc = await workOrder([
      { productId: service, qty: 1, price: 500 },
      { productId: part, qty: 2, price: 200 },
    ]);
    const before = await balance(part);
    expect(before).toBe('10.000');

    const r1 = await setState(doc.id, 'in_progress');
    expect(r1.status).toBe(200);
    expect(r1.body.state).toBe('in_progress');

    const r2 = await setState(doc.id, 'done');
    expect(r2.status).toBe(200);
    // заказ-наряд сам проводится как продажа: номер, статус проведения и расход товара
    expect(r2.body.status).toBe('posted');
    expect(r2.body.number).toMatch(/^ЗН-\d{4}-\d{5}$/);
    expect(await balance(part)).toBe('8.000');

    const r3 = await setState(doc.id, 'delivered');
    expect(r3.status).toBe(200);
    expect(r3.body.status).toBe('posted');
  });

  test('an unknown state is rejected', async () => {
    const doc = await workOrder([{ productId: await work('Диагностика'), qty: 1, price: 100 }]);
    const r = await setState(doc.id, 'nowhere');
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('invalid_state');
  });
});

describe('work order: posting and its rollback', () => {
  test('the sale is recognized on Done and cancelled when the order goes back to work', async () => {
    const service = await work('Диагностика');
    const part = await goods('Комплектующие');
    await receive(part, 5, 100);
    const doc = await workOrder([
      { productId: service, qty: 1, price: 1000 },
      { productId: part, qty: 2, price: 200 },
    ]);
    const sumBefore = await salesSum();
    const stockBefore = await balance(part);

    expect((await setState(doc.id, 'done')).status).toBe(200);
    const sumAfter = await salesSum();
    expect(Number(sumAfter) - Number(sumBefore)).toBe(1400);
    expect(await balance(part)).toBe('3.000');

    // назад в работу — проведение снимается: выручка уходит, товар возвращается на склад
    const back = await setState(doc.id, 'in_progress');
    expect(back.status).toBe(200);
    expect(back.body.status).toBe('draft');
    expect(await salesSum()).toBe(sumBefore);
    expect(await balance(part)).toBe(stockBefore);
  });

  test('materials are written off together with the goods', async () => {
    const service = await work('Сборка');
    const part = await goods('Крепёж');
    await receive(part, 8, 50);
    const doc = await workOrder([{ productId: service, qty: 1, price: 300 }]);
    const mat = await owner.post(`/work-orders/${doc.id}/materials`, { materials: [{ productId: part, qty: 3 }] });
    expect(mat.status).toBe(200);
    expect(mat.body.materials.length).toBe(1);

    expect((await setState(doc.id, 'done')).status).toBe(200);
    expect(await balance(part)).toBe('5.000');

    // назад в работу — материалы возвращаются на склад
    expect((await setState(doc.id, 'in_progress')).status).toBe(200);
    expect(await balance(part)).toBe('8.000');
  });

  test('not enough stock: the state does not change and nothing is written', async () => {
    const part = await goods('Редкая деталь');
    await receive(part, 1, 100);
    const doc = await workOrder([{ productId: part, qty: 5, price: 200 }]);
    expect((await setState(doc.id, 'in_progress')).status).toBe(200);
    const stockBefore = await balance(part);

    const r = await setState(doc.id, 'done');
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('insufficient_stock');
    // состояние осталось прежним, склад не тронут
    const after = await owner.get(`/documents/${doc.id}`);
    expect(after.body.state).toBe('in_progress');
    expect(after.body.status).toBe('draft');
    expect(await balance(part)).toBe(stockBefore);
  });

  test('a work order is not posted by hand: the Done state does it', async () => {
    const doc = await workOrder([{ productId: await work('Консультация'), qty: 1, price: 100 }]);
    const r = await owner.post(`/documents/${doc.id}/post`);
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('work_order_state_only');
  });
});

describe('work order: kinds with their own states', () => {
  test('a kind keeps its own states and its own categories', async () => {
    const kind = await mk(owner, '/work-order-kinds', { name: 'Ремонт' });
    for (const [key, label, category, ord] of [
      ['r_new', 'Новый', 'new', 0],
      ['r_progress', 'В работе', 'in_progress', 1],
      ['r_done', 'Выполнен', 'done', 2],
    ]) {
      const st = await mk(owner, '/document-states', { kindId: kind.id, key, label, category, sortOrder: ord });
      expect(st.kindId).toBe(kind.id);
    }
    const doc = await workOrder([{ productId: await work('Ремонт стен'), qty: 1, price: 900 }], { workOrderKindId: kind.id });
    expect(doc.kindName).toBe('Ремонт');
    expect(doc.state).toBe('r_new');
    expect(doc.states.map((s: any) => s.key)).toEqual(['r_new', 'r_progress', 'r_done']);

    // состояния другого вида этому заказ-наряду не принадлежат
    const wrong = await setState(doc.id, 'done');
    expect(wrong.status).toBe(422);
    expect(wrong.body.error.code).toBe('invalid_state');

    expect((await setState(doc.id, 'r_done')).status).toBe(200);
  });

  test('a state in use cannot be deleted, and the last state of a category cannot be deleted either', async () => {
    const states = (await owner.get('/document-states')).body.items as any[];
    const done = states.find(s => s.key === 'done');
    const doc = await workOrder([{ productId: await work('Работа'), qty: 1, price: 100 }]);
    expect((await setState(doc.id, 'done')).status).toBe(200);

    const del = await owner.del(`/document-states/${done!.id}`);
    expect(del.status).toBe(409);
    expect(del.body.error.code).toBe('state_in_use');

    // последнее состояние категории удалять нельзя
    const kind = (await owner.get('/work-order-kinds')).body.items.find((k: any) => k.name === 'Ремонт');
    const own = (await owner.get(`/document-states?kindId=${kind.id}`)).body.items as any[];
    const r = await owner.del(`/document-states/${own.find(s => s.key === 'r_new').id}`);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('last_state_in_category');
  });

  test('only admins change kinds and states', async () => {
    expect((await member.post('/work-order-kinds', { name: 'Свой вид' })).status).toBe(403);
    expect((await guest.post('/document-states', { kindId: '11111111-1111-4111-8111-111111111111', key: 'x', label: 'X', category: 'new' })).status).toBe(403);
  });
});

describe('work order: cancellation', () => {
  test('cancelling requires a reason and reverses the sale', async () => {
    const part = await goods('Комплект');
    await receive(part, 4, 100);
    const doc = await workOrder([{ productId: part, qty: 2, price: 200 }]);
    const sumBefore = await salesSum();

    const noReason = await setState(doc.id, 'cancelled');
    expect(noReason.status).toBe(422);
    expect(noReason.body.error.code).toBe('cancel_reason_required');

    expect((await setState(doc.id, 'done')).status).toBe(200);
    expect(Number(await salesSum()) - Number(sumBefore)).toBe(400);

    const cancel = await setState(doc.id, 'cancelled', { cancelReason: 'Клиент отказался' });
    expect(cancel.status).toBe(200);
    expect(cancel.body.status).toBe('draft');
    expect(await salesSum()).toBe(sumBefore);
    expect(await balance(part)).toBe('4.000');
  });

  test('a finished work order is closed: only admins can move it back', async () => {
    const doc = await workOrder([{ productId: await work('Выезд'), qty: 1, price: 100 }]);
    expect((await setState(doc.id, 'done')).status).toBe(200);
    expect((await setState(doc.id, 'delivered')).status).toBe(200);
    const back = await member.post(`/documents/${doc.id}/state`, { state: 'in_progress' });
    expect(back.status).toBe(422);
    expect(back.body.error.code).toBe('invalid_state');
    // admin и выше могут вернуть закрытый заказ-наряд в работу
    expect((await setState(doc.id, 'in_progress')).status).toBe(200);
  });
});

describe('work order: print forms', () => {
  test('the job sheet shows the works, the materials and the assignees', async () => {
    const service = await work('Пусконаладка');
    const part = await goods('Фильтр');
    await receive(part, 3, 100);
    const doc = await workOrder([{ productId: service, qty: 1, price: 700 }]);
    await owner.post(`/work-orders/${doc.id}/materials`, { materials: [{ productId: part, qty: 2 }] });
    await owner.post(`/work-orders/${doc.id}/assignments`, { assigneeId: otherMemberId, title: 'Пусконаладка' });

    const r = await owner.get(`/documents/${doc.id}/print/work_order`);
    expect(r.status).toBe(200);
    const html = r.body as string;
    expect(html).toContain('Заказ-наряд');
    expect(html).toContain('Пусконаладка');
    expect(html).toContain('Фильтр');
    expect(html).toContain('ООО «Заказчик»');
  });
});

describe('work order: invoice on the basis', () => {
  test('a prepayment invoice is issued on the basis of a work order before it is performed', async () => {
    const doc = await workOrder([{ productId: await work('Работы'), qty: 1, price: 1500 }]);
    const inv = await owner.post(`/documents/${doc.id}/based-on`, { type: 'invoice' });
    expect(inv.status).toBe(201);
    expect(inv.body.type).toBe('invoice');
    expect(inv.body.basedOnId).toBe(doc.id);
    const posted = await owner.post(`/documents/${inv.body.id}/post`);
    expect(posted.status).toBe(200);
  });
});

describe('work order: assignments', () => {
  test('an assignment creates a task of the services module', async () => {
    const doc = await workOrder([{ productId: await work('Монтаж'), qty: 1, price: 400 }]);
    const r = await owner.post(`/work-orders/${doc.id}/assignments`, { assigneeId: otherMemberId, title: 'Монтаж на объекте', plannedHours: '3' });
    expect(r.status).toBe(201);
    expect(r.body.assignments.length).toBe(1);
    const a = r.body.assignments[0];
    expect(a.taskKey).toMatch(/^SERV-\d+$/);
    expect(a.assigneeId).toBe(otherMemberId);

    const tasks = (await owner.get('/tasks?module=services')).body.items as any[];
    expect(tasks.some(t => t.id === a.taskId)).toBe(true);

    const patch = await owner.patch(`/work-order-assignments/${a.taskId}`, { plannedHours: '5' });
    expect(patch.status).toBe(200);
    const after = await owner.get(`/work-orders/${doc.id}`);
    expect(after.body.assignments[0].plannedHours).toBe('5.000');
  });

  test('an assignee from another workspace is rejected', async () => {
    const doc = await workOrder([{ productId: await work('Работа'), qty: 1, price: 100 }]);
    const stranger = (await other.get('/members')).body.items[0].id;
    const r = await owner.post(`/work-orders/${doc.id}/assignments`, { assigneeId: stranger });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('invalid_reference');
  });
});

describe('work order: tenancy', () => {
  test('another workspace sees neither the work orders nor the states', async () => {
    const mine = (await owner.get('/work-orders')).body.items as any[];
    expect(mine.length).toBeGreaterThan(0);
    const theirs = (await other.get('/work-orders')).body.items as any[];
    expect(theirs.every(d => d.id !== mine[0].id)).toBe(true);

    const myStates = (await owner.get('/document-states')).body.items as any[];
    const otherStates = (await other.get('/document-states')).body.items as any[];
    expect(otherStates.every(s => !myStates.some(m => m.id === s.id))).toBe(true);
    // у другого воркспейса свой вид и свои состояния
    expect(otherStates.length).toBe(6);
  });

  test('a work order of another workspace is not accessible', async () => {
    const mine = (await owner.get('/work-orders')).body.items[0];
    expect((await other.get(`/work-orders/${mine.id}`)).status).toBe(404);
    expect((await other.get(`/documents/${mine.id}`)).status).toBe(404);
  });

  test('members read the work order, guests cannot change it', async () => {
    const doc = await workOrder([{ productId: await work('Работа'), qty: 1, price: 100 }]);
    expect((await member.get(`/work-orders/${doc.id}`)).status).toBe(200);
    expect((await guest.post(`/work-orders/${doc.id}/assignments`, { title: 'Работа' })).status).toBe(403);
  });
});

describe('work order: checks found in review', () => {
  test('the reason of cancelling is kept', async () => {
    const doc = await workOrder([{ productId: await work('Замер'), qty: 1, price: 100 }]);
    const res = await setState(doc.id, 'cancelled', { cancelReason: 'Клиент передумал' });
    expect(res.status).toBe(200);
    expect(res.body.cancelReason).toBe('Клиент передумал');
  });

  test('a delivered work order moved back to work by an admin is unposted', async () => {
    const part = await goods('Фильтр');
    await receive(part, 3, 100);
    const doc = await workOrder([{ productId: part, qty: 1, price: 200 }]);
    expect((await setState(doc.id, 'done')).status).toBe(200);
    expect((await setState(doc.id, 'delivered')).status).toBe(200);
    expect(await balance(part)).toBe('2.000');
    const back = await setState(doc.id, 'in_progress');
    expect(back.status).toBe(200);
    expect(back.body.status).toBe('draft');
    expect(await balance(part)).toBe('3.000');
  });

  test('the materials of a performed work order cannot be changed', async () => {
    const part = await goods('Хомут');
    await receive(part, 5, 10);
    const doc = await workOrder([{ productId: await work('Ремонт'), qty: 1, price: 300 }]);
    expect((await owner.post(`/work-orders/${doc.id}/materials`, { materials: [{ productId: part, qty: 2 }] })).status).toBe(200);
    expect((await setState(doc.id, 'done')).status).toBe(200);
    const res = await owner.post(`/work-orders/${doc.id}/materials`, { materials: [{ productId: part, qty: 4 }] });
    expect(res.status).toBe(409);
    expect(await balance(part)).toBe('3.000');
  });

  test('materials and assignments belong only to work orders', async () => {
    const part = await goods('Шайба');
    const order = await mk(owner, '/documents', { type: 'customer_order', counterpartyId: customer, warehouseId: warehouse, lines: [{ productId: part, qty: 1, price: 10 }] });
    expect((await owner.post(`/work-orders/${order.id}/materials`, { materials: [{ productId: part, qty: 1 }] })).status).toBe(422);
    expect((await owner.post(`/work-orders/${order.id}/assignments`, { title: 'Чужое' })).status).toBe(422);
  });

  test('a cancelled work order is not reopened by changing its kind', async () => {
    const kind = await mk(owner, '/work-order-kinds', { name: `Выездной ${++counter}` });
    const doc = await workOrder([{ productId: await work('Выезд'), qty: 1, price: 100 }]);
    expect((await setState(doc.id, 'cancelled', { cancelReason: 'Нет мастера' })).status).toBe(200);
    const res = await member.patch(`/documents/${doc.id}`, { workOrderKindId: kind.id });
    expect(res.status).toBe(422);
  });
});
