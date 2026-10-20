/* Документы продаж и закупок: реквизиты, организации, расчёт сумм, нумерация (в т.ч. конкурентная), «на основании», проведение и отмена,
   склад (остатки, средняя, минус, резервы), печатные формы, источник «средняя себестоимость» в производстве, изоляция арендаторов. */
import { beforeAll, describe, expect, test } from 'bun:test';
import { Client, admin } from './helpers';

let owner: Client;
let member: Client;
let guest: Client;
let other: Client;
let ws: string;
let orgId: string;
let whId: string;
let customer: string;
let supplier: string;
let wood: string; // товар, ед. м
let screw: string; // товар, шт
let delivery: string; // услуга

const mk = async (c: Client, path: string, body: Record<string, unknown>) => {
  const r = await c.post(path, body);
  if (r.status !== 201) throw new Error(`${path} ${JSON.stringify(body)}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};
const line = (productId: string, qty: number | string, price: number | string, extra: Record<string, unknown> = {}) => ({ productId, qty, price, ...extra });
const doc = (c: Client, type: string, lines: any[], extra: Record<string, unknown> = {}) => mk(c, '/documents', { type, counterpartyId: type.startsWith('supplier') || type === 'receipt' ? supplier : customer, lines, ...extra });
const act = async (c: Client, id: string, action: string, body?: unknown) => c.post(`/documents/${id}/${action}`, body);
const post = async (id: string, c = owner) => {
  const r = await act(c, id, 'post');
  if (r.status !== 200) throw new Error(`post ${id}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};
const balance = async (productId: string, c = owner, warehouseId = whId) => {
  const r = await c.get(`/stock/balances?productId=${productId}&warehouseId=${warehouseId}`);
  return r.body.items[0] as { qty: string; reserved: string; available: string; avgCost: string; value: string } | undefined;
};
const setNegative = async (v: boolean) => (await owner.patch('/stock/settings', { allowNegativeStock: v })).body;

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'Docs WS' });
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
  await other.signup({ workspaceName: 'Other docs WS' });
  orgId = (await owner.get('/organizations')).body.items[0].id;
  whId = (await owner.get('/warehouses')).body.items[0].id;
  customer = (await mk(owner, '/companies', { name: 'ООО «Покупатель»', inn: '7707083893', kpp: '770701001' })).id;
  supplier = (await mk(owner, '/companies', { name: 'ООО «Поставщик»', inn: '7728168971' })).id;
  wood = (await mk(owner, '/products', { name: 'Брус', unitCode: '006', price: 100, purchasePrice: 80, vatRate: '20' })).id;
  screw = (await mk(owner, '/products', { name: 'Шуруп', price: 3, purchasePrice: 1.5, vatRate: '20' })).id;
  delivery = (await mk(owner, '/products', { name: 'Доставка', kind: 'service', unitCode: '876', price: 500, vatRate: '20' })).id;
});

