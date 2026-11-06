/* Бюджет объекта с контролем (задача 1270): бюджет по согласованной смете и согласованным допработам по категориям,
   факт материалов по себестоимости списания (перемещение — не затрата), субподряда по услугам поступлений,
   прочих затрат по «Прочим затратам» и расходным платежам без документа-основания, труд — 0 до табеля (1271).
   Политика контроля: block — 422 budget_exceeded, warn — 200 с предупреждением, none — без контроля; без согласованной сметы
   контроля нет. Суммы видит только owner/admin, изоляция арендаторов. */
import { beforeAll, describe, expect, test } from 'bun:test';
import { addMember, Client } from './helpers';

let owner: Client;
let member: Client;
let other: Client;
let wh: string;
let objectWh: string;
let supplier: string;
let customer: string;
let cable: string; // товар, закупочная цена 85
let service: string; // услуга (субподряд)
let scrap: string; // статья затрат
let expenseItem: string; // статья ДДС расходная
let bankId: string;

const mk = async (c: Client, path: string, body: Record<string, unknown> = {}) => {
  const r = await c.post(path, body);
  if (r.status >= 300) throw new Error(`${path} ${JSON.stringify(body)}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};
const uid = () => crypto.randomUUID();

/** Объект с политикой контроля бюджета */
const object = async (number: string, budgetPolicy: 'none' | 'warn' | 'block' = 'warn', extra: Record<string, unknown> = {}) =>
  (await mk(owner, '/objects', { number, name: `Объект ${number}`, budgetPolicy, ...extra })).id as string;

/** Смета объекта с позициями; approve — сразу согласовать */
async function estimate(objectId: string, items: Record<string, unknown>[], approve = true) {
  const est = await mk(owner, `/objects/${objectId}/estimates`, { name: 'Смета объекта' });
  const put = await owner.put(`/estimates/${est.id}/items`, { sections: [], items: items.map(i => ({ id: uid(), unitCode: '796', qty: '1', price: '0', ...i })) });
  if (put.status >= 300) throw new Error(`items ${est.id}: ${put.status} ${JSON.stringify(put.body)}`);
  if (approve) await mk(owner, `/estimates/${est.id}/approve`);
  return est.id as string;
}

/** Приход товара на склад по закупочной цене (без НДС) */
async function receive(productId: string, qty: number, price: number, extra: Record<string, unknown> = {}) {
  const d = await mk(owner, '/documents', { type: 'receipt', counterpartyId: supplier, warehouseId: wh, priceIncludesVat: false, lines: [{ productId, qty, price }], ...extra });
  await mk(owner, `/documents/${d.id}/post`);
  return d.id as string;
}

const expenseDoc = (type: string, body: Record<string, unknown>) => mk(owner, '/documents', { type, ...body });
const postDoc = (id: string, c: Client = owner) => c.post(`/documents/${id}/post`, {});
const budgetOf = (id: string, c: Client = owner) => c.get(`/objects/${id}/budget`);

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'Object budget WS' });
  member = await addMember(owner, 'member');
  other = new Client();
  await other.signup({ workspaceName: 'Other object budget WS' });
  wh = (await owner.get('/warehouses')).body.items[0].id;
  objectWh = (await mk(owner, '/warehouses', { name: 'Склад объекта' })).id;
  supplier = (await mk(owner, '/companies', { name: 'ООО «Кабель-Опт»' })).id;
  customer = (await mk(owner, '/companies', { name: 'ООО «Заказчик»' })).id;
  cable = (await mk(owner, '/products', { name: 'Кабель ВВГнг 3×2,5', unitCode: '006', price: 120, purchasePrice: 85 })).id;
  service = (await mk(owner, '/products', { name: 'Пусконаладка', kind: 'service', price: 1000 })).id;
  const items = (await owner.get('/cost-items')).body.items as any[];
  scrap = items.find(i => i.systemKey === 'brak').id;
  expenseItem = (await mk(owner, '/cash-flow-items', { name: 'Прочие расходы объекта', kind: 'expense' })).id;
  const orgId = (await owner.get('/organizations')).body.items[0].id;
  bankId = (await mk(owner, `/organizations/${orgId}/bank-accounts`, { bik: '044525225', account: '40702810400000000001', bankName: 'Тест-банк' })).id;
  await receive(cable, 100, 85);
});

describe('бюджет: согласованная смета и допработы', () => {
  let objectId = '';

  test('бюджет категорий: материал и щиты — material, работы — труд, субподряд, прочее', async () => {
    objectId = await object('BUD-1');
    await estimate(objectId, [
      { kind: 'material', name: 'Кабель', productId: cable, qty: '10', costPrice: '100' },
      { kind: 'panel', name: 'Щит', qty: '1', costPrice: '500' },
      { kind: 'work', name: 'Монтаж', qty: '5', costPrice: '200' },
      { kind: 'subcontract', name: 'Пусконаладка', qty: '2', costPrice: '300' },
      { kind: 'other', name: 'Вывоз мусора', qty: '1', costPrice: '400' },
    ]);
    const res = await budgetOf(objectId);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ objectId, policy: 'warn', hasEstimate: true, canSeeCost: true });
    expect(res.body.categories.material).toEqual({ budget: '1500.00', fact: '0.00', rest: '1500.00', over: false });
    expect(res.body.categories.labor).toMatchObject({ budget: '1000.00', fact: '0.00', rest: '1000.00' });
    expect(res.body.categories.subcontract).toMatchObject({ budget: '600.00', rest: '600.00' });
    expect(res.body.categories.other).toMatchObject({ budget: '400.00', rest: '400.00' });
    expect(res.body.totals).toMatchObject({ budget: '3500.00', fact: '0.00', rest: '3500.00', over: false });
  });

  test('согласованные допработы увеличивают бюджет, черновик — нет', async () => {
    const main = (await owner.get(`/objects/${objectId}/estimates`)).body.items[0];
    const change = await mk(owner, `/estimates/${main.id}/changes`, { name: 'Дополнительный кабель' });
    expect((await owner.put(`/estimates/${change.id}/items`, { sections: [], items: [{ id: uid(), kind: 'material', name: 'Кабель', productId: cable, unitCode: '796', qty: '5', price: '0', costPrice: '100' }] })).status).toBe(200);
    // черновик допработ бюджет не меняет
    expect((await budgetOf(objectId)).body.categories.material.budget).toBe('1500.00');
    await mk(owner, `/estimates/${change.id}/approve`);
    expect((await budgetOf(objectId)).body.categories.material.budget).toBe('2000.00');
    // и вторая, отклонённая допработа — тоже нет
    const rejected = await mk(owner, `/estimates/${main.id}/changes`, { name: 'Отклонённая' });
    expect((await owner.put(`/estimates/${rejected.id}/items`, { sections: [], items: [{ id: uid(), kind: 'material', name: 'Кабель', productId: cable, unitCode: '796', qty: '9', price: '0', costPrice: '100' }] })).status).toBe(200);
    expect((await budgetOf(objectId)).body.categories.material.budget).toBe('2000.00');
  });

  test('списание материала с объектом — факт по себестоимости, перемещение на склад объекта — не затрата', async () => {
    const off = await expenseDoc('write_off', { warehouseId: wh, costItemId: scrap, objectId, lines: [{ productId: cable, qty: 4, price: 0 }] });
    const posted = await postDoc(off.id);
    expect(posted.status).toBe(200);
    let res = await budgetOf(objectId);
    expect(res.body.categories.material).toMatchObject({ budget: '2000.00', fact: '340.00', rest: '1660.00', over: false });
    // перемещение на склад объекта затратой не является
    const transfer = await expenseDoc('stock_transfer', { warehouseId: wh, targetWarehouseId: objectWh, objectId, lines: [{ productId: cable, qty: 5, price: 0 }] });
    expect((await postDoc(transfer.id)).status).toBe(200);
    res = await budgetOf(objectId);
    expect(res.body.categories.material.fact).toBe('340.00');
  });

  test('субподряд: строки-услуги поступления с объектом дают факт без НДС', async () => {
    const receipt = await expenseDoc('receipt', {
      counterpartyId: supplier,
      warehouseId: wh,
      objectId,
      priceIncludesVat: false,
      lines: [{ productId: service, qty: 1, price: 500 }],
    });
    expect((await postDoc(receipt.id)).status).toBe(200);
    const res = await budgetOf(objectId);
    expect(res.body.categories.subcontract).toMatchObject({ budget: '600.00', fact: '500.00', rest: '100.00', over: false });
    // товар в поступлении субподрядом не становится
    expect(res.body.categories.material.fact).toBe('340.00');
  });
});

describe('контроль бюджета при проведении документа', () => {
  test('block: превышение — 422 budget_exceeded, документ остаётся черновиком', async () => {
    const objectId = await object('BUD-BLOCK', 'block');
    await estimate(objectId, [{ kind: 'material', name: 'Кабель', productId: cable, qty: '1', costPrice: '100' }]);
    const off = await expenseDoc('write_off', { warehouseId: wh, costItemId: scrap, objectId, lines: [{ productId: cable, qty: 2, price: 0 }] });
    const res = await postDoc(off.id);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('budget_exceeded');
    expect(res.body.error.details).toEqual({ category: 'material', budget: '100.00', fact: '170.00' });
    expect((await owner.get(`/documents/${off.id}`)).body.status).toBe('draft');
    // в пределах бюджета — проведение проходит без предупреждений
    const ok = await expenseDoc('write_off', { warehouseId: wh, costItemId: scrap, objectId, lines: [{ productId: cable, qty: 1, price: 0 }] });
    const posted = await postDoc(ok.id);
    expect(posted.status).toBe(200);
    expect(posted.body.warnings).toEqual([]);
  });

  test('warn: превышение проходит с предупреждением budget_exceeded:<категория>', async () => {
    const objectId = await object('BUD-WARN', 'warn');
    await estimate(objectId, [{ kind: 'material', name: 'Кабель', productId: cable, qty: '1', costPrice: '100' }]);
    const off = await expenseDoc('write_off', { warehouseId: wh, costItemId: scrap, objectId, lines: [{ productId: cable, qty: 2, price: 0 }] });
    const res = await postDoc(off.id);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('posted');
    expect(res.body.warnings).toContain('budget_exceeded:material');
    const budget = await budgetOf(objectId);
    expect(budget.body.categories.material).toMatchObject({ budget: '100.00', fact: '170.00', rest: '-70.00', over: true });
  });

  test('none: превышение не проверяется и предупреждений нет', async () => {
    const objectId = await object('BUD-NONE', 'none');
    await estimate(objectId, [{ kind: 'material', name: 'Кабель', productId: cable, qty: '1', costPrice: '100' }]);
    const off = await expenseDoc('write_off', { warehouseId: wh, costItemId: scrap, objectId, lines: [{ productId: cable, qty: 3, price: 0 }] });
    const res = await postDoc(off.id);
    expect(res.status).toBe(200);
    expect(res.body.warnings).toEqual([]);
  });

  test('без согласованной сметы контроля нет: черновик сметы бюджета не даёт', async () => {
    const objectId = await object('BUD-DRAFT', 'block');
    await estimate(objectId, [{ kind: 'material', name: 'Кабель', productId: cable, qty: '1', costPrice: '100' }], false);
    const budget = await budgetOf(objectId);
    expect(budget.body.hasEstimate).toBe(false);
    expect(budget.body.categories.material.budget).toBe('0.00');
    const off = await expenseDoc('write_off', { warehouseId: wh, costItemId: scrap, objectId, lines: [{ productId: cable, qty: 2, price: 0 }] });
    expect((await postDoc(off.id)).status).toBe(200);
    expect((await budgetOf(objectId)).body.categories.material.fact).toBe('170.00');
  });
});

describe('контроль бюджета при проведении платежа', () => {
  const payment = (objectId: string, amount: string, extra: Record<string, unknown> = {}) =>
    mk(owner, '/payments', {
      type: 'bank_payment',
      bankAccountId: bankId,
      operation: 'other_expense',
      lines: [{ amount, cashFlowItemId: expenseItem, objectId }],
      ...extra,
    });

  test('расходный платёж с объектом — факт «прочие затраты»; block запрещает проведение', async () => {
    const objectId = await object('BUD-PAY', 'block');
    await estimate(objectId, [{ kind: 'other', name: 'Вывоз мусора', qty: '1', costPrice: '400' }]);
    const first = await payment(objectId, '500');
    const blocked = await owner.post(`/documents/${first.id}/post`, {});
    expect(blocked.status).toBe(422);
    expect(blocked.body.error.code).toBe('budget_exceeded');
    expect(blocked.body.error.details).toEqual({ category: 'other', budget: '400.00', fact: '500.00' });
    // политика warn: платёж проходит с предупреждением, факт виден в бюджете
    await owner.patch(`/objects/${objectId}`, { budgetPolicy: 'warn' });
    const ok = await owner.post(`/documents/${first.id}/post`, {});
    expect(ok.status).toBe(200);
    expect(ok.body.warnings).toContain('budget_exceeded:other');
    expect((await budgetOf(objectId)).body.categories.other).toMatchObject({ budget: '400.00', fact: '500.00', rest: '-100.00', over: true });
  });

  test('оплата поставщику по документу-основанию не учитывается второй раз', async () => {
    const objectId = await object('BUD-PAY-DOC', 'block');
    await estimate(objectId, [
      { kind: 'subcontract', name: 'Пусконаладка', productId: service, qty: '1', costPrice: '500' },
      { kind: 'other', name: 'Прочее', qty: '1', costPrice: '100' },
    ]);
    // поступление-услуга: субподряд 500
    const receipt = await expenseDoc('receipt', { counterpartyId: supplier, warehouseId: wh, objectId, priceIncludesVat: false, lines: [{ productId: service, qty: 1, price: 500 }] });
    expect((await postDoc(receipt.id)).status).toBe(200);
    // оплата поставщику по этому поступлению: 500 в «прочие» не попадает
    const pay = await mk(owner, '/payments', {
      type: 'bank_payment',
      bankAccountId: bankId,
      operation: 'to_supplier',
      counterpartyId: supplier,
      lines: [{ settlementDocumentId: receipt.id, amount: '500', cashFlowItemId: expenseItem, objectId }],
    });
    const res = await postDoc(pay.id);
    expect(res.status).toBe(200);
    expect(res.body.warnings).toEqual([]);
    const budget = await budgetOf(objectId);
    expect(budget.body.categories.subcontract).toMatchObject({ budget: '500.00', fact: '500.00', over: false });
    expect(budget.body.categories.other).toMatchObject({ budget: '100.00', fact: '0.00', over: false });
  });
});

describe('права и изоляция арендаторов', () => {
  test('member видит структуру бюджета, но не суммы', async () => {
    const objectId = await object('BUD-RIGHTS');
    await estimate(objectId, [{ kind: 'material', name: 'Кабель', productId: cable, qty: '1', costPrice: '100' }]);
    const res = await budgetOf(objectId, member);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ policy: 'warn', hasEstimate: true, canSeeCost: false });
    expect(res.body.categories.material).toEqual({ budget: null, fact: null, rest: null, over: false });
    expect(res.body.totals.budget).toBeNull();
  });

  test('чужой арендатор бюджет не видит', async () => {
    const objectId = await object('BUD-TENANT');
    await estimate(objectId, [{ kind: 'material', name: 'Кабель', productId: cable, qty: '1', costPrice: '100' }]);
    const res = await budgetOf(objectId, other);
    expect(res.status).toBe(404);
    // и свой объект чужого арендатора в список не попадает
    const list = await other.get('/objects');
    expect(list.body.items.map((o: any) => o.id)).not.toContain(objectId);
  });

  test('политика объекта меняется через PATCH и видна в бюджете', async () => {
    const objectId = await object('BUD-POLICY', 'warn');
    expect((await owner.patch(`/objects/${objectId}`, { budgetPolicy: 'block' })).body.budgetPolicy).toBe('block');
    expect((await budgetOf(objectId)).body.policy).toBe('block');
    expect((await owner.patch(`/objects/${objectId}`, { budgetPolicy: 'none' })).body.budgetPolicy).toBe('none');
    expect((await owner.patch(`/objects/${objectId}`, { budgetPolicy: 'bogus' })).status).toBe(400);
    // без поля политика не сбрасывается
    expect((await owner.patch(`/objects/${objectId}`, { name: 'Объект BUD-POLICY новое' })).body.budgetPolicy).toBe('none');
  });

  test('чек-лист категорий заказчика: смета на объект без бюджета не мешает продаже', async () => {
    // заказчик хранится для полноты карточки: бюджет без сметы — нули, а не ошибка
    const objectId = await object('BUD-CUSTOMER', 'block', { customerId: customer });
    const res = await budgetOf(objectId);
    expect(res.status).toBe(200);
    expect(res.body.totals).toMatchObject({ budget: '0.00', fact: '0.00', rest: '0.00', over: false });
  });
});
