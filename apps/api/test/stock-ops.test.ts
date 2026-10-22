/* Этап 0б: инвентаризация (без движений, списание и оприходование на основании), перемещение «в пути» (отправка → приёмка),
   передача в эксплуатацию с учётом «у кого», печатные формы ИНВ-3 / ТОРГ-16 / ТОРГ-13. */
import { beforeAll, describe, expect, test } from 'bun:test';
import { Client } from './helpers';

let owner: Client;
let member: Client;
let whA: string;
let whB: string;
let supplier: string;
let memberId: string;

const mk = async (c: Client, path: string, body: Record<string, unknown>) => {
  const r = await c.post(path, body);
  if (r.status !== 201) throw new Error(`${path} ${JSON.stringify(body)}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};
const line = (productId: string, qty: number | string, price: number | string, extra: Record<string, unknown> = {}) => ({ productId, qty, price, ...extra });
const act = async (c: Client, id: string, action: string, body?: unknown) => c.post(`/documents/${id}/${action}`, body);
const balance = async (productId: string, warehouseId: string, c: Client = owner) => {
  const r = await c.get(`/stock/balances?productId=${productId}&warehouseId=${warehouseId}`);
  return r.body.items[0] as { qty: string; avgCost: string | null } | undefined;
};
const costItem = async (key: string) => ((await owner.get('/cost-items')).body.items as any[]).find(i => i.systemKey === key).id;

let counter = 0;
const goods = async (name: string, purchasePrice = 100) => (await mk(owner, '/products', { name: `${name} ${++counter}`, unitCode: '006', price: 200, purchasePrice })).id;

/** Приход на склад A по цене за единицу */
const receive = async (productId: string, qty: number, price: number) => {
  const d = await mk(owner, '/documents', { type: 'receipt', counterpartyId: supplier, warehouseId: whA, priceIncludesVat: false, lines: [line(productId, qty, price)] });
  const r = await act(owner, d.id, 'post');
  if (r.status !== 200) throw new Error(`receipt: ${r.status} ${JSON.stringify(r.body)}`);
  return d.id;
};

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'Этап 0б WS' });
  member = new Client();
  await member.signup();
  const inv = await owner.post(`/workspaces/${owner.workspaceId}/invites`, { email: member.user!.email, role: 'member' });
  await member.post('/invites/accept', { token: inv.body.token });
  member.workspaceId = owner.workspaceId;
  whA = (await owner.get('/warehouses')).body.items[0].id;
  whB = (await mk(owner, '/warehouses', { name: 'Приёмный склад' })).id;
  supplier = (await mk(owner, '/companies', { name: 'ООО «Поставщик 0б»', inn: '7728168971' })).id;
  memberId = (await owner.get('/members')).body.items[0].id;
});

describe('inventory count', () => {
  test('does not move the stock: the lines keep the book and the actual quantity', async () => {
    const board = await goods('Полка');
    await receive(board, 10, 100);
    const inv = await mk(owner, '/documents', { type: 'inventory_count', warehouseId: whA });
    expect(inv.type).toBe('inventory_count');
    const filled = await act(owner, inv.id, 'fill-count-sheet');
    expect(filled.status).toBe(200);
    const line0 = filled.body.lines.find((l: any) => l.productId === board);
    expect(line0).toMatchObject({ qty: '10.000', bookQty: '10.000' });
    // остатки не тронуты
    expect(await balance(board, whA)).toMatchObject({ qty: '10.000' });
    // проведённая инвентаризация остаётся без движений
    const posted = await act(owner, inv.id, 'post');
    expect(posted.status).toBe(200);
    expect(posted.body.number).toMatch(/^ИНВ-\d{4}-\d{5}$/);
    expect(await balance(board, whA)).toMatchObject({ qty: '10.000' });
  });

  test('the shortage becomes a write-off on the basis, the surplus becomes a posting', async () => {
    const nut = await goods('Гайка');
    await receive(nut, 8, 25);
    const inv = await mk(owner, '/documents', { type: 'inventory_count', warehouseId: whA });
    await act(owner, inv.id, 'fill-count-sheet');
    const line0 = (await owner.get(`/documents/${inv.id}`)).body.lines.find((l: any) => l.productId === nut);
    // фактически насчитали 6 при учётных 8 — недостача 2
    await owner.patch(`/documents/${inv.id}`, { lines: [{ id: line0.id, productId: nut, qty: '6', bookQty: '8', price: '0' }] });
    await act(owner, inv.id, 'post');
    const off = await act(owner, inv.id, 'based-on', { type: 'write_off' });
    expect(off.status).toBe(201);
    expect(off.body.lines).toHaveLength(1);
    expect(off.body.lines[0]).toMatchObject({ productId: nut, qty: '2.000' });
    expect(off.body.costItem.name).toBe('Недостача');
    expect(off.body.basedOnId).toBe(inv.id);
    // повторно оформить ту же недостачу нельзя
    const again = await act(owner, inv.id, 'based-on', { type: 'write_off' });
    expect(again.status).toBe(422);
    expect(again.body.error.code).toBe('nothing_to_create');
    // проведённое списание уменьшает остаток
    expect((await act(owner, off.body.id, 'post')).status).toBe(200);
    expect(await balance(nut, whA)).toMatchObject({ qty: '6.000' });
    // инвентаризацию, по которой есть проведённые документы, снять с проведения нельзя
    const un = await act(owner, inv.id, 'unpost');
    expect(un.status).toBe(409);
    expect(un.body.error.code).toBe('has_posted_children');
  });

  test('the surplus is posted with the default cost of the goods', async () => {
    const tape = await goods('Скотч');
    await receive(tape, 4, 50);
    const inv = await mk(owner, '/documents', { type: 'inventory_count', warehouseId: whA });
    await act(owner, inv.id, 'fill-count-sheet');
    const line0 = (await owner.get(`/documents/${inv.id}`)).body.lines.find((l: any) => l.productId === tape);
    await owner.patch(`/documents/${inv.id}`, { lines: [{ id: line0.id, productId: tape, qty: '6', bookQty: '4', price: '0' }] });
    await act(owner, inv.id, 'post');
    const post = await act(owner, inv.id, 'based-on', { type: 'stock_posting' });
    expect(post.status).toBe(201);
    expect(post.body.lines[0]).toMatchObject({ productId: tape, qty: '2.000', price: '50.00' });
    expect(post.body.costItem.name).toBe('Излишки');
    expect((await act(owner, post.body.id, 'post')).status).toBe(200);
    expect(await balance(tape, whA)).toMatchObject({ qty: '6.000' });
  });

  test('the count sheet shows the balances of the warehouse', async () => {
    const bolt = await goods('Болт 0б');
    await receive(bolt, 3, 10);
    const sheet = await owner.get(`/stock/count-sheet?warehouseId=${whA}`);
    expect(sheet.status).toBe(200);
    expect(sheet.body.items.find((i: any) => i.productId === bolt)).toMatchObject({ qty: '3.000', name: expect.stringContaining('Болт 0б') });
    expect((await owner.get(`/stock/count-sheet?warehouseId=${crypto.randomUUID()}`)).status).toBe(404);
  });
});

describe('transfer in transit', () => {
  test('the goods are on the transit warehouse until they are accepted', async () => {
    const drum = await goods('Бочка');
    await receive(drum, 10, 70);
    const t = await mk(owner, '/documents', { type: 'stock_transfer', operation: 'in_transit', warehouseId: whA, targetWarehouseId: whB, lines: [line(drum, 6, 0)] });
    expect(t.operation).toBe('in_transit');
    const posted = await act(owner, t.id, 'post');
    expect(posted.status).toBe(200);
    expect(posted.body.state).toBe('shipped');
    expect(await balance(drum, whA)).toMatchObject({ qty: '4.000' });
    // служебный склад «в пути» создан лениво
    const transit = (await owner.get('/warehouses?limit=100')).body.items.find((w: any) => w.kind === 'transit');
    expect(transit).toBeTruthy();
    expect(await balance(drum, transit.id)).toMatchObject({ qty: '6.000', avgCost: '70.0000' });
    // приёмка: товар приходит получателю по своей себестоимости
    const accepted = await act(owner, t.id, 'state', { state: 'received' });
    expect(accepted.status).toBe(200);
    expect(accepted.body.state).toBe('received');
    expect(await balance(drum, transit.id)).toMatchObject({ qty: '0.000' });
    expect(await balance(drum, whB)).toMatchObject({ qty: '6.000', avgCost: '70.0000' });
  });

  test('a partial acceptance leaves the rest on the transit warehouse', async () => {
    const crate = await goods('Ящик');
    await receive(crate, 10, 30);
    const t = await mk(owner, '/documents', { type: 'stock_transfer', operation: 'in_transit', warehouseId: whA, targetWarehouseId: whB, lines: [line(crate, 5, 0)] });
    await act(owner, t.id, 'post');
    const lineId = (await owner.get(`/documents/${t.id}`)).body.lines[0].id;
    const accepted = await act(owner, t.id, 'state', { state: 'received', received: [{ id: lineId, qty: '3' }] });
    expect(accepted.status).toBe(200);
    expect(accepted.body.lines[0]).toMatchObject({ receivedQty: '3.000' });
    const transit = (await owner.get('/warehouses?limit=100')).body.items.find((w: any) => w.kind === 'transit');
    expect(await balance(crate, whB)).toMatchObject({ qty: '3.000' });
    expect(await balance(crate, transit.id)).toMatchObject({ qty: '2.000' });
    // отмена приёмки возвращает товар «в пути»
    const back = await act(owner, t.id, 'state', { state: 'shipped' });
    expect(back.status).toBe(200);
    expect(back.body.state).toBe('shipped');
    expect(await balance(crate, whB)).toMatchObject({ qty: '0.000' });
    expect(await balance(crate, transit.id)).toMatchObject({ qty: '5.000' });
  });

  test('unposting the transfer returns the goods to the sender', async () => {
    const barrel = await goods('Бочка 2');
    await receive(barrel, 5, 12);
    const t = await mk(owner, '/documents', { type: 'stock_transfer', operation: 'in_transit', warehouseId: whA, targetWarehouseId: whB, lines: [line(barrel, 2, 0)] });
    await act(owner, t.id, 'post');
    await act(owner, t.id, 'state', { state: 'received' });
    const un = await act(owner, t.id, 'unpost');
    expect(un.status).toBe(200);
    expect(un.body.state).toBeNull();
    expect(await balance(barrel, whA)).toMatchObject({ qty: '5.000' });
    expect(await balance(barrel, whB)).toMatchObject({ qty: '0.000' });
  });

  test('an ordinary transfer has no states', async () => {
    const plank = await goods('Доска 0б');
    await receive(plank, 2, 10);
    const t = await mk(owner, '/documents', { type: 'stock_transfer', warehouseId: whA, targetWarehouseId: whB, lines: [line(plank, 1, 0)] });
    await act(owner, t.id, 'post');
    const st = await act(owner, t.id, 'state', { state: 'received' });
    expect(st.status).toBe(422);
    expect(st.body.error.code).toBe('state_not_allowed');
  });
});

describe('goods in use', () => {
  test('the goods are written off the warehouse and kept by the member', async () => {
    const drill = await goods('Дрель');
    await receive(drill, 4, 200);
    const t = await mk(owner, '/documents', { type: 'stock_transfer', operation: 'to_operation', warehouseId: whA, inUseMemberId: memberId, costItemId: await costItem('v_expluaciatsiyu'), lines: [line(drill, 2, 0)] });
    expect(t.inUseMemberId).toBe(memberId);
    expect((await act(owner, t.id, 'post')).status).toBe(200);
    expect(await balance(drill, whA)).toMatchObject({ qty: '2.000' });
    const inUse = await owner.get('/stock/in-use');
    expect(inUse.body.items.find((i: any) => i.productId === drill)).toMatchObject({ qty: '2.000', memberId });
    // возврат из эксплуатации уменьшает остаток у получателя
    const back = await mk(owner, '/documents', { type: 'stock_transfer', operation: 'from_operation', warehouseId: whA, inUseMemberId: memberId, lines: [line(drill, 1, 0)] });
    expect((await act(owner, back.id, 'post')).status).toBe(200);
    const after = await owner.get('/stock/in-use');
    expect(after.body.items.find((i: any) => i.productId === drill)).toMatchObject({ qty: '1.000' });
    // отмена проведения передачи, пока товар уже возвращён, запрещена
    const blocked = await act(owner, t.id, 'unpost');
    expect(blocked.status).toBe(422);
    expect(blocked.body.error.code).toBe('in_use_conflict');
    // сначала отменяем возврат, потом и передачу
    expect((await act(owner, back.id, 'unpost')).status).toBe(200);
    expect((await act(owner, t.id, 'unpost')).status).toBe(200);
    const undone = await owner.get('/stock/in-use');
    expect(undone.body.items.find((i: any) => i.productId === drill)).toBeUndefined();
  });

  test('the recipient is required and the article must be an expense one', async () => {
    const saw = await goods('Пила');
    await receive(saw, 2, 90);
    const noHolder = await owner.post('/documents', { type: 'stock_transfer', operation: 'to_operation', warehouseId: whA, lines: [line(saw, 1, 0)] });
    expect(noHolder.status).toBe(422);
    expect(noHolder.body.error.code).toBe('in_use_holder_required');
    const t = await mk(owner, '/documents', { type: 'stock_transfer', operation: 'to_operation', warehouseId: whA, inUseMemberId: memberId, lines: [line(saw, 1, 0)] });
    const posted = await act(owner, t.id, 'post');
    expect(posted.status).toBe(422);
    expect(posted.body.error.code).toBe('cost_item_required');
  });

  test('returning more than is in use is refused', async () => {
    const ladder = await goods('Лестница');
    await receive(ladder, 2, 40);
    const t = await mk(owner, '/documents', { type: 'stock_transfer', operation: 'to_operation', warehouseId: whA, inUseMemberId: memberId, costItemId: await costItem('v_expluaciatsiyu'), lines: [line(ladder, 1, 0)] });
    await act(owner, t.id, 'post');
    const back = await mk(owner, '/documents', { type: 'stock_transfer', operation: 'from_operation', warehouseId: whA, inUseMemberId: memberId, lines: [line(ladder, 3, 0)] });
    const posted = await act(owner, back.id, 'post');
    expect(posted.status).toBe(422);
    expect(posted.body.error.code).toBe('insufficient_in_use');
  });
});

describe('print forms of the stage', () => {
  test('INV-3, TORG-16 and TORG-13 are printed', async () => {
    const cloth = await goods('Ткань');
    await receive(cloth, 6, 20);
    const inv = await mk(owner, '/documents', { type: 'inventory_count', warehouseId: whA });
    await act(owner, inv.id, 'fill-count-sheet');
    await act(owner, inv.id, 'post');
    const inv3 = await owner.get(`/documents/${inv.id}/print/inv3`);
    expect(inv3.status).toBe(200);
    expect(String(inv3.body)).toContain('ИНВ-3');

    const off = await mk(owner, '/documents', { type: 'write_off', warehouseId: whA, costItemId: await costItem('brak'), lines: [line(cloth, 1, 0)] });
    await act(owner, off.id, 'post');
    const torg16 = await owner.get(`/documents/${off.id}/print/torg16`);
    expect(torg16.status).toBe(200);
    expect(String(torg16.body)).toContain('ТОРГ-16');

    const move = await mk(owner, '/documents', { type: 'stock_transfer', warehouseId: whA, targetWarehouseId: whB, lines: [line(cloth, 1, 0)] });
    await act(owner, move.id, 'post');
    const torg13 = await owner.get(`/documents/${move.id}/print/torg13`);
    expect(torg13.status).toBe(200);
    expect(String(torg13.body)).toContain('ТОРГ-13');
  });
});