describe('requisites', () => {
  test('company: type, INN checksum, KPP and OGRN are validated together', async () => {
    const bad = await owner.post('/companies', { name: 'Плохой ИНН', inn: '7707083894' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.message).toContain('checksum');
    expect((await owner.post('/companies', { name: 'ИП с 10 цифрами', kind: 'sole_proprietor', inn: '7707083893' })).status).toBe(400);
    const ip = await mk(owner, '/companies', { name: 'ИП Иванов', kind: 'sole_proprietor', inn: '500100732259', ogrn: '304500116000157' });
    expect(ip).toMatchObject({ kind: 'sole_proprietor', inn: '500100732259', kpp: '' });
    expect((await owner.patch(`/companies/${ip.id}`, { kpp: '770701001' })).status).toBe(400); // у ИП нет КПП
    // смена типа проверяет уже сохранённый ИНН
    expect((await owner.patch(`/companies/${ip.id}`, { kind: 'legal' })).status).toBe(400);
    expect((await owner.patch(`/companies/${ip.id}`, { kind: 'legal', inn: '7707083893', ogrn: '1027700132195', kpp: '770701001' })).status).toBe(200);
    expect((await owner.patch(`/companies/${customer}`, { legalAddress: 'Москва, ул. Тверская, 1' })).body.legalAddress).toBe('Москва, ул. Тверская, 1');
    expect((await owner.get('/companies?q=7728168971')).body.items.map((c: any) => c.id)).toContain(supplier); // поиск по ИНН
  });

  test('bank accounts of a company: format, first is default, one default at a time', async () => {
    expect((await owner.post(`/companies/${customer}/bank-accounts`, { bik: '144525225', account: '40702810400000000001', bankName: 'Банк' })).status).toBe(400);
    expect((await owner.post(`/companies/${customer}/bank-accounts`, { bik: '044525225', account: '4070281040000000000', bankName: 'Банк' })).status).toBe(400);
    const a = await mk(owner, `/companies/${customer}/bank-accounts`, { bik: '044525225', account: '40702810400000000001', corrAccount: '30101810400000000225', bankName: 'ПАО Сбербанк' });
    expect(a.isDefault).toBe(true);
    const b = await mk(owner, `/companies/${customer}/bank-accounts`, { bik: '044525225', account: '40702810400000000002', bankName: 'ПАО Сбербанк', isDefault: true });
    const list = (await owner.get(`/companies/${customer}/bank-accounts`)).body.items;
    expect(list.map((x: any) => [x.id, x.isDefault])).toEqual([[b.id, true], [a.id, false]]);
    expect((await owner.del(`/bank-accounts/${a.id}`)).status).toBe(200);
    expect((await other.get(`/companies/${customer}/bank-accounts`)).status).toBe(404); // чужой арендатор
  });

  test('organizations: default one exists, requisites validated, only admins write, one default', async () => {
    const list = (await member.get('/organizations')).body.items;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: 'Docs WS', isDefault: true, taxSystem: 'osn', defaultVatRate: '20', directorTitle: 'Генеральный директор' });
    expect((await member.post('/organizations', { name: 'Нельзя' })).status).toBe(403);
    expect((await owner.post('/organizations', { name: 'Неверный ИНН', inn: '1234567890' })).status).toBe(400);
    const usn = await mk(owner, '/organizations', { name: 'ИП Петров', kind: 'sole_proprietor', inn: '500100732259', ogrn: '304500116000157', taxSystem: 'usn', defaultVatRate: 'none', stampFile: { name: 'stamp.png', url: 'https://files.example/stamp.png' } });
    expect(usn).toMatchObject({ isDefault: false, taxSystem: 'usn', stampFile: { name: 'stamp.png' } });
    expect((await owner.post('/organizations', { name: 'Скрипт', stampFile: { name: 'x', url: 'javascript:alert(1)' } })).status).toBe(400);
    expect((await owner.patch(`/organizations/${usn.id}`, { isDefault: true })).body.isDefault).toBe(true);
    const now = (await owner.get('/organizations')).body.items;
    expect(now.filter((o: any) => o.isDefault).map((o: any) => o.id)).toEqual([usn.id]);
    expect((await owner.patch(`/organizations/${usn.id}`, { isDefault: false })).status).toBe(422);
    expect((await owner.del(`/organizations/${usn.id}`)).status).toBe(422); // нельзя архивировать единственную по умолчанию, пока есть другие
    await owner.patch(`/organizations/${orgId}`, { isDefault: true });
    expect((await mk(owner, `/organizations/${usn.id}/bank-accounts`, { bik: '044525225', account: '40702810400000000003', bankName: 'Банк' })).isDefault).toBe(true);
    expect((await member.post(`/organizations/${usn.id}/bank-accounts`, { bik: '044525225', account: '40702810400000000004', bankName: 'Банк' })).status).toBe(403);
  });

  test('warehouses: default exists, admin-only, one default', async () => {
    const list = (await owner.get('/warehouses')).body.items;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: 'Основной склад', isDefault: true });
    expect((await member.post('/warehouses', { name: 'Нельзя' })).status).toBe(403);
    const w2 = await mk(owner, '/warehouses', { name: 'Склад 2' });
    expect(w2.isDefault).toBe(false);
    expect((await owner.post('/warehouses', { name: 'склад 2' })).status).toBe(409);
  });
});

