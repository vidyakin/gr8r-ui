/* Субподряд на объекте (задача 1274): предложение строк из заказа = остаток к приёмке, приёмка создаёт проведённое
   поступление услуг с объектом (факт subcontract в бюджете), частичное отклонение требует причины из справочника
   причин брака, принять больше заказанного нельзя, материалы списываются со склада объекта (факт material),
   без склада объекта — 422, политика бюджета block откатывает приёмку, отмена приёмки — admin+, при оплате — 422,
   отклонение акта целиком, изоляция арендаторов. */
import { beforeAll, describe, expect, test } from 'bun:test';
import { addMember, admin, Client, uniq } from './helpers';

let owner: Client;
let member: Client;
let other: Client;
let wh = '';
let objectWh = '';
let subcontractor = '';
let customer = '';
let videoId = ''; // услуга каталога: монтаж видеонаблюдения, закупочная цена 1000
let cableId = ''; // товар: кабель, закупочная цена 85
let reasonId = ''; // причина брака из справочника
let bankId = '';

const mk = async (c: Client, path: string, body: Record<string, unknown> = {}) => {
  const r = await c.post(path, body);
  if (r.status >= 300) throw new Error(`${path} ${JSON.stringify(body)}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};
const uid = () => crypto.randomUUID();

/** Объект: свой склад, заказчик и политика контроля бюджета */
async function object(number = `SUB-${uniq()}`, extra: Record<string, unknown> = {}) {
  return await mk(owner, '/objects', { number, name: `Объект ${number}`, customerId: customer, warehouseId: objectWh, ...extra });
}

/** Согласованная смета объекта: позиция субподряда (услуга каталога) и материалы */
async function estimate(objectId: string, items: Record<string, unknown>[]) {
  const est = await mk(owner, `/objects/${objectId}/estimates`, { name: 'Смета объекта' });
  const put = await owner.put(`/estimates/${est.id}/items`, {
    sections: [],
    items: items.map(i => ({ id: uid(), unitCode: '796', kind: 'subcontract', qty: '1', price: '0', costPrice: '0', ...i })),
  });
  if (put.status >= 300) throw new Error(`items ${est.id}: ${put.status} ${JSON.stringify(put.body)}`);
  await mk(owner, `/estimates/${est.id}/approve`);
  return { id: est.id as string, items: put.body.items as any[] };
}

/** Заказ субподрядчику из позиций сметы (задача 1269): объект — объект сметы, строки-услуги */
async function supplierOrder(estimateId: string, supplierId = subcontractor) {
  return await mk(owner, `/estimates/${estimateId}/supplier-order`, { supplierId });
}

/** Приход товара на основной склад, затем перемещение части на склад объекта */
async function stockAtObject(productId: string, qty: number) {
  const receipt = await mk(owner, '/documents', { type: 'receipt', counterpartyId: subcontractor, warehouseId: wh, priceIncludesVat: false, lines: [{ productId, qty, price: 85 }] });
  await mk(owner, `/documents/${receipt.id}/post`);
  const transfer = await mk(owner, '/documents', { type: 'stock_transfer', warehouseId: wh, targetWarehouseId: objectWh, lines: [{ productId, qty, price: 0 }] });
  await mk(owner, `/documents/${transfer.id}/post`);
}

const summary = async (objectId: string) => (await owner.get(`/objects/${objectId}/subcontract`)).body;
const budgetOf = async (objectId: string) => (await owner.get(`/objects/${objectId}/budget`)).body;

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'Subcontract WS' });
  member = await addMember(owner, 'member');
  other = new Client();
  await other.signup({ workspaceName: 'Other subcontract WS' });
  wh = (await owner.get('/warehouses')).body.items[0].id;
  objectWh = (await mk(owner, '/warehouses', { name: 'Склад объекта' })).id;
  subcontractor = (await mk(owner, '/companies', { name: 'ООО «ВидеоМонтаж»' })).id;
  customer = (await mk(owner, '/companies', { name: 'ООО «Заказчик стройки»' })).id;
  videoId = (await mk(owner, '/products', { name: 'Монтаж системы видеонаблюдения', kind: 'service', price: 1200, purchasePrice: 1000 })).id;
  cableId = (await mk(owner, '/products', { name: 'Кабель ВВГнг 3×2,5', unitCode: '006', price: 120, purchasePrice: 85 })).id;
  reasonId = (await mk(owner, '/defect-reasons', { name: 'Нарушение геометрии' })).id;
  const orgId = (await owner.get('/organizations')).body.items[0].id;
  bankId = (await mk(owner, `/organizations/${orgId}/bank-accounts`, { bik: '044525225', account: '40702810400000000001', bankName: 'Тест-банк' })).id;
  await stockAtObject(cableId, 50);
});

describe('заказ субподрядчику и предложение строк', () => {
  test('предложение из заказа = остаток к приёмке по строкам-услугам', async () => {
    const obj = await object();
    const est = await estimate(obj.id, [{ name: 'Монтаж видеонаблюдения (субподряд)', productId: videoId, qty: '10', price: '1500', costPrice: '1000' }]);
    const order = await supplierOrder(est.id);
    const orderDoc = (await owner.get(`/documents/${order.id}`)).body;
    expect(orderDoc).toMatchObject({ type: 'supplier_order', objectId: obj.id });
    expect(orderDoc.lines).toHaveLength(1);
    // цена строки заказа — закупочная цена каталога
    expect(orderDoc.lines[0]).toMatchObject({ productId: videoId, qty: '10.000', price: '1000.00' });

    const res = await owner.get(`/objects/${obj.id}/sub-acts/suggestion?orderId=${order.id}`);
    expect(res.status).toBe(200);
    expect(res.body.counterpartyId).toBe(subcontractor);
    expect(res.body.lines).toHaveLength(1);
    expect(res.body.lines[0]).toMatchObject({ qty: '10.000', price: '1000.00', amount: '10000.00', orderedQty: '10.000', acceptedQty: '0.000' });
    // позиция сметы подставляется по товару: по ней считается бюджет
    expect(res.body.lines[0].estimateItemId).toBe(est.items[0].id);

    // сводка: заказ виден, заказано = сумма строк-услуг заказа
    const total = await summary(obj.id);
    expect(total.orders).toHaveLength(1);
    expect(total.orders[0]).toMatchObject({ id: order.id, counterpartyName: 'ООО «ВидеоМонтаж»', ordered: '10000.00', accepted: '0.00' });
    expect(total.amounts).toMatchObject({ ordered: '10000.00', presented: '0.00', accepted: '0.00', rejected: '0.00', paid: '0.00' });

    // приняли 6 из 10: остаток к приёмке сократился
    const act = await mk(owner, `/objects/${obj.id}/sub-acts`, {
      counterpartyId: subcontractor,
      orderId: order.id,
      docNumber: '47',
      docDate: '2026-11-20',
      lines: [{ estimateItemId: est.items[0].id, qty: '10', acceptedQty: '6', defectReasonId: reasonId }],
    });
    await mk(owner, `/sub-acts/${act.id}/accept`, {});
    const after = await owner.get(`/objects/${obj.id}/sub-acts/suggestion?orderId=${order.id}`);
    expect(after.body.lines[0]).toMatchObject({ qty: '4.000', acceptedQty: '6.000' });
  });
});

describe('приёмка и отклонение', () => {
  test('принятие создаёт проведённое поступление услуг с объектом → факт subcontract в бюджете', async () => {
    const obj = await object();
    const est = await estimate(obj.id, [{ name: 'Монтаж видеонаблюдения (субподряд)', productId: videoId, qty: '10', price: '1500', costPrice: '1000' }]);
    const order = await supplierOrder(est.id);
    const act = await mk(owner, `/objects/${obj.id}/sub-acts`, {
      counterpartyId: subcontractor,
      orderId: order.id,
      docNumber: '101',
      docDate: '2026-11-25',
      periodFrom: '2026-11-01',
      periodTo: '2026-11-25',
      lines: [{ estimateItemId: est.items[0].id, qty: '10', acceptedQty: '10' }],
    });
    expect(act).toMatchObject({ status: 'draft', counterpartyName: 'ООО «ВидеоМонтаж»', orderNumber: null });
    expect(act.number).toBe(`СА-${obj.number.toUpperCase()}-01`);
    expect(act.totals).toMatchObject({ presented: '10000.00', accepted: '10000.00', rejected: '0.00' });

    const done = await mk(owner, `/sub-acts/${act.id}/accept`, {});
    expect(done.warnings).toEqual([]);
    expect(done.act.status).toBe('accepted');
    expect(done.receiptDocumentId).toBeTruthy();
    expect(done.writeOffDocumentId).toBeNull();

    const receipt = (await owner.get(`/documents/${done.receiptDocumentId}`)).body;
    expect(receipt).toMatchObject({ type: 'receipt', objectId: obj.id, counterpartyId: subcontractor, status: 'posted', priceIncludesVat: false });
    // строки — принятое количество, наименование из акта, служебная услуга воркспейса
    expect(receipt.lines).toHaveLength(1);
    expect(receipt.lines[0]).toMatchObject({ name: 'Монтаж видеонаблюдения (субподряд)', qty: '10.000', price: '1000.00', net: '10000.00' });
    expect(receipt.lines[0].productId).toBe(done.act.lines[0].productId ?? receipt.lines[0].productId);

    // бюджет: факт субподряда равен принятому, остаток = бюджет − факт
    const budget = await budgetOf(obj.id);
    expect(budget.categories.subcontract).toMatchObject({ budget: '10000.00', fact: '10000.00', rest: '0.00', over: false });

    // сводка: заказано, предъявлено, принято, оплачено
    const total = await summary(obj.id);
    expect(total.amounts).toMatchObject({ ordered: '10000.00', presented: '10000.00', accepted: '10000.00', rejected: '0.00', paid: '0.00' });
    expect(total.orders[0].accepted).toBe('10000.00');

    // принятый акт не правится, только через отмену приёмки
    const patch = await owner.patch(`/sub-acts/${act.id}`, { note: 'поздно' });
    expect(patch.status).toBe(422);
    expect(patch.body.error.code).toBe('sub_act_not_draft');
  });

  test('частичное отклонение без причины — 422, с причиной — ок и в сводке «отклонено»', async () => {
    const obj = await object();
    const est = await estimate(obj.id, [{ name: 'Монтаж видеонаблюдения (субподряд)', productId: videoId, qty: '10', price: '1500', costPrice: '1000' }]);
    const order = await supplierOrder(est.id);
    const body = { counterpartyId: subcontractor, orderId: order.id, docNumber: '55', docDate: '2026-11-26' };

    const bad = await owner.post(`/objects/${obj.id}/sub-acts`, { ...body, lines: [{ estimateItemId: est.items[0].id, qty: '10', acceptedQty: '7' }] });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('rejection_reason_required');

    const act = await mk(owner, `/objects/${obj.id}/sub-acts`, { ...body, lines: [{ estimateItemId: est.items[0].id, qty: '10', acceptedQty: '7', defectReasonId: reasonId, note: 'Три камеры не прошли приёмку' }] });
    const done = await mk(owner, `/sub-acts/${act.id}/accept`, {});
    expect(done.receiptDocumentId).toBeTruthy();
    // в поступление попало только принятое
    const receipt = (await owner.get(`/documents/${done.receiptDocumentId}`)).body;
    expect(receipt.lines[0]).toMatchObject({ qty: '7.000', net: '7000.00' });

    const total = await summary(obj.id);
    expect(total.amounts).toMatchObject({ presented: '10000.00', accepted: '7000.00', rejected: '3000.00' });
    expect(total.reasons).toHaveLength(1);
    expect(total.reasons[0]).toMatchObject({ reasonId, reasonName: 'Нарушение геометрии', amount: '3000.00', qty: '3.000' });
    // сводка по субподрядчику: те же состояния в разрезе контрагента
    expect(total.counterparties).toHaveLength(1);
    expect(total.counterparties[0]).toMatchObject({ counterpartyName: 'ООО «ВидеоМонтаж»', acts: 1, presented: '10000.00', accepted: '7000.00', rejected: '3000.00' });
    expect((await budgetOf(obj.id)).categories.subcontract.fact).toBe('7000.00');

    // строка акта хранит отклонённое количество и причину
    const view = (await owner.get(`/sub-acts/${act.id}`)).body;
    expect(view.lines[0]).toMatchObject({ qty: '10.000', acceptedQty: '7.000', rejectedQty: '3.000', reasonName: 'Нарушение геометрии', rejectedAmount: '3000.00' });
  });

  test('отклонение акта целиком с причиной: документов нет, всё в «отклонено»', async () => {
    const obj = await object();
    const est = await estimate(obj.id, [{ name: 'Монтаж видеонаблюдения (субподряд)', productId: videoId, qty: '5', price: '1500', costPrice: '1000' }]);
    const order = await supplierOrder(est.id);
    const act = await mk(owner, `/objects/${obj.id}/sub-acts`, { counterpartyId: subcontractor, orderId: order.id, docNumber: '56', docDate: '2026-11-27', lines: [{ estimateItemId: est.items[0].id, qty: '5', acceptedQty: '5' }] });
    const empty = await owner.post(`/sub-acts/${act.id}/reject`, { reason: '  ' });
    expect(empty.status).toBe(400);

    const rejected = await mk(owner, `/sub-acts/${act.id}/reject`, { reason: 'Принесли не тот объект' });
    expect(rejected.status).toBe('rejected');
    expect(rejected.rejectReason).toBe('Принесли не тот объект');
    expect(rejected.receiptDocumentId).toBeNull();

    const total = await summary(obj.id);
    expect(total.amounts).toMatchObject({ presented: '0.00', accepted: '0.00', rejected: '5000.00' });
    expect(total.reasons[0].reasonName).toBe('Принесли не тот объект');
    // отклонённый акт не даёт факта
    expect((await budgetOf(obj.id)).categories.subcontract.fact).toBe('0.00');
  });

  test('принять больше заказанного нельзя — 422 sub_act_exceeds_order', async () => {
    const obj = await object();
    const est = await estimate(obj.id, [{ name: 'Монтаж видеонаблюдения (субподряд)', productId: videoId, qty: '4', price: '1500', costPrice: '1000' }]);
    const order = await supplierOrder(est.id);
    const first = await mk(owner, `/objects/${obj.id}/sub-acts`, { counterpartyId: subcontractor, orderId: order.id, docNumber: '60', docDate: '2026-11-27', lines: [{ estimateItemId: est.items[0].id, qty: '4', acceptedQty: '4' }] });
    await mk(owner, `/sub-acts/${first.id}/accept`, {});

    const second = await mk(owner, `/objects/${obj.id}/sub-acts`, { counterpartyId: subcontractor, orderId: order.id, docNumber: '61', docDate: '2026-11-28', lines: [{ estimateItemId: est.items[0].id, qty: '1', acceptedQty: '1' }] });
    const res = await owner.post(`/sub-acts/${second.id}/accept`, {});
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('sub_act_exceeds_order');
    expect(res.body.error.details).toMatchObject({ orderedQty: '4.000', acceptedQty: '4.000', qty: '1.000' });
    // акт остался черновиком, документов нет
    expect((await owner.get(`/sub-acts/${second.id}`)).body.status).toBe('draft');
    expect((await summary(obj.id)).amounts.accepted).toBe('4000.00');
  });
});

describe('материалы субподрядчику', () => {
  test('материалы акта списываются со склада объекта → факт material', async () => {
    const obj = await object();
    const est = await estimate(obj.id, [{ name: 'Монтаж видеонаблюдения (субподряд)', productId: videoId, qty: '2', price: '1500', costPrice: '1000' }]);
    const order = await supplierOrder(est.id);
    const act = await mk(owner, `/objects/${obj.id}/sub-acts`, {
      counterpartyId: subcontractor,
      orderId: order.id,
      docNumber: '70',
      docDate: '2026-11-28',
      lines: [{ estimateItemId: est.items[0].id, qty: '2', acceptedQty: '2' }],
      materials: [{ productId: cableId, qty: '8', note: 'Кабель на камеры' }],
    });
    expect(act.materials).toHaveLength(1);
    expect(act.materials[0]).toMatchObject({ productId: cableId, qty: '8.000', name: 'Кабель ВВГнг 3×2,5' });

    const done = await mk(owner, `/sub-acts/${act.id}/accept`, {});
    expect(done.writeOffDocumentId).toBeTruthy();
    const writeOff = (await owner.get(`/documents/${done.writeOffDocumentId}`)).body;
    expect(writeOff).toMatchObject({ type: 'write_off', objectId: obj.id, warehouseId: objectWh, status: 'posted' });
    expect(writeOff.lines[0]).toMatchObject({ productId: cableId, qty: '8.000' });
    // себестоимость списания × 8 штук по 85 = 680 — факт материалов объекта
    const budget = await budgetOf(obj.id);
    expect(budget.categories.material.fact).toBe('680.00');
    expect(budget.categories.subcontract.fact).toBe('2000.00');
    expect(done.act.writeOffDocument).toMatchObject({ id: done.writeOffDocumentId, status: 'posted' });
  });

  test('без склада объекта материалы списать некуда — 422 object_warehouse_required', async () => {
    const obj = await object(`SUB-NOWH-${uniq()}`, { warehouseId: null });
    const est = await estimate(obj.id, [{ name: 'Монтаж видеонаблюдения (субподряд)', productId: videoId, qty: '1', price: '1500', costPrice: '1000' }]);
    const act = await mk(owner, `/objects/${obj.id}/sub-acts`, {
      counterpartyId: subcontractor,
      docNumber: '71',
      docDate: '2026-11-28',
      lines: [{ name: 'Монтаж камеры', unitCode: '796', qty: '1', price: '1500', acceptedQty: '1' }],
      materials: [{ productId: cableId, qty: '2' }],
    });
    const res = await owner.post(`/sub-acts/${act.id}/accept`, {});
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('object_warehouse_required');
    // приёмка откатилась целиком: ни поступления, ни списания
    expect((await owner.get(`/sub-acts/${act.id}`)).body.status).toBe('draft');
    expect((await summary(obj.id)).amounts.accepted).toBe('0.00');
    void est;
  });
});

describe('контроль бюджета при приёмке', () => {
  test('block: превышение бюджета субподряда — 422 и приёмка откатывается', async () => {
    const obj = await object(`SUB-BLOCK-${uniq()}`, { budgetPolicy: 'block' });
    const est = await estimate(obj.id, [{ name: 'Монтаж видеонаблюдения (субподряд)', productId: videoId, qty: '1', price: '1500', costPrice: '100' }]);
    const order = await supplierOrder(est.id);
    const act = await mk(owner, `/objects/${obj.id}/sub-acts`, { counterpartyId: subcontractor, orderId: order.id, docNumber: '80', docDate: '2026-11-28', lines: [{ estimateItemId: est.items[0].id, qty: '1', acceptedQty: '1' }] });
    const res = await owner.post(`/sub-acts/${act.id}/accept`, {});
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('budget_exceeded');
    expect(res.body.error.details).toMatchObject({ category: 'subcontract', budget: '100.00', fact: '1000.00' });
    expect((await owner.get(`/sub-acts/${act.id}`)).body.status).toBe('draft');
    expect((await budgetOf(obj.id)).categories.subcontract.fact).toBe('0.00');
  });

  test('warn: превышение проходит с предупреждением budget_exceeded:<категория>', async () => {
    const obj = await object(`SUB-WARN-${uniq()}`, { budgetPolicy: 'warn' });
    const est = await estimate(obj.id, [{ name: 'Монтаж видеонаблюдения (субподряд)', productId: videoId, qty: '1', price: '1500', costPrice: '100' }]);
    const order = await supplierOrder(est.id);
    const act = await mk(owner, `/objects/${obj.id}/sub-acts`, { counterpartyId: subcontractor, orderId: order.id, docNumber: '81', docDate: '2026-11-28', lines: [{ estimateItemId: est.items[0].id, qty: '1', acceptedQty: '1' }] });
    const done = await mk(owner, `/sub-acts/${act.id}/accept`, {});
    expect(done.warnings).toContain('budget_exceeded:subcontract');
    expect(done.act.status).toBe('accepted');
  });
});

describe('отмена приёмки', () => {
  test('member — 403; с оплатой — 422 sub_act_has_payments; admin отменяет и акт снова черновик', async () => {
    const obj = await object();
    const est = await estimate(obj.id, [{ name: 'Монтаж видеонаблюдения (субподряд)', productId: videoId, qty: '3', price: '1500', costPrice: '1000' }]);
    const order = await supplierOrder(est.id);
    const act = await mk(owner, `/objects/${obj.id}/sub-acts`, { counterpartyId: subcontractor, orderId: order.id, docNumber: '90', docDate: '2026-11-29', lines: [{ estimateItemId: est.items[0].id, qty: '3', acceptedQty: '3' }] });
    const done = await mk(owner, `/sub-acts/${act.id}/accept`, {});

    const forbidden = await member.post(`/sub-acts/${act.id}/unaccept`, {});
    expect(forbidden.status).toBe(403);

    // оплата по поступлению: отмена приёмки невозможна
    const pay = await mk(owner, '/payments', {
      type: 'bank_payment',
      bankAccountId: bankId,
      counterpartyId: subcontractor,
      operation: 'to_supplier',
      date: '2026-11-30',
      lines: [{ settlementDocumentId: done.receiptDocumentId, amount: '3000' }],
    });
    await mk(owner, `/documents/${pay.id}/post`);
    expect((await summary(obj.id)).amounts.paid).toBe('3000.00');

    const blocked = await owner.post(`/sub-acts/${act.id}/unaccept`, {});
    expect(blocked.status).toBe(422);
    expect(blocked.body.error.code).toBe('sub_act_has_payments');

    // отменяем оплату и приёмку: документы снимаются с проведения и отменяются, факт уходит
    await mk(owner, `/documents/${pay.id}/unpost`, {});
    await mk(owner, `/documents/${pay.id}/cancel`, {});
    const back = await mk(owner, `/sub-acts/${act.id}/unaccept`, {});
    expect(back.status).toBe('draft');
    expect(back.receiptDocumentId).toBeNull();
    expect(back.acceptedAt).toBeNull();
    const receipt = (await owner.get(`/documents/${done.receiptDocumentId}`)).body;
    expect(receipt.status).toBe('cancelled');
    expect((await budgetOf(obj.id)).categories.subcontract.fact).toBe('0.00');
    // акт снова правится и принимается заново
    const patched = await owner.patch(`/sub-acts/${act.id}`, { docNumber: '90-А' });
    expect(patched.status).toBe(200);
    expect(patched.body.docNumber).toBe('90-А');
    const again = await mk(owner, `/sub-acts/${act.id}/accept`, {});
    expect(again.act.status).toBe('accepted');
  });
});

describe('изоляция арендаторов', () => {
  test('чужой объект, акт и заказ недоступны', async () => {
    const obj = await object();
    const est = await estimate(obj.id, [{ name: 'Монтаж видеонаблюдения (субподряд)', productId: videoId, qty: '1', price: '1500', costPrice: '1000' }]);
    const order = await supplierOrder(est.id);
    const act = await mk(owner, `/objects/${obj.id}/sub-acts`, { counterpartyId: subcontractor, orderId: order.id, docNumber: '99', docDate: '2026-11-30', lines: [{ estimateItemId: est.items[0].id, qty: '1', acceptedQty: '1' }] });

    expect((await other.get(`/objects/${obj.id}/sub-acts`)).status).toBe(422);
    expect((await other.get(`/objects/${obj.id}/subcontract`)).status).toBe(422);
    expect((await other.get(`/sub-acts/${act.id}`)).status).toBe(404);
    expect((await other.post(`/sub-acts/${act.id}/accept`, {})).status).toBe(404);
    expect((await other.post(`/objects/${obj.id}/sub-acts`, { counterpartyId: subcontractor, docNumber: '1', docDate: '2026-11-30', lines: [{ name: 'Работы', qty: '1', price: '100' }] })).status).toBe(422);
    // документ существует, но чужому воркспейсу не виден
    const [row] = await admin`select count(*)::int as n from documents where id = ${order.id}`;
    expect(row.n).toBe(1);
    expect((await other.get(`/documents/${order.id}`)).status).toBe(404);
  });
});
