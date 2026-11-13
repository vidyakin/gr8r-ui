/* Смета объекта (задача 1269): CRUD и пакетное сохранение позиций, итоги, согласование (правка согласованной — 422),
   допработы только к согласованной смете, права (unapprove — admin+), изоляция арендаторов, маскирование себестоимости,
   импорт строк, заказы поставщику и на производство с аналитикой объекта, копирование сметы другого объекта. */
import { beforeAll, describe, expect, test } from 'bun:test';
import { addMember, admin, Client } from './helpers';

let owner: Client;
let member: Client;
let other: Client;
let customer: string;
let supplier: string;
let cable: string;
let subcontract: string;
let panel: string;
let objectId: string;
let object2: string;
let object3: string;
let mainId: string;
let changeId: string;

const mk = async (c: Client, path: string, body: Record<string, unknown>) => {
  const r = await c.post(path, body);
  if (r.status >= 300) throw new Error(`${path} ${JSON.stringify(body)}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};

const uid = () => crypto.randomUUID();

/** Разделы и позиции сметы: 2 раздела, 4 позиции. Итоги: 80 600 заказчику, 55 050 себестоимость, 24 ч, маржа 25 550 */
function content() {
  const sec1 = uid();
  const sec2 = uid();
  return {
    sections: [
      { id: sec1, name: 'Электромонтажные работы' },
      { id: sec2, name: 'Материалы и оборудование' },
    ],
    items: [
      { id: uid(), sectionId: sec1, kind: 'work', name: 'Монтаж кабеля', unitCode: '006', qty: '120', price: '250', costPrice: '150', laborHours: '0.2', vatRate: '20' },
      { id: uid(), sectionId: sec2, kind: 'material', name: 'Кабель ВВГнг 3×2,5', productId: cable, unitCode: '006', qty: '130', price: '120', costPrice: '85', vatRate: '20' },
      { id: uid(), sectionId: sec2, kind: 'panel', name: 'Щит распределительный ЩР-1', manufacturedItemId: panel, unitCode: '796', qty: '2', price: '15000', costPrice: '11000', vatRate: '20' },
      { id: uid(), sectionId: sec1, kind: 'subcontract', name: 'Субподряд: пусконаладка', productId: subcontract, unitCode: '796', qty: '1', price: '5000', costPrice: '4000', vatRate: '20' },
    ],
  };
}

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'Estimates WS' });
  member = await addMember(owner, 'member');
  other = new Client();
  await other.signup({ workspaceName: 'Other estimates WS' });
  customer = (await mk(owner, '/companies', { name: 'ООО «Заказчик сметы»' })).id;
  supplier = (await mk(owner, '/companies', { name: 'ООО «Кабель-Опт»' })).id;
  cable = (await mk(owner, '/products', { kind: 'goods', name: 'Кабель ВВГнг 3×2,5', unitCode: '006', price: '120', purchasePrice: '85' })).id;
  subcontract = (await mk(owner, '/products', { kind: 'service', name: 'Пусконаладочные работы', price: '5000' })).id;
  panel = (await mk(owner, '/manufactured-items', { name: 'Щит распределительный ЩР-1' })).id;
  objectId = (await mk(owner, '/objects', { number: 'OBJ-900', name: 'ЖК Северный, корп. 2 — электромонтаж', customerId: customer })).id;
  object2 = (await mk(owner, '/objects', { number: 'OBJ-901', name: 'Склад Химки — монтаж щитовой' })).id;
  object3 = (await mk(owner, '/objects', { number: 'OBJ-902', name: 'Офис — освещение' })).id;
});

describe('смета: создание и позиции', () => {
  test('основная смета объекта одна: номер присваивается, вторая — 409', async () => {
    const res = await owner.post(`/objects/${objectId}/estimates`, { name: 'Смета на электромонтаж' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ kind: 'main', status: 'draft', number: 'СМ-001', name: 'Смета на электромонтаж', parentId: null, changeStatus: null });
    mainId = res.body.id;
    const again = await owner.post(`/objects/${objectId}/estimates`, { name: 'Ещё одна' });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('estimate_exists');
  });

  test('пакетное сохранение разделов и позиций считает итоги', async () => {
    const res = await owner.put(`/estimates/${mainId}/items`, content());
    expect(res.status).toBe(200);
    expect(res.body.sections).toHaveLength(2);
    expect(res.body.items).toHaveLength(4);
    expect(res.body.totals).toEqual({ revenue: '80600.00', cost: '55050.00', hours: '24.000', margin: '25550.00', marginPct: '31.70' });
    expect(res.body.itemCount).toBe(4);
    // план-факт: факт пока нулевой, остаток равен плану
    const line = res.body.planFact.find((r: any) => r.plan.revenue === '30000.00');
    expect(line).toMatchObject({ fact: { revenue: '0.00', cost: '0.00', hours: '0.000' }, remaining: { revenue: '30000.00', cost: '18000.00', hours: '24.000' } });
  });

  test('правка позиций: удаление строки уменьшает итоги', async () => {
    const body = content();
    const detail = (await owner.get(`/estimates/${mainId}`)).body;
    // оставляем только работу из сохранённой сметы (переиспользуем её id, чтобы строка обновилась, а не пересоздалась)
    const work = detail.items.find((i: any) => i.kind === 'work');
    const res = await owner.put(`/estimates/${mainId}/items`, { sections: detail.sections, items: [{ ...work, qty: '100' }] });
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.totals.revenue).toBe('25000.00');
    expect(body.items.length).toBe(4);
    // возвращаем полный состав
    expect((await owner.put(`/estimates/${mainId}/items`, content())).status).toBe(200);
  });

  test('список смет объекта и карточка', async () => {
    const list = await owner.get(`/objects/${objectId}/estimates`);
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({ id: mainId, kind: 'main', itemCount: 4, sectionCount: 2, totals: { revenue: '80600.00' } });
    const detail = await owner.get(`/estimates/${mainId}`);
    expect(detail.body.sections.map((s: any) => s.name)).toEqual(['Электромонтажные работы', 'Материалы и оборудование']);
    expect(detail.body.canSeeCost).toBe(true);
  });

  test('member видит объёмы, но не себестоимость и маржу', async () => {
    const res = await member.get(`/estimates/${mainId}`);
    expect(res.status).toBe(200);
    expect(res.body.canSeeCost).toBe(false);
    expect(res.body.items.every((i: any) => i.costPrice === null)).toBe(true);
    expect(res.body.totals.cost).toBeNull();
    expect(res.body.totals.margin).toBeNull();
    expect(res.body.totals.revenue).toBe('80600.00');
    expect(res.body.planFact.every((r: any) => r.plan.cost === null)).toBe(true);
  });
});

describe('смета: согласование', () => {
  test('пустую смету согласовать нельзя', async () => {
    const empty = await mk(owner, `/objects/${object2}/estimates`, { name: 'Пустая смета' });
    const res = await owner.post(`/estimates/${empty.id}/approve`);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('no_items');
  });

  test('согласование фиксирует снимок: правка состава — 422 estimate_approved', async () => {
    const res = await owner.post(`/estimates/${mainId}/approve`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'approved' });
    expect(res.body.approvedAt).toBeTruthy();
    expect(res.body.approvedByName).toBeTruthy();
    const edit = await owner.put(`/estimates/${mainId}/items`, content());
    expect(edit.status).toBe(422);
    expect(edit.body.error.code).toBe('estimate_approved');
    expect((await owner.patch(`/estimates/${mainId}`, { name: 'Другое имя' })).status).toBe(422);
    expect((await owner.del(`/estimates/${mainId}`)).status).toBe(422);
    expect((await owner.post(`/estimates/${mainId}/approve`)).status).toBe(422);
  });

  test('возврат в черновик: member — 403, owner — 200', async () => {
    const denied = await member.post(`/estimates/${mainId}/unapprove`);
    expect(denied.status).toBe(403);
    const ok = await owner.post(`/estimates/${mainId}/unapprove`);
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ status: 'draft', approvedAt: null, approvedByName: null });
    expect((await owner.post(`/estimates/${mainId}/unapprove`)).status).toBe(422);
  });

  test('правка возвращённой сметы снова доступна, затем согласуем обратно', async () => {
    expect((await owner.put(`/estimates/${mainId}/items`, content())).status).toBe(200);
    expect((await owner.post(`/estimates/${mainId}/approve`)).status).toBe(200);
  });
});

describe('смета: допработы', () => {
  test('допработы создаются только к согласованной основной смете', async () => {
    const draftObject = object2;
    const draftMain = (await owner.get(`/objects/${draftObject}/estimates`)).body.items[0];
    const denied = await owner.post(`/estimates/${draftMain.id}/changes`, { name: 'Допработы' });
    expect(denied.status).toBe(422);
    expect(denied.body.error.code).toBe('estimate_not_approved');
  });

  test('допработа к согласованной смете: свой статус, номер и родитель', async () => {
    const res = await owner.post(`/estimates/${mainId}/changes`, { name: 'Дополнительная прокладка лотка' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ kind: 'change', status: 'draft', changeStatus: 'draft', parentId: mainId, number: 'СМ-001-Д1' });
    changeId = res.body.id;
    expect(res.body.parent).toMatchObject({ id: mainId, status: 'approved' });
    const item = { id: uid(), kind: 'work', name: 'Прокладка лотка', unitCode: '006', qty: '40', price: '300', costPrice: '200', laborHours: '0.1' };
    const saved = await owner.put(`/estimates/${changeId}/items`, { sections: [], items: [item] });
    expect(saved.status).toBe(200);
    expect(saved.body.totals.revenue).toBe('12000.00');
    const approved = await owner.post(`/estimates/${changeId}/approve`);
    expect(approved.body).toMatchObject({ status: 'approved', changeStatus: 'approved' });
    const list = await owner.get(`/objects/${objectId}/estimates`);
    expect(list.body.items).toHaveLength(2);
    expect(list.body.items.filter((i: any) => i.kind === 'change')).toHaveLength(1);
  });

  test('основную смету с согласованными допработами не удалить', async () => {
    expect((await owner.post(`/estimates/${mainId}/unapprove`)).status).toBe(200);
    const res = await owner.del(`/estimates/${mainId}`);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('estimate_has_changes');
    expect((await owner.post(`/estimates/${mainId}/approve`)).status).toBe(200);
  });
});

describe('смета: импорт строк', () => {
  test('строки из Excel: разделы по названию, единица по обозначению', async () => {
    const estimate = (await owner.get(`/objects/${object2}/estimates`)).body.items[0];
    const res = await owner.post(`/estimates/${estimate.id}/import`, {
      rows: [
        { section: 'Кабельные работы', kind: 'work', name: 'Прокладка лотка', unit: 'м', qty: '40', price: '300', costPrice: '200', laborHours: '0.1' },
        { section: 'Кабельные работы', kind: 'material', name: 'Кабель ВВГнг', unit: '006', qty: '45', price: '120', costPrice: '85' },
        { kind: 'other', name: 'Вывоз мусора', qty: '1', price: '2000' },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(3);
    expect(res.body.sections).toHaveLength(1);
    expect(res.body.items[0].unitCode).toBe('006');
    expect(res.body.totals.revenue).toBe('19400.00');
    expect(res.body.items[2].unitCode).toBe('796');
    // неизвестная единица не роняет импорт: базовая единица и пометка в примечании
    const unknown = await owner.post(`/estimates/${estimate.id}/import`, { rows: [{ name: 'Такелаж', unit: 'бухта', qty: '1', price: '1000' }] });
    expect(unknown.status).toBe(200);
    expect(unknown.body.items.at(-1).unitCode).toBe('796');
    expect(unknown.body.items.at(-1).note).toContain('бухта');
  });

  test('импорт в согласованную смету — 422 estimate_approved', async () => {
    expect((await owner.post(`/estimates/${changeId}/import`, { rows: [{ name: 'Строка', qty: '1', price: '1' }] })).status).toBe(422);
  });
});

describe('смета: заказы из позиций', () => {
  test('заказ поставщику: материалы и субподряд с товаром, объект — объект сметы', async () => {
    const res = await owner.post(`/estimates/${mainId}/supplier-order`, { supplierId: supplier });
    expect(res.status).toBe(201);
    expect(res.body.lines).toBe(2);
    const doc = await owner.get(`/documents/${res.body.id}`);
    expect(doc.status).toBe(200);
    expect(doc.body).toMatchObject({ type: 'supplier_order', objectId, status: 'draft' });
    expect(doc.body.lines).toHaveLength(2);
    expect(doc.body.lines.map((l: any) => l.qty).sort()).toEqual(['1.000', '130.000']);
    // цена — закупочная из каталога, а не внутренняя стоимость сметы
    expect(doc.body.lines.find((l: any) => l.productId === cable).price).toBe('85.00');
  });

  test('заказ поставщику без подходящих позиций — 422', async () => {
    const res = await owner.post(`/estimates/${changeId}/supplier-order`, { supplierId: supplier });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('nothing_to_create');
  });

  test('заказ на производство: щиты, объект — объект сметы', async () => {
    const res = await owner.post(`/estimates/${mainId}/production-order`, {});
    expect(res.status).toBe(201);
    expect(res.body.lines).toBe(1);
    const doc = await owner.get(`/documents/${res.body.id}`);
    expect(doc.status).toBe(200);
    expect(doc.body).toMatchObject({ type: 'production_order', objectId });
  });

  test('заказ по строке: спецификация, количество, связь со строкой сметы и ссылка в детали', async () => {
    const detail = (await owner.get(`/estimates/${mainId}`)).body;
    const row = detail.items.find((i: any) => i.kind === 'panel');
    const res = await owner.post(`/estimates/${mainId}/production-order`, { comment: 'По строке', lines: [{ estimateItemId: row.id, manufacturedItemId: panel, qty: '5' }] });
    expect(res.status).toBe(201);
    expect(res.body.lines).toBe(1);
    const order = await owner.get(`/production-orders/${res.body.id}`);
    expect(order.body.items[0]).toMatchObject({ itemId: panel, qty: '5.000', estimateItemId: row.id });
    const after = (await owner.get(`/estimates/${mainId}`)).body;
    const view = after.items.find((i: any) => i.id === row.id);
    expect(view.productionOrders.map((o: any) => o.id)).toContain(res.body.id);
    // старый путь тоже проставляет связь; у остальных строк заказов нет
    expect(after.items.find((i: any) => i.kind === 'material').productionOrders).toEqual([]);
    // строка не щит или чужая — 422
    const bad = await owner.post(`/estimates/${mainId}/production-order`, { lines: [{ estimateItemId: detail.items.find((i: any) => i.kind === 'material').id, manufacturedItemId: panel, qty: '1' }] });
    expect(bad.status).toBe(422);
  });

  test('фильтр спецификаций по товару', async () => {
    const product = (await mk(owner, '/products', { kind: 'goods', name: 'Щит для фильтра', price: '1' })).id;
    const spec = (await mk(owner, '/manufactured-items', { name: 'Щит фильтр', productId: product })).id;
    const res = await owner.get(`/manufactured-items?productId=${product}`);
    expect(res.body.items.map((i: any) => i.id)).toEqual([spec]);
  });

  test('заказ на производство без щитов — 422', async () => {
    const res = await owner.post(`/estimates/${changeId}/production-order`, {});
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('nothing_to_create');
  });
});

describe('смета: поставщик, замок строки и наценка', () => {
  let estId: string;
  let kindId: string;
  test('цены поставщика: вид цен поставщика, товар без цены не возвращается', async () => {
    const obj = (await mk(owner, '/objects', { number: 'OBJ-910', name: 'Объект с поставщиком' })).id;
    estId = (await mk(owner, `/objects/${obj}/estimates`, { name: 'Смета с поставщиком' })).id;
    // без вида цен поставщика — пусто
    const none = await owner.post('/estimates/supplier-prices', { supplierId: supplier, productIds: [cable] });
    expect(none.status).toBe(200);
    expect(none.body.items).toEqual([]);
    kindId = (await mk(owner, '/pricing/kinds', { name: 'Кабель-Опт: закупка', supplierId: supplier })).id;
    await admin`insert into product_prices (workspace_id, price_kind_id, product_id, date, price) values (${owner.workspaceId}, ${kindId}, ${cable}, '2020-01-01', '77.50')`;
    const res = await owner.post('/estimates/supplier-prices', { supplierId: supplier, productIds: [cable, subcontract] });
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([{ productId: cable, price: '77.50' }]);
    // архивный вид цен не используется
    await admin`update price_kinds set archived_at = now() where id = ${kindId}`;
    expect((await owner.post('/estimates/supplier-prices', { supplierId: supplier, productIds: [cable] })).body.items).toEqual([]);
    await admin`update price_kinds set archived_at = null where id = ${kindId}`;
  });

  test('member не получает цены поставщика: 403', async () => {
    const res = await member.post('/estimates/supplier-prices', { supplierId: supplier, productIds: [cable] });
    expect(res.status).toBe(403);
  });

  test('поставщик, замок и наценка сохраняются; member их не видит и не меняет', async () => {
    const itemId = uid();
    const body = {
      sections: [],
      markupPct: '25',
      items: [{ id: itemId, kind: 'material', name: 'Кабель', productId: cable, unitCode: '006', qty: '10', price: '96.88', costPrice: '77.5', supplierId: supplier, locked: true }],
    };
    const saved = await owner.put(`/estimates/${estId}/items`, body);
    expect(saved.status).toBe(200);
    expect(saved.body.markupPct).toBe('25.00');
    expect(saved.body.items[0]).toMatchObject({ supplierId: supplier, locked: true, costPrice: '77.50' });
    // не указано — не трогаем
    const again = await owner.put(`/estimates/${estId}/items`, { sections: [], items: [{ id: itemId, kind: 'material', name: 'Кабель', productId: cable, unitCode: '006', qty: '10', price: '96.88', costPrice: '77.5' }] });
    expect(again.body.markupPct).toBe('25.00');
    expect(again.body.items[0]).toMatchObject({ supplierId: supplier, locked: true });
    // member: значения null
    const view = await member.get(`/estimates/${estId}`);
    expect(view.body.markupPct).toBeNull();
    expect(view.body.items[0]).toMatchObject({ supplierId: null, locked: null, costPrice: null });
    // member сохраняет — внутренние поля остаются прежними
    const mSaved = await member.put(`/estimates/${estId}/items`, { sections: [], markupPct: '90', items: [{ id: itemId, kind: 'material', name: 'Кабель', productId: cable, unitCode: '006', qty: '11', price: '96.88', costPrice: '1', supplierId: null, locked: false }] });
    expect(mSaved.status).toBe(200);
    const check = await owner.get(`/estimates/${estId}`);
    expect(check.body.markupPct).toBe('25.00');
    expect(check.body.items[0]).toMatchObject({ qty: '11.000', supplierId: supplier, locked: true, costPrice: '77.50' });
    // снять наценку и поставщика
    const cleared = await owner.put(`/estimates/${estId}/items`, { sections: [], markupPct: null, items: [{ id: itemId, kind: 'material', name: 'Кабель', productId: cable, unitCode: '006', qty: '11', price: '96.88', costPrice: '77.5', supplierId: null, locked: false }] });
    expect(cleared.body.markupPct).toBeNull();
    expect(cleared.body.items[0]).toMatchObject({ supplierId: null, locked: false });
  });
});

describe('смета: копирование и изоляция арендаторов', () => {
  test('копирование сметы другого объекта в основную смету', async () => {
    const res = await owner.post(`/objects/${object3}/estimates/copy`, { estimateId: mainId, name: 'Смета с прошлого объекта' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ kind: 'main', status: 'draft', name: 'Смета с прошлого объекта' });
    expect(res.body.items).toHaveLength(4);
    expect(res.body.totals.revenue).toBe('80600.00');
    expect(res.body.sections).toHaveLength(2);
    expect(res.body.items.every((i: any) => i.id !== mainId)).toBe(true);
    // у объекта уже есть основная смета — вторая не создаётся
    expect((await owner.post(`/objects/${object3}/estimates/copy`, { estimateId: mainId })).status).toBe(409);
  });

  test('чужой арендатор не видит и не правит смету', async () => {
    expect((await other.get(`/estimates/${mainId}`)).status).toBe(404);
    expect((await other.put(`/estimates/${mainId}/items`, content())).status).toBe(404);
    expect((await other.post(`/estimates/${mainId}/approve`)).status).toBe(404);
    expect((await other.del(`/estimates/${mainId}`)).status).toBe(404);
    // чужая смета не копируется в свой объект
    const foreignObject = (await mk(other, '/objects', { number: 'OBJ-1', name: 'Чужой объект' })).id;
    expect((await other.post(`/objects/${foreignObject}/estimates/copy`, { estimateId: mainId })).status).toBe(404);
    // сметы чужого объекта не отдаются
    expect((await other.get(`/objects/${objectId}/estimates`)).status).toBe(422);
  });
});