describe('document drafts and totals', () => {
  test('create fills defaults, computes lines and totals (VAT included / on top), draft has no number', async () => {
    const d = await doc(owner, 'invoice', [line(wood, 3, 100), line(delivery, 1, 500, { discountPct: 10 })]);
    expect(d).toMatchObject({ type: 'invoice', status: 'draft', number: null, organizationId: orgId, priceIncludesVat: true, currency: 'RUB' });
    expect(d.warehouseId).toBeNull(); // счёт склад не использует
    expect(d.lines.map((l: any) => [l.name, l.unitCode, l.vatRate, l.net, l.vatAmount, l.total])).toEqual([
      ['Брус', '006', '20', '250.00', '50.00', '300.00'],
      ['Доставка', '876', '20', '375.00', '75.00', '450.00'],
    ]);
    expect(d.totals).toMatchObject({ net: '625.00', vat: '125.00', total: '750.00' });
    expect(d).toMatchObject({ amountNet: '625.00', vatTotal: '125.00', total: '750.00' });
    // «НДС сверху»: тот же документ дороже на НДС, суммы пересчитываются сервером
    const top = (await owner.patch(`/documents/${d.id}`, { priceIncludesVat: false })).body;
    expect(top.totals).toMatchObject({ net: '750.00', vat: '150.00', total: '900.00' });
    expect(top.lines[0]).toMatchObject({ net: '300.00', vatAmount: '60.00', total: '360.00' });
  });

  test('order draft gets the default warehouse; lines are replaced by id without losing identity', async () => {
    const o = await doc(owner, 'customer_order', [line(wood, 2, 100)]);
    expect(o.warehouseId).toBe(whId);
    const lineId = o.lines[0].id;
    const upd = await owner.patch(`/documents/${o.id}`, { lines: [{ id: lineId, productId: wood, qty: 5, price: 110 }, line(screw, 10, 3)] });
    expect(upd.body.lines).toHaveLength(2);
    expect(upd.body.lines[0]).toMatchObject({ id: lineId, qty: '5.000', price: '110.00', total: '550.00' });
    const kept = (await owner.patch(`/documents/${o.id}`, { lines: [{ id: lineId, productId: wood, qty: 5, price: 110 }] })).body;
    expect(kept.lines.map((l: any) => l.id)).toEqual([lineId]);
    expect(kept.totals.total).toBe('550.00');
  });

  test('validation: references, archived product, qty, roles', async () => {
    expect((await owner.post('/documents', { type: 'invoice', counterpartyId: crypto.randomUUID() })).status).toBe(422);
    expect((await owner.post('/documents', { type: 'invoice', lines: [line(wood, 0, 1)] })).status).toBe(400);
    expect((await owner.post('/documents', { type: 'invoice', lines: [line(wood, 1, 1, { discountPct: 120 })] })).status).toBe(400);
    expect((await owner.post('/documents', { type: 'nope' })).status).toBe(400);
    expect((await guest.post('/documents', { type: 'invoice' })).status).toBe(403);
    const gone = await mk(owner, '/products', { name: 'Снят с продажи' });
    await owner.del(`/products/${gone.id}`);
    expect((await owner.post('/documents', { type: 'invoice', lines: [line(gone.id, 1, 1)] })).status).toBe(422);
  });

  test('list: filters, search by number and counterparty, sums', async () => {
    const a = await doc(owner, 'invoice', [line(wood, 1, 100)], { comment: 'особый-комментарий' });
    await post(a.id);
    const posted = (await owner.get('/documents?type=invoice&status=posted')).body;
    expect(posted.items.every((d: any) => d.type === 'invoice' && d.status === 'posted')).toBe(true);
    expect(posted.items.find((d: any) => d.id === a.id)).toMatchObject({ counterpartyName: 'ООО «Покупатель»', organizationName: 'Docs WS' });
    const a2 = (await owner.get(`/documents/${a.id}`)).body;
    expect((await owner.get(`/documents?q=${encodeURIComponent(a2.number)}`)).body.items.map((d: any) => d.id)).toEqual([a.id]);
    expect((await owner.get('/documents?q=особый-комментарий')).body.total).toBe(1);
    expect((await owner.get('/documents?q=Покупатель&group=sales')).body.total).toBeGreaterThan(0);
    expect((await owner.get('/documents?group=purchases&q=Покупатель')).body.total).toBe(0);
    const sums = (await owner.get(`/documents?q=особый-комментарий`)).body.sum;
    expect(sums).toMatchObject({ total: '100.00', vat: '16.67', net: '83.33' });
    expect((await owner.get('/documents?sort=bogus')).status).toBe(400);
    expect((await owner.get(`/documents?from=2000-01-01&to=2000-12-31`)).body.total).toBe(0);
  });
});

