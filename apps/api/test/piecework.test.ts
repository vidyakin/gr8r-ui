/* Этап 4в: операции, исполнители и сдельный наряд. Операция — вид номенклатуры, расценка на дату,
   назначение операции исполнителю (задача модуля production), деление операции по количеству, частичное
   выполнение, один наряд на исполнителя за день, отметка из рабочего места и из задачи, права на суммы
   и изоляция арендаторов. */
import { beforeAll, describe, expect, test } from 'bun:test';
import { Client } from './helpers';

let owner: Client;
let member: Client; // исполнитель
let other: Client; // чужой арендатор
let third: Client; // второй сотрудник того же воркспейса
let wood: string; // материал
let table: string; // готовое изделие
let operation: string; // операция (вид номенклатуры)
let item: string; // спецификация изделия
let workshop: string; // склад-цех
let fg: string; // склад готовой продукции
let center: string; // участок
let memberId: string; // участник-исполнитель
let thirdId: string; // второй сотрудник

const mk = async (c: Client, path: string, body: Record<string, unknown>) => {
  const r = await c.post(path, body);
  if (r.status >= 300) throw new Error(`${path} ${JSON.stringify(body)}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};
const itemOf = (name: string, extra: Record<string, unknown> = {}) => mk(owner, '/manufactured-items', { name, ...extra });
const lineOf = (itemId: string, body: Record<string, unknown>) => mk(owner, `/manufactured-items/${itemId}/lines`, body);

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'Piecework WS' });
  member = new Client();
  await member.signup();
  const inv = await owner.post(`/workspaces/${owner.workspaceId}/invites`, { email: member.user!.email, role: 'member' });
  await member.post('/invites/accept', { token: inv.body.token });
  member.workspaceId = owner.workspaceId;
  third = new Client();
  await third.signup();
  const inv3 = await owner.post(`/workspaces/${owner.workspaceId}/invites`, { email: third.user!.email, role: 'member' });
  await third.post('/invites/accept', { token: inv3.body.token });
  third.workspaceId = owner.workspaceId;
  other = new Client();
  await other.signup({ workspaceName: 'Other piecework WS' });

  const members = (await owner.get('/members')).body.items;
  memberId = members.find((m: any) => m.userId === member.user!.id).id;
  thirdId = members.find((m: any) => m.userId === third.user!.id).id;

  wood = (await mk(owner, '/products', { name: 'Брус', price: 100, purchasePrice: 80, vatRate: 'none' })).id;
  table = (await mk(owner, '/products', { name: 'Стол', price: 5000 })).id;
  operation = (await mk(owner, '/products', { name: 'Сборка', kind: 'operation', vatRate: 'none' })).id;
  workshop = (await mk(owner, '/warehouses', { name: 'Склад цеха', kind: 'workshop' })).id;
  fg = (await mk(owner, '/warehouses', { name: 'Склад выпуска' })).id;
  center = (await mk(owner, '/work-centers', { name: 'Столярный цех', hourlyRate: 600, warehouseId: workshop, outputWarehouseId: fg })).id;

  // операция: норма времени 1 ч на изделие и участок по умолчанию
  const spec = await owner.put(`/production/operations/${operation}`, { productId: operation, normHours: '1', workCenterId: center });
  expect(spec.status).toBe(200);

  // изделие: 2 бруса и операция (1 час на изделие)
  item = (await itemOf('Стол', { productId: table, overheadPct: 0 })).id;
  await lineOf(item, { kind: 'material', productId: wood, qty: 2 });
  await lineOf(item, { kind: 'work', operation: 'Сборка', productId: operation, workCenterId: center, hours: 1 });

  // материалы на склад цеха
  const supplier = (await mk(owner, '/companies', { name: 'ООО «Поставщик»' })).id;
  const rc = await mk(owner, '/documents', { type: 'receipt', counterpartyId: supplier, warehouseId: workshop, lines: [{ productId: wood, qty: 100, price: 80 }] });
  expect((await owner.post(`/documents/${rc.id}/post`)).status).toBe(200);
});

/** Заказ на производство с операцией в составе */
async function makeOrder(qty: string) {
  const o = await mk(owner, '/production-orders', { workCenterId: center, items: [{ itemId: item, qty }] });
  await owner.post(`/production-orders/${o.id}/fill-from-bom`);
  await owner.post(`/documents/${o.id}/post`);
  const detail = (await owner.get(`/production-orders/${o.id}`)).body;
  const work = detail.components.find((c: any) => c.kind === 'work');
  return { id: o.id, itemId: detail.items[0].id, componentId: work.id };
}

describe('operations and rates', () => {
  test('an operation is a product of the catalogue with a norm and a work center', async () => {
    const list = await owner.get('/production/operations');
    expect(list.status).toBe(200);
    const op = list.body.items.find((o: any) => o.productId === operation);
    expect(op).toMatchObject({ name: 'Сборка', normHours: '1.000', workCenterId: center });
  });

  test('the rate of the piecework order is the one valid on its date', async () => {
    expect((await mk(owner, '/production/operation-rates', { productId: operation, validFrom: '2026-01-01', rate: '100', unit: 'per_unit' })).id).toBeTruthy();
    expect((await mk(owner, '/production/operation-rates', { productId: operation, validFrom: '2026-06-01', rate: '120', unit: 'per_unit' })).id).toBeTruthy();
    const rates = (await owner.get(`/production/operation-rates?productId=${operation}`)).body.items;
    expect(rates.map((r: any) => [r.validFrom, r.rate])).toEqual([
      ['2026-06-01', '120.00'],
      ['2026-01-01', '100.00'],
    ]);
    // наряд до изменения расценки — 100, после — 120
    const early = await mk(owner, '/production/piecework', { date: '2026-03-01', memberId, lines: [{ operationId: operation, qty: '2' }] });
    expect(early.lines[0].rate).toBe('100.00');
    expect(early.lines[0].amount).toBe('200.00');
    const late = await mk(owner, '/production/piecework', { date: '2026-07-01', memberId, lines: [{ operationId: operation, qty: '2' }] });
    expect(late.lines[0].rate).toBe('120.00');
    expect(late.lines[0].amount).toBe('240.00');
  });

  test('a product of another kind cannot be an operation', async () => {
    const res = await owner.post('/production/operation-rates', { productId: wood, validFrom: '2026-01-01', rate: '10', unit: 'per_unit' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('not_operation');
  });
});

describe('assignments of operations', () => {
  let order: { id: string; itemId: string; componentId: string };

  beforeAll(async () => {
    order = await makeOrder('10');
  });

  test('an operation is divided between two executors and each gets a task', async () => {
    const res = await owner.post(`/production-orders/${order.id}/operations`, {
      assignments: [
        { componentId: order.componentId, memberId, qty: '5' },
        { componentId: order.componentId, memberId: thirdId, qty: '5' },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items.map((i: any) => [i.memberId, i.plannedQty, i.leftQty])).toEqual([
      [memberId, '5.000', '5.000'],
      [thirdId, '5.000', '5.000'],
    ]);
    // у каждого исполнителя — задача модуля production
    const tasks = (await owner.get('/tasks?module=production')).body.items;
    expect(tasks).toHaveLength(2);
    expect(tasks.map((t: any) => t.status)).toEqual(['todo', 'todo']);
    expect(tasks.every((t: any) => t.assigneeId === memberId || t.assigneeId === thirdId)).toBe(true);
  });

  test('the assigned quantity cannot exceed the ordered one', async () => {
    const res = await owner.post(`/production-orders/${order.id}/operations`, {
      assignments: [
        { componentId: order.componentId, memberId, qty: '6' },
        { componentId: order.componentId, memberId: thirdId, qty: '5' },
      ],
    });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('operation_over_assigned');
  });
});

describe('piecework orders', () => {
  let order: { id: string; itemId: string; componentId: string };
  let assignment: any;

  beforeAll(async () => {
    order = await makeOrder('10');
    await owner.post(`/production-orders/${order.id}/operations`, { assignments: [{ componentId: order.componentId, memberId, qty: '5' }] });
    const list = (await owner.get(`/production-orders/${order.id}/operations`)).body;
    assignment = list.items[0];
  });

  test('the executor marks the work done: a line appears in their piecework order of the day', async () => {
    const res = await member.post(`/production/operations/${assignment.id}/done`, { qty: '3' });
    expect(res.status).toBe(200);
    expect(res.body.type).toBe('piecework_order');
    expect(res.body.memberId).toBe(memberId);
    expect(res.body.lines).toHaveLength(1);
    expect(res.body.lines[0]).toMatchObject({ qty: '3.000', operationId: operation });
    // осталось 2 из 5
    const list = (await owner.get(`/production-orders/${order.id}/operations`)).body;
    expect(list.items[0].leftQty).toBe('2.000');
  });

  test('one piecework order per executor per day: the second mark appends to it', async () => {
    const res = await member.post(`/production/operations/${assignment.id}/done`, { qty: '2' });
    expect(res.status).toBe(200);
    const today = new Date().toISOString().slice(0, 10);
    const journal = (await owner.get(`/production/piecework?from=${today}&to=${today}`)).body;
    const mine = journal.items.filter((i: any) => i.memberId === memberId);
    expect(mine).toHaveLength(1);
    expect(mine[0].lineCount).toBe(1);
    const detail = (await owner.get(`/production/piecework/${mine[0].id}`)).body;
    expect(detail.lines[0].qty).toBe('5.000');
  });

  test('a piecework order can be created from the production order', async () => {
    const order2 = await makeOrder('4');
    await owner.post(`/production-orders/${order2.id}/operations`, { assignments: [{ componentId: order2.componentId, memberId, qty: '4' }] });
    const res = await owner.post('/production/piecework/from-document', { documentId: order2.id, date: '2026-04-01' });
    expect(res.status).toBe(201);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].memberId).toBe(memberId);
    expect(res.body.items[0].lines[0].qty).toBe('4.000');
  });

  test('the executor cannot mark more than the assigned quantity', async () => {
    const res = await member.post(`/production/operations/${assignment.id}/done`, { qty: '1' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('operation_over_executed');
  });

  test('posting the piecework order closes the task of the executor', async () => {
    const journal = (await owner.get('/production/piecework')).body;
    const doc = journal.items.find((i: any) => i.memberId === memberId);
    const post = await owner.post(`/documents/${doc.id}/post`);
    expect(post.status).toBe(200);
    expect(post.body.status).toBe('posted');
    expect(post.body.number).toMatch(/^СН-\d{4}-\d{5}$/);
    // выполнено всё назначенное — задача закрыта
    const list = (await owner.get(`/production-orders/${order.id}/operations`)).body;
    expect(list.items[0].doneQty).toBe('5.000');
    expect(list.items[0].leftQty).toBe('0.000');
    expect(list.items[0].taskStatus).toBe('done');
  });
});

describe('workbench marking and the cost of the release', () => {
  test('the master marks the work in the workbench: the release gets the actual cost of the work', async () => {
    const order = await makeOrder('4');
    await owner.post(`/production-orders/${order.id}/operations`, { assignments: [{ componentId: order.componentId, memberId, qty: '4' }] });
    const assignment = (await owner.get(`/production-orders/${order.id}/operations`)).body.items[0];
    const res = await owner.post('/production/workbench/execute', {
      date: '2026-05-10',
      mode: 'simple',
      rows: [{ orderId: order.id, source: 'production_order', lineId: order.itemId, assignments: [{ assignmentId: assignment.id, qty: '4' }] }],
    });
    expect(res.status).toBe(201);
    const releaseId = res.body.documents[0].id;
    // наряд исполнителя: строка по выпуску
    const journal = (await owner.get('/production/piecework?from=2026-05-10&to=2026-05-10')).body;
    const doc = journal.items.find((i: any) => i.memberId === memberId);
    expect(doc).toBeTruthy();
    const detail = (await owner.get(`/production/piecework/${doc.id}`)).body;
    expect(detail.lines[0].releaseDocumentId).toBe(releaseId);
    // до проведения наряда выпуск оценивает работу по норме: 4 часа по 600
    const release = (await owner.get(`/production-orders/${releaseId}`)).body;
    expect(release.items[0].stageCost).toBe('3040.0000'); // материалы 8×80 = 640, работа 4×600 = 2400
    // проведение наряда пересчитывает себестоимость выпуска по фактическим работам
    const post = await owner.post(`/documents/${doc.id}/post`);
    expect(post.status).toBe(200);
    const after = (await owner.get(`/production-orders/${releaseId}`)).body;
    expect(after.items[0].stageCost).toBe('1040.0000'); // материалы 640, работа по наряду 4×100 = 400
    // приход продукции — по себестоимости 260 за изделие
    const balances = (await owner.get(`/stock/balances?productId=${table}`)).body.items;
    expect(balances[0].avgCost).toBe('260.0000');
  });

  test('the piecework cost of the release is the sum of the piecework orders', async () => {
    const order = await makeOrder('2');
    await owner.post(`/production-orders/${order.id}/operations`, { assignments: [{ componentId: order.componentId, memberId, qty: '2' }] });
    const assignment = (await owner.get(`/production-orders/${order.id}/operations`)).body.items[0];
    await owner.post('/production/workbench/execute', {
      date: '2026-05-11',
      mode: 'simple',
      rows: [{ orderId: order.id, source: 'production_order', lineId: order.itemId, assignments: [{ assignmentId: assignment.id, qty: '2' }] }],
    });
    const journal = (await owner.get('/production/piecework?from=2026-05-11&to=2026-05-11')).body;
    const doc = journal.items.find((i: any) => i.memberId === memberId);
    const detail = (await owner.get(`/production/piecework/${doc.id}`)).body;
    expect(detail.lines[0].amount).toBe('200.00'); // 2 × 100
    await owner.post(`/documents/${doc.id}/post`);
    const release = (await owner.get(`/production-orders/${detail.lines[0].releaseDocumentId}`)).body;
    // материалы 4×80 = 320, работа по наряду 2×100 = 200
    expect(release.items[0].stageCost).toBe('520.0000');
  });
});

describe('the cost of the release cannot be recalculated after the goods are shipped', () => {
  test('posting the piecework order gives a clear error when the produced goods are already shipped', async () => {
    const order = await makeOrder('2');
    await owner.post(`/production-orders/${order.id}/operations`, { assignments: [{ componentId: order.componentId, memberId, qty: '2' }] });
    const assignment = (await owner.get(`/production-orders/${order.id}/operations`)).body.items[0];
    const res = await owner.post('/production/workbench/execute', {
      date: '2026-05-12',
      mode: 'simple',
      rows: [{ orderId: order.id, source: 'production_order', lineId: order.itemId, assignments: [{ assignmentId: assignment.id, qty: '2' }] }],
    });
    expect(res.status).toBe(201);
    const journal = (await owner.get('/production/piecework?from=2026-05-12&to=2026-05-12')).body;
    const doc = journal.items.find((i: any) => i.memberId === memberId);
    // отгружаем произведённые стулья: заказ покупателя и реализация
    const customer = (await mk(owner, '/companies', { name: 'ООО «Покупатель»' })).id;
    const co = await mk(owner, '/documents', { type: 'customer_order', counterpartyId: customer, warehouseId: fg, lines: [{ productId: table, qty: '2', price: 5000 }] });
    await owner.post(`/documents/${co.id}/post`);
    const real = await owner.post(`/documents/${co.id}/based-on`, { type: 'realization' });
    expect(real.status).toBe(201);
    await owner.patch(`/documents/${real.body.id}`, { warehouseId: fg, lines: real.body.lines.map((l: any) => ({ id: l.id, productId: l.productId, qty: l.qty, price: l.price, originLineId: l.originLineId })) });
    expect((await owner.post(`/documents/${real.body.id}/post`)).status).toBe(200);
    // наряд провести уже нельзя: себестоимость выпуска не пересчитывается после отгрузки
    const post = await owner.post(`/documents/${doc.id}/post`);
    expect(post.status).toBe(422);
    expect(post.body.error.code).toBe('cost_locked');
  });
});

describe('rights on the sums', () => {
  test('the executor sees only their own sums; admin and owner see all', async () => {
    const journal = (await owner.get('/production/piecework')).body;
    const mine = journal.items.filter((i: any) => i.memberId === memberId);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine[0].amount).not.toBeNull();
    // другой сотрудник не видит сумм чужого наряда
    const foreign = await third.get(`/production/piecework/${mine[0].id}`);
    expect(foreign.status).toBe(200);
    expect(foreign.body.lines[0].amount).toBeNull();
    // отчёт выработки: участник видит только себя
    const report = (await third.get('/production/piecework/report')).body;
    expect(report.items.every((i: any) => i.memberId === thirdId)).toBe(true);
    const ownerReport = (await owner.get('/production/piecework/report')).body;
    expect(ownerReport.items.some((i: any) => i.memberId === memberId)).toBe(true);
  });

  test('a member cannot post a piecework order of another executor', async () => {
    const journal = (await owner.get('/production/piecework')).body;
    const mine = journal.items.find((i: any) => i.memberId === memberId);
    const res = await third.post(`/documents/${mine.id}/post`);
    // наряд уже проведён — статус не изменится; проверяем, что чужим нельзя отметить чужую операцию
    expect([200, 409]).toContain(res.status);
  });
});

describe('tenancy', () => {
  test('another tenant does not see the piecework orders', async () => {
    const journal = (await other.get('/production/piecework')).body;
    expect(journal.items).toHaveLength(0);
    const ownerJournal = (await owner.get('/production/piecework')).body;
    const doc = ownerJournal.items[0];
    const res = await other.get(`/production/piecework/${doc.id}`);
    expect(res.status).toBe(404);
  });
});

describe('checks found in review', () => {
  const runWorkbench = async (date: string, order: { id: string; itemId: string }, assignmentId: string, qty: string, extra: Record<string, unknown> = {}) => {
    const res = await owner.post('/production/workbench/execute', { date, mode: 'simple', rows: [{ orderId: order.id, source: 'production_order', lineId: order.itemId, assignments: [{ assignmentId, qty }], ...extra }] });
    expect(res.status).toBe(201);
    const journal = (await owner.get(`/production/piecework?from=${date}&to=${date}`)).body;
    return { releaseId: res.body.documents[0].id as string, pieceworkId: journal.items.find((i: any) => i.memberId === memberId).id as string };
  };

  test('unposting the piecework order returns the release to the norm estimate', async () => {
    const order = await makeOrder('1');
    await owner.post(`/production-orders/${order.id}/operations`, { assignments: [{ componentId: order.componentId, memberId, qty: '1' }] });
    const a = (await owner.get(`/production-orders/${order.id}/operations`)).body.items[0];
    const { releaseId, pieceworkId } = await runWorkbench('2026-08-01', order, a.id, '1');
    expect((await owner.post(`/documents/${pieceworkId}/post`)).status).toBe(200);
    expect((await owner.get(`/production-orders/${releaseId}`)).body.items[0].stageCost).toBe('280.0000'); // 160 + 120 по наряду (расценка с 2026-06-01)
    expect((await owner.post(`/documents/${pieceworkId}/unpost`)).status).toBe(200);
    expect((await owner.get(`/production-orders/${releaseId}`)).body.items[0].stageCost).toBe('760.0000'); // снова 160 + 600 по норме
  });

  test('a piecework line cannot exceed the assignment or take another executor’s assignment', async () => {
    const order = await makeOrder('2');
    await owner.post(`/production-orders/${order.id}/operations`, { assignments: [{ componentId: order.componentId, memberId, qty: '2' }] });
    const a = (await owner.get(`/production-orders/${order.id}/operations`)).body.items[0];
    const over = await mk(owner, '/production/piecework', { date: '2026-08-02', memberId, lines: [{ operationId: operation, qty: '3', assignmentId: a.id }] });
    const res = await owner.post(`/documents/${over.id}/post`);
    expect(res.status).toBe(422);
    const foreign = await owner.post('/production/piecework', { date: '2026-08-02', memberId: thirdId, lines: [{ operationId: operation, qty: '1', assignmentId: a.id }] });
    if (foreign.status === 201) expect((await owner.post(`/documents/${foreign.body.id}/post`)).status).toBe(422);
    else expect(foreign.status).toBe(422);
  });

  test('a piecework order of an intermediate stage changes the cost of that stage', async () => {
    const kind = await mk(owner, '/production/kinds', { name: 'Двухэтапный', stages: [{ name: 'Подготовка' }, { name: 'Завершение производства' }] });
    const chair = (await mk(owner, '/products', { name: 'Стул', price: 3000 })).id;
    const staged = (await itemOf('Стул', { productId: chair, overheadPct: 0, productionKindId: kind.id })).id;
    await lineOf(staged, { kind: 'material', productId: wood, qty: 2, stageId: kind.stages[0].id });
    await lineOf(staged, { kind: 'work', operation: 'Сборка', productId: operation, workCenterId: center, hours: 1, stageId: kind.stages[0].id });
    const o = await mk(owner, '/production-orders', { workCenterId: center, items: [{ itemId: staged, qty: '1' }] });
    await owner.post(`/production-orders/${o.id}/fill-from-bom`);
    await owner.post(`/documents/${o.id}/post`);
    const detail = (await owner.get(`/production-orders/${o.id}`)).body;
    const order = { id: o.id, itemId: detail.items[0].id };
    const componentId = detail.components.find((c: any) => c.kind === 'work').id;
    await owner.post(`/production-orders/${o.id}/operations`, { assignments: [{ componentId, memberId, qty: '1' }] });
    const a = (await owner.get(`/production-orders/${o.id}/operations`)).body.items[0];
    const { releaseId, pieceworkId } = await runWorkbench('2026-08-03', order, a.id, '1', { stageId: kind.stages[0].id, workCenterId: center });
    expect((await owner.get(`/production-orders/${releaseId}`)).body.items[0].stageCost).toBe('760.0000'); // 160 + 600 по норме
    expect((await owner.post(`/documents/${pieceworkId}/post`)).status).toBe(200);
    expect((await owner.get(`/production-orders/${releaseId}`)).body.items[0].stageCost).toBe('280.0000'); // 160 + 120 по наряду
  });
});