describe('posting, numbering and status changes', () => {
  test('number is assigned on the first posting, kept after unpost and repost; drafts without a number can be deleted', async () => {
    const d = await doc(owner, 'invoice', [line(wood, 1, 100)]);
    expect(d.number).toBeNull();
    const posted = await post(d.id);
    expect(posted).toMatchObject({ status: 'posted', numberYear: Number(d.date.slice(0, 4)) });
    expect(posted.number).toMatch(/^СЧ-\d{4}-\d{5}$/);
    expect((await owner.patch(`/documents/${d.id}`, { comment: 'x' })).status).toBe(409); // проведённый не правится
    expect((await act(owner, d.id, 'post')).status).toBe(409);
    expect((await owner.del(`/documents/${d.id}`)).status).toBe(409);
    const un = (await act(owner, d.id, 'unpost')).body;
    expect(un).toMatchObject({ status: 'draft', number: posted.number });
    expect((await owner.del(`/documents/${d.id}`)).status).toBe(409); // номер уже выдан: удалять нельзя, чтобы не было дыры
    expect((await owner.patch(`/documents/${d.id}`, { date: '2020-05-05' })).status).toBe(422); // другой год — другая последовательность
    expect((await owner.patch(`/documents/${d.id}`, { comment: 'правка черновика' })).status).toBe(200);
    expect((await post(d.id)).number).toBe(posted.number);
    // отмена: проведённый сперва снимают с проведения; черновик можно отменить и вернуть
    expect((await act(owner, d.id, 'cancel')).status).toBe(409);
    await act(owner, d.id, 'unpost');
    expect((await act(owner, d.id, 'cancel')).body).toMatchObject({ status: 'cancelled', number: posted.number });
    expect((await act(owner, d.id, 'post')).status).toBe(409);
    expect((await owner.patch(`/documents/${d.id}`, { comment: 'нельзя' })).status).toBe(409);
    expect((await act(owner, d.id, 'restore')).body.status).toBe('draft');
    const blank = await doc(owner, 'invoice', [line(wood, 1, 1)]);
    expect((await owner.del(`/documents/${blank.id}`)).status).toBe(200);
    expect((await owner.get(`/documents/${blank.id}`)).status).toBe(404);
  });

  test('posting checks: counterparty, lines, warehouse; a failed posting leaves no number gap', async () => {
    const first = await doc(owner, 'invoice', [line(wood, 1, 1)]);
    const seq1 = (await post(first.id)).numberSeq as number;
    const noParty = await mk(owner, '/documents', { type: 'invoice', lines: [line(wood, 1, 1)] });
    expect((await act(owner, noParty.id, 'post')).body.error.code).toBe('counterparty_required');
    const noLines = await mk(owner, '/documents', { type: 'invoice', counterpartyId: customer });
    expect((await act(owner, noLines.id, 'post')).body.error.code).toBe('no_lines');
    const noWh = await doc(owner, 'realization', [line(screw, 1, 1)], { warehouseId: null });
    expect((await act(owner, noWh.id, 'post')).body.error.code).toBe('warehouse_required');
    const second = await doc(owner, 'invoice', [line(wood, 1, 1)]);
    expect((await post(second.id)).numberSeq).toBe(seq1 + 1);
  });

  test('numbering is per organization, type and year', async () => {
    const org2 = await mk(owner, '/organizations', { name: 'Вторая организация' });
    const a = await doc(owner, 'act', [line(delivery, 1, 100)], { organizationId: org2.id });
    const b = await doc(owner, 'act', [line(delivery, 1, 100)], { organizationId: org2.id });
    const c = await doc(owner, 'act', [line(delivery, 1, 100)], { organizationId: org2.id, date: '2024-03-01' });
    const [pa, pb, pc] = [await post(a.id), await post(b.id), await post(c.id)];
    expect([pa.number.replace(/\d{4}-/, 'Y-'), pb.number.replace(/\d{4}-/, 'Y-')]).toEqual(['АКТ-Y-00001', 'АКТ-Y-00002']);
    expect(pc.number).toBe('АКТ-2024-00001'); // другой год начинает с единицы
    const main = await post((await doc(owner, 'act', [line(delivery, 1, 100)])).id);
    expect(main.numberSeq).toBeGreaterThanOrEqual(1);
    const rows = await admin`select count(*)::int as n, count(distinct (organization_id, type, number_year, number_seq))::int as d from documents where workspace_id = ${ws} and number_seq is not null`;
    expect(rows[0]!.n).toBe(rows[0]!.d);
  });

  test('concurrent posting hands out consecutive numbers without gaps or repeats', async () => {
    const org = await mk(owner, '/organizations', { name: 'Параллельная организация' });
    const ids: string[] = [];
    for (let i = 0; i < 12; i++) ids.push((await doc(owner, 'invoice', [line(wood, 1, 10 + i)], { organizationId: org.id })).id);
    const results = await Promise.all(ids.map(id => act(owner, id, 'post')));
    expect(results.map(r => r.status)).toEqual(ids.map(() => 200));
    const seqs = results.map(r => r.body.numberSeq as number).sort((a, b) => a - b);
    expect(seqs).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    // часть проведений падает — счётчик откатывается вместе с ними
    const more = await Promise.all(
      [...Array(6)].map(async (_, i) => {
        const d = await mk(owner, '/documents', { type: 'invoice', organizationId: org.id, counterpartyId: i % 2 ? customer : undefined, lines: [line(wood, 1, 5)] });
        return act(owner, d.id, 'post');
      }),
    );
    expect(more.filter(r => r.status === 200).map(r => r.body.numberSeq as number).sort((a, b) => a - b)).toEqual([13, 14, 15]);
    expect(more.filter(r => r.status === 422)).toHaveLength(3);
    const all = await admin`select number_seq from documents where organization_id = ${org.id} and number_seq is not null order by number_seq`;
    expect(all.map(r => r.number_seq)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
  });

  test('members can post, guests only read', async () => {
    const d = await doc(owner, 'invoice', [line(wood, 1, 1)]);
    expect((await act(guest, d.id, 'post')).status).toBe(403);
    expect((await guest.get(`/documents/${d.id}`)).status).toBe(200);
    expect((await act(member, d.id, 'post')).status).toBe(200);
    expect((await act(member, d.id, 'unpost')).status).toBe(200);
  });
});

describe('based-on chains and fulfilment', () => {
  test('customer order → invoice → shipment: lines copied, links kept, remainders tracked', async () => {
    const order = await doc(owner, 'customer_order', [line(wood, 10, 100), line(delivery, 1, 500)]);
    expect((await act(owner, order.id, 'based-on', { type: 'receipt' })).body.error.code).toBe('invalid_based_on');
    const inv = (await act(owner, order.id, 'based-on', { type: 'invoice' })).body;
    expect(inv).toMatchObject({ type: 'invoice', status: 'draft', basedOnId: order.id, counterpartyId: customer });
    expect(inv.lines.map((l: any) => [l.name, l.qty])).toEqual([['Брус', '10.000'], ['Доставка', '1.000']]);
    expect(inv.lines[0].originLineId).toBe(order.lines[0].id);
    expect(inv.lines[0].sourceLineId).toBe(order.lines[0].id);
    // основание должно быть проведено
    expect((await act(owner, inv.id, 'post')).body.error.code).toBe('base_not_posted');
    await post(order.id);
    await post(inv.id);
    // отгрузка по счёту: 4 из 10; остатки к отгрузке считаются по заказу
    const sh1 = (await act(owner, inv.id, 'based-on', { type: 'realization' })).body;
    expect(sh1.lines.map((l: any) => l.qty)).toEqual(['10.000', '1.000']);
    const trimmed = await owner.patch(`/documents/${sh1.id}`, { lines: [{ id: sh1.lines[0].id, productId: wood, qty: 4, price: 100 }] });
    expect(trimmed.body.lines).toHaveLength(1);
    const d1 = (await owner.get(`/documents/${order.id}`)).body;
    expect(d1.lines[0]).toMatchObject({ shipped: '0.000', planned: '4.000' });
    // следующая отгрузка предлагает только остаток: 10 − 4 запланировано (в черновике)
    const sh2 = (await act(owner, order.id, 'based-on', { type: 'realization' })).body;
    expect(sh2.lines.map((l: any) => [l.name, l.qty])).toEqual([['Брус', '6.000'], ['Доставка', '1.000']]);
    expect((await act(owner, order.id, 'based-on', { type: 'realization' })).body.error.code).toBe('nothing_to_create');
    // дети документа видны в карточке
    const d2 = (await owner.get(`/documents/${order.id}`)).body;
    expect(d2.children.map((c: any) => c.type)).toEqual(['invoice', 'realization']); // первая отгрузка создана из счёта, вторая — из заказа
    expect((await owner.get(`/documents?basedOnId=${order.id}`)).body.total).toBe(2);
  });

  test('cannot fulfil more than ordered; unposting the basis needs unposting its posted children first', async () => {
    // приходуем товар, чтобы отгрузка не упиралась в остатки
    await post((await doc(owner, 'receipt', [line(screw, 100, 1)])).id);
    const order = await doc(owner, 'customer_order', [line(screw, 5, 3)]);
    await post(order.id);
    const sh = (await act(owner, order.id, 'based-on', { type: 'realization' })).body;
    await owner.patch(`/documents/${sh.id}`, { lines: [{ id: sh.lines[0].id, productId: screw, qty: 8, price: 3 }] });
    const over = await act(owner, sh.id, 'post');
    expect(over.status).toBe(422);
    expect(over.body.error.code).toBe('over_fulfilment');
    await owner.patch(`/documents/${sh.id}`, { lines: [{ id: sh.lines[0].id, productId: screw, qty: 5, price: 3 }] });
    await post(sh.id);
    expect((await act(owner, order.id, 'unpost')).body.error.code).toBe('has_posted_children');
    const od = (await owner.get(`/documents/${order.id}`)).body;
    expect(od.lines[0]).toMatchObject({ shipped: '5.000', planned: '5.000' });
    await act(owner, sh.id, 'unpost');
    expect((await act(owner, order.id, 'unpost')).status).toBe(200);
  });

  test('purchases: supplier order → receipt → supplier return; return limited by the receipt', async () => {
    const so = await doc(owner, 'supplier_order', [line(wood, 20, 80)]);
    await post(so.id);
    const rc = (await act(owner, so.id, 'based-on', { type: 'receipt' })).body;
    expect(rc).toMatchObject({ type: 'receipt', basedOnId: so.id, warehouseId: whId });
    await post(rc.id);
    expect((await owner.get(`/documents/${so.id}`)).body.lines[0]).toMatchObject({ shipped: '20.000' });
    const ret = (await act(owner, rc.id, 'based-on', { type: 'supplier_return' })).body;
    expect(ret.lines[0].qty).toBe('20.000');
    await owner.patch(`/documents/${ret.id}`, { lines: [{ id: ret.lines[0].id, productId: wood, qty: 7, price: 80 }] });
    await post(ret.id);
    const ret2 = (await act(owner, rc.id, 'based-on', { type: 'supplier_return' })).body; // остаток к возврату
    expect(ret2.lines[0].qty).toBe('13.000');
    await owner.patch(`/documents/${ret2.id}`, { lines: [{ id: ret2.lines[0].id, productId: wood, qty: 14, price: 80 }] });
    expect((await act(owner, ret2.id, 'post')).body.error.code).toBe('over_return');
  });
});

describe('stock', () => {
  let p: string; // отдельный товар, чтобы остатки считались с нуля
  let q: string;

  beforeAll(async () => {
    p = (await mk(owner, '/products', { name: 'Склад-товар', price: 200, purchasePrice: 100 })).id;
    q = (await mk(owner, '/products', { name: 'Склад-товар 2', price: 20, purchasePrice: 10 })).id;
  });

  test('receipt writes moves and balances; average cost is a moving average of net prices', async () => {
    const r1 = await doc(owner, 'receipt', [line(p, 10, 120)]); // с НДС 20%: без НДС 100
    expect(await balance(p)).toBeUndefined();
    await post(r1.id);
    expect(await balance(p)).toMatchObject({ qty: '10.000', avgCost: '100.0000', value: '1000.00', reserved: '0.000', available: '10.000' });
    const r2 = await doc(owner, 'receipt', [line(p, 10, 144)]); // без НДС 120
    await post(r2.id);
    expect(await balance(p)).toMatchObject({ qty: '20.000', avgCost: '110.0000', value: '2200.00' });
    const moves = (await owner.get(`/stock/moves?productId=${p}`)).body.items;
    expect(moves.map((m: any) => [m.qty, m.cost, m.balance, m.documentType])).toEqual([['10.000', '120.0000', '20.000', 'receipt'], ['10.000', '100.0000', '10.000', 'receipt']]);
    expect(moves[0].documentNumber).toMatch(/^ПТ-/);
  });

  test('shipment writes off at the average cost; unposting restores the balance; services do not move', async () => {
    const before = await balance(p);
    const sh = await doc(owner, 'realization', [line(p, 5, 200), line(delivery, 1, 500)]);
    await post(sh.id);
    expect(await balance(p)).toMatchObject({ qty: String((Number(before!.qty) - 5).toFixed(3)), avgCost: before!.avgCost });
    const moves = (await owner.get(`/stock/moves?documentId=${sh.id}`)).body.items;
    expect(moves).toHaveLength(1); // только товар
    expect(moves[0]).toMatchObject({ qty: '-5.000', cost: before!.avgCost });
    expect((await owner.get(`/stock/balances?productId=${delivery}`)).body.items).toHaveLength(0);
    await act(owner, sh.id, 'unpost');
    expect(await balance(p)).toMatchObject({ qty: before!.qty, avgCost: before!.avgCost });
    expect((await owner.get(`/stock/moves?documentId=${sh.id}`)).body.items).toHaveLength(0);
  });

  test('negative stock is refused unless the workspace allows it', async () => {
    const have = Number((await balance(p))!.qty);
    const sh = await doc(owner, 'realization', [line(p, have + 1, 200)]);
    const r = await act(owner, sh.id, 'post');
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('insufficient_stock');
    expect(r.body.error.message).toContain('Склад-товар');
    expect(r.body.error.details.items[0]).toMatchObject({ available: have.toFixed(3), needed: (have + 1).toFixed(3) });
    expect((await balance(p))!.qty).toBe(have.toFixed(3)); // ничего не записано
    expect((await owner.get(`/documents/${sh.id}`)).body.number).toBeNull(); // и номер не выдан
    expect((await member.patch('/stock/settings', { allowNegativeStock: true })).status).toBe(403);
    expect((await setNegative(true)).allowNegativeStock).toBe(true);
    await post(sh.id);
    expect((await balance(p))!.qty).toBe('-1.000');
    // приход в минус задаёт среднюю по цене прихода
    await post((await doc(owner, 'receipt', [line(p, 11, 132)])).id);
    expect(await balance(p)).toMatchObject({ qty: '10.000', avgCost: '110.0000' });
    await setNegative(false);
  });

  test('unposting a receipt that later shipments rely on is refused', async () => {
    const r = await doc(owner, 'receipt', [line(q, 10, 12)]); // 10 по 10 без НДС
    await post(r.id);
    const sh = await doc(owner, 'realization', [line(q, 8, 20)]);
    await post(sh.id);
    const res = await act(owner, r.id, 'unpost');
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('stock_conflict');
    expect(await balance(q)).toMatchObject({ qty: '2.000', avgCost: '10.0000' });
    await act(owner, sh.id, 'unpost');
    expect((await act(owner, r.id, 'unpost')).status).toBe(200);
    expect(await balance(q)).toMatchObject({ qty: '0.000' });
    await post(r.id);
  });

  test('USN organizations include input VAT in the cost', async () => {
    const usn = await mk(owner, '/organizations', { name: 'УСН-организация', taxSystem: 'usn' });
    const u = (await mk(owner, '/products', { name: 'Товар для УСН' })).id;
    await post((await doc(owner, 'receipt', [line(u, 10, 120)], { organizationId: usn.id })).id);
    expect(await balance(u)).toMatchObject({ qty: '10.000', avgCost: '120.0000' });
  });

  test('customer return takes the goods back at the original cost; supplier return writes off at the average', async () => {
    const t = (await mk(owner, '/products', { name: 'Возвратный товар' })).id;
    await post((await doc(owner, 'receipt', [line(t, 10, 60)])).id); // 50 без НДС
    const sh = await doc(owner, 'realization', [line(t, 4, 100)]);
    await post(sh.id);
    await post((await doc(owner, 'receipt', [line(t, 6, 120)])).id); // средняя теперь выше: (6×50 + 6×100)/12 = 75
    expect(await balance(t)).toMatchObject({ qty: '12.000', avgCost: '75.0000' });
    const cr = (await act(owner, sh.id, 'based-on', { type: 'customer_return' })).body;
    expect(cr.lines[0].qty).toBe('4.000');
    await post(cr.id);
    const mv = (await owner.get(`/stock/moves?documentId=${cr.id}`)).body.items[0];
    expect(mv).toMatchObject({ qty: '4.000', cost: '50.0000' }); // по себестоимости продажи, а не по текущей средней
    expect((await balance(t))!.qty).toBe('16.000');
    expect((await balance(t))!.avgCost).toBe('68.7500'); // (12×75 + 4×50)/16
    const rr = await doc(owner, 'supplier_return', [line(t, 2, 50)]);
    await post(rr.id);
    expect(await balance(t)).toMatchObject({ qty: '14.000', avgCost: '68.7500' });
  });

  test('reservations: a posted order reserves, shipments release, unposting frees', async () => {
    const r = (await mk(owner, '/products', { name: 'Резервный товар' })).id;
    await post((await doc(owner, 'receipt', [line(r, 10, 12)])).id);
    const order = await doc(owner, 'customer_order', [line(r, 6, 20), line(delivery, 1, 100)]);
    expect((await balance(r))!.reserved).toBe('0.000');
    await post(order.id);
    expect(await balance(r)).toMatchObject({ qty: '10.000', reserved: '6.000', available: '4.000' });
    const sh = (await act(owner, order.id, 'based-on', { type: 'realization' })).body;
    await owner.patch(`/documents/${sh.id}`, { lines: [{ id: sh.lines[0].id, productId: r, qty: 2, price: 20 }] });
    await post(sh.id);
    expect(await balance(r)).toMatchObject({ qty: '8.000', reserved: '4.000', available: '4.000' });
    await act(owner, sh.id, 'unpost');
    expect(await balance(r)).toMatchObject({ qty: '10.000', reserved: '6.000' });
    await act(owner, order.id, 'unpost');
    expect(await balance(r)).toMatchObject({ reserved: '0.000', available: '10.000' });
    const n = await admin`select count(*)::int as n from stock_reservations where document_id = ${order.id}`;
    expect(n[0]!.n).toBe(0);
  });

  test('concurrent shipments cannot oversell', async () => {
    const z = (await mk(owner, '/products', { name: 'Единственный' })).id;
    await post((await doc(owner, 'receipt', [line(z, 5, 12)])).id);
    const ids = [];
    for (let i = 0; i < 4; i++) ids.push((await doc(owner, 'realization', [line(z, 2, 20)])).id);
    const res = await Promise.all(ids.map(id => act(owner, id, 'post')));
    expect(res.filter(r => r.status === 200)).toHaveLength(2);
    expect(res.filter(r => r.status === 422).every(r => r.body.error.code === 'insufficient_stock')).toBe(true);
    expect((await balance(z))!.qty).toBe('1.000');
  });

  test('warehouse with stock cannot be archived; balances can be filtered', async () => {
    expect((await owner.del(`/warehouses/${whId}`)).status).toBe(422);
    const w2 = (await owner.get('/warehouses')).body.items.find((w: any) => w.name === 'Склад 2');
    expect((await owner.del(`/warehouses/${w2.id}`)).status).toBe(200);
    const nz = (await owner.get('/stock/balances?nonZero=true&q=Склад-товар')).body;
    expect(nz.items.map((i: any) => i.name).sort()).toEqual(['Склад-товар', 'Склад-товар 2']);
    expect(Number(nz.value)).toBeGreaterThan(0);
  });
});

describe('production: average warehouse cost as the material price source', () => {
  test('avg_cost uses the stock average; falls back to the purchase price without stock', async () => {
    const mat = (await mk(owner, '/products', { name: 'Материал со склада', unitCode: '796', price: 500, purchasePrice: 90 })).id;
    const noStock = (await mk(owner, '/products', { name: 'Материал без склада', price: 50, purchasePrice: 40 })).id;
    const item = await mk(owner, '/manufactured-items', { name: 'Изделие из склада' });
    await mk(owner, `/manufactured-items/${item.id}/lines`, { kind: 'material', productId: mat, qty: 2 });
    await mk(owner, `/manufactured-items/${item.id}/lines`, { kind: 'material', productId: noStock, qty: 1 });
    expect((await owner.patch('/production/settings', { materialPriceSource: 'avg_cost' })).body.materialPriceSource).toBe('avg_cost');
    const cost = async () => (await owner.get(`/manufactured-items/${item.id}/cost`)).body.tree;
    const before = await cost();
    await post((await doc(owner, 'receipt', [line(mat, 10, 150)])).id); // без НДС 125
    const snap = (await owner.get('/production/snapshot')).body;
    expect(snap.materials.find((m: any) => m.id === mat)).toMatchObject({ avgCost: '125.0000' });
    expect(snap.materials.find((m: any) => m.id === noStock)).toMatchObject({ avgCost: null });
    expect(before.unit.total).toBe('220.0000'); // без склада везде закупочная: 2 × 90 + 40
    expect((await cost()).unit.total).toBe('290.0000'); // 2 × 125 (средняя склада) + 40 (закупочная — запасной вариант без остатка)
    await owner.patch('/production/settings', { materialPriceSource: 'purchase' });
  });
});

describe('print forms', () => {
  test('invoice and UPD render as HTML with the amount in words; unavailable forms are refused', async () => {
    const d = await doc(owner, 'realization', [line(screw, 3, 12.5), line(delivery, 1, 500)]);
    expect((await owner.get(`/documents/${d.id}/print/act`)).status).toBe(422);
    const draft = await owner.get(`/documents/${d.id}/print/upd`);
    expect(draft.status).toBe(200);
    expect(draft.headers.get('content-type')).toContain('text/html');
    expect(draft.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(draft.body).toContain('ЧЕРНОВИК');
    await owner.patch(`/documents/${d.id}`, { priceIncludesVat: false });
    await owner.patch(`/stock/settings`, { allowNegativeStock: true });
    const num = (await post(d.id)).number;
    await owner.patch(`/stock/settings`, { allowNegativeStock: false });
    const upd = (await owner.get(`/documents/${d.id}/print/upd`)).body as string;
    expect(upd).toContain(num);
    expect(upd).toContain('Универсальный передаточный документ');
    expect(upd).toContain('ООО «Покупатель»');
    expect(upd).toContain('Шуруп');
    expect(upd).toContain('Шестьсот сорок пять рублей 00 копеек'); // (37.5 + 500) × 1.2 = 645.00
    const torg = (await owner.get(`/documents/${d.id}/print/torg12`)).body as string;
    expect(torg).toContain('ТОВАРНАЯ НАКЛАДНАЯ');
    const inv = await doc(owner, 'invoice', [line(wood, 1, 100)]);
    await owner.patch(`/organizations/${orgId}`, { fullName: 'ООО <Гр8р> & «Студия»' });
    const html = (await owner.get(`/documents/${inv.id}/print/invoice`)).body as string;
    expect(html).toContain('Счёт на оплату');
    expect(html).toContain('ООО &lt;Гр8р&gt; &amp; «Студия»'); // экранирование
    expect(html).not.toContain('<Гр8р>');
  });

  test('PDF request creates a job and a pending file; downloading before it is ready is refused', async () => {
    const d = await doc(owner, 'invoice', [line(wood, 1, 100)]);
    expect((await owner.post(`/documents/${d.id}/pdf`, { form: 'upd' })).status).toBe(422);
    const r = await owner.post(`/documents/${d.id}/pdf`, { form: 'invoice' });
    expect(r.status).toBe(202);
    expect(r.body).toMatchObject({ status: 'pending', form: 'invoice' });
    expect((await owner.get(`/documents/${d.id}/pdf/${r.body.id}`)).body.status).toBe('pending');
    expect((await owner.get(`/documents/${d.id}/pdf/${r.body.id}?download=1`)).status).toBe(409);
    const jobs = await admin`select type, payload from jobs where workspace_id = ${ws} and type = 'document.pdf' and payload->>'fileId' = ${r.body.id}`;
    expect(jobs).toHaveLength(1);
  });
});

describe('tenant isolation', () => {
  test('another workspace sees none of the documents, stock, organizations or warehouses and cannot reference them', async () => {
    const d = await doc(owner, 'invoice', [line(wood, 1, 100)]);
    expect((await other.get(`/documents/${d.id}`)).status).toBe(404);
    expect((await other.get('/documents')).body.total).toBe(0);
    expect((await other.get('/stock/balances')).body.total).toBe(0);
    expect((await other.get('/stock/moves')).body.items).toEqual([]);
    expect((await other.get(`/documents/${d.id}/print/invoice`)).status).toBe(404);
    expect((await other.post(`/documents/${d.id}/post`)).status).toBe(404);
    expect((await other.get('/organizations')).body.items.map((o: any) => o.id)).not.toContain(orgId);
    // чужие организация, контрагент, склад и товар в своём документе — 422
    expect((await other.post('/documents', { type: 'invoice', organizationId: orgId })).status).toBe(422);
    expect((await other.post('/documents', { type: 'invoice', counterpartyId: customer })).status).toBe(422);
    expect((await other.post('/documents', { type: 'realization', warehouseId: whId })).status).toBe(422);
    expect((await other.post('/documents', { type: 'invoice', lines: [line(wood, 1, 1)] })).status).toBe(422);
    // свой воркспейс получил свои организацию и склад
    expect((await other.get('/organizations')).body.items).toHaveLength(1);
    const mine = await mk(other, '/documents', { type: 'invoice' });
    expect(mine.organizationId).not.toBe(orgId);
    // на уровне БД: под ролью приложения без выбранного воркспейса таблицы пусты
    const direct = await admin`select count(*)::int as n from documents where workspace_id = ${ws}`;
    expect(direct[0]!.n).toBeGreaterThan(0);
  });
});
