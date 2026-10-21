/* Внутренние складские документы: перемещение между складами, списание, оприходование; статьи затрат и доходов;
   цена оприходования по умолчанию; маскирование стоимости (её видят только admin и owner); обобщение логики заказов. */
import { beforeAll, describe, expect, test } from 'bun:test';
import { Client } from './helpers';

let owner: Client;
let member: Client;
let guest: Client;
let other: Client;
let ws: string;
let whA: string;
let whB: string;
let supplier: string;
let scrap: string; // статья затрат
let surplus: string; // статья доходов

const mk = async (c: Client, path: string, body: Record<string, unknown>) => {
  const r = await c.post(path, body);
  if (r.status !== 201) throw new Error(`${path} ${JSON.stringify(body)}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};
const line = (productId: string, qty: number | string, price: number | string) => ({ productId, qty, price });
const act = async (c: Client, id: string, action: string, body?: unknown) => c.post(`/documents/${id}/${action}`, body);
const balance = async (productId: string, warehouseId: string, c: Client = owner) => {
  const r = await c.get(`/stock/balances?productId=${productId}&warehouseId=${warehouseId}`);
  return r.body.items[0] as { qty: string; avgCost: string | null; value: string | null } | undefined;
};
/** Свой товар на тест: остатки и средняя не смешиваются с другими тестами */
let counter = 0;
const goods = async (name: string, purchasePrice = 100) => (await mk(owner, '/products', { name: `${name} ${++counter}`, unitCode: '006', price: 200, purchasePrice })).id;

/** Приход на склад A: цена прихода = сумма строки без НДС / количество (цены «НДС сверху» — цена равна себестоимости единицы) */
const receive = async (productId: string, qty: number, price: number) => {
  const d = await mk(owner, '/documents', { type: 'receipt', counterpartyId: supplier, warehouseId: whA, priceIncludesVat: false, lines: [line(productId, qty, price)] });
  const r = await act(owner, d.id, 'post');
  if (r.status !== 200) throw new Error(`receipt: ${r.status} ${JSON.stringify(r.body)}`);
  return d.id;
};

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'Склад WS' });
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
  await other.signup({ workspaceName: 'Чужой склад WS' });
  whA = (await owner.get('/warehouses')).body.items[0].id;
  whB = (await mk(owner, '/warehouses', { name: 'Цех' })).id;
  supplier = (await mk(owner, '/companies', { name: 'ООО «Поставщик»', inn: '7728168971' })).id;
  const items = (await owner.get('/cost-items')).body.items as any[];
  scrap = items.find(i => i.systemKey === 'brak').id;
  surplus = items.find(i => i.systemKey === 'izlishki').id;
});

describe('cost items', () => {
  test('the reference book: a new workspace gets the system items, only admins write', async () => {
    const list = (await owner.get('/cost-items')).body.items as any[];
    expect(list.map(i => i.name).sort()).toEqual(['Брак', 'Излишки', 'Недостача', 'Отходы', 'Передача в эксплуатацию', 'Порча']);
    expect(list.filter(i => i.kind === 'income').map(i => i.name)).toEqual(['Излишки']);
    expect((await member.get('/cost-items')).status).toBe(200);
    expect((await member.post('/cost-items', { name: 'Своя статья' })).status).toBe(403);
    const own = await mk(owner, '/cost-items', { name: 'Ремонт стен', kind: 'expense' });
    expect(own).toMatchObject({ name: 'Ремонт стен', kind: 'expense' });
    expect((await owner.post('/cost-items', { name: 'Ремонт стен' })).status).toBe(409); // имя уникально
    expect((await owner.del(`/cost-items/${own.id}`)).status).toBe(200);
    expect((await owner.get('/cost-items')).body.items.some((i: any) => i.id === own.id)).toBe(false);
  });

  test('another workspace has its own items and cannot reference the items of another tenant', async () => {
    const items = (await other.get('/cost-items')).body.items as any[];
    expect(items.length).toBeGreaterThan(0);
    expect(items.every(i => i.workspaceId !== ws)).toBe(true);
    const wh = (await other.get('/warehouses')).body.items[0].id;
    const r = await other.post('/documents', { type: 'write_off', warehouseId: wh, costItemId: scrap, lines: [line(await goods('Чужой товар'), 1, 0)] });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('invalid_reference');
  });
});

describe('stock transfer', () => {
  test('moves the goods at the average cost: both warehouses get their side of the move', async () => {
    const board = await goods('Доска');
    await receive(board, 10, 100);
    const t = await mk(owner, '/documents', { type: 'stock_transfer', warehouseId: whA, targetWarehouseId: whB, lines: [line(board, 4, 0)] });
    expect(t).toMatchObject({ type: 'stock_transfer', operation: 'transfer', targetWarehouseId: whB });
    expect(t.lines[0]).toMatchObject({ stockRole: null, vatRate: 'none', price: '0.00' });
    const posted = await act(owner, t.id, 'post');
    expect(posted.status).toBe(200);
    expect(posted.body.number).toMatch(/^ПМ-\d{4}-\d{5}$/);
    expect(await balance(board, whA)).toMatchObject({ qty: '6.000', avgCost: '100.0000' });
    expect(await balance(board, whB)).toMatchObject({ qty: '4.000', avgCost: '100.0000' });
    // обе стороны движения — в карточке движений
    const moves = (await owner.get(`/stock/moves?documentId=${t.id}`)).body.items as any[];
    expect(moves.map(m => [m.warehouseId, Number(m.qty)])).toEqual(expect.arrayContaining([[whA, -4], [whB, 4]]));
    // журнал показывает стоимость по себестоимости, а не сумму строк
    const journal = (await owner.get('/documents?group=stock')).body;
    expect(journal.items.find((d: any) => d.id === t.id).costTotal).toBe('400.00');
  });

  test('the same warehouse cannot be both the source and the target', async () => {
    const r = await owner.post('/documents', { type: 'stock_transfer', warehouseId: whA, targetWarehouseId: whA, lines: [line(await goods('Доска для перемещения'), 1, 0)] });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('target_warehouse_required');
  });

  test('the numbers of a new type go one after another', async () => {
    const board = await goods('Доска');
    await receive(board, 6, 10);
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push((await mk(owner, '/documents', { type: 'stock_transfer', warehouseId: whA, targetWarehouseId: whB, lines: [line(board, 1, 0)] })).id);
    const res = await Promise.all(ids.map(id => act(owner, id, 'post')));
    expect(res.map(r => r.status)).toEqual([200, 200, 200]);
    const seqs = res.map(r => r.body.numberSeq as number).sort((a, b) => a - b);
    expect(seqs).toEqual([seqs[0]!, seqs[0]! + 1, seqs[0]! + 2]);
    expect(res.every(r => /^ПМ-\d{4}-\d{5}$/.test(r.body.number))).toBe(true);
  });

  test('unposting a transfer is refused when the goods were written off at the destination', async () => {
    const bolt = await goods('Болт');
    await receive(bolt, 5, 20);
    const t = await mk(owner, '/documents', { type: 'stock_transfer', warehouseId: whA, targetWarehouseId: whB, lines: [line(bolt, 5, 0)] });
    expect((await act(owner, t.id, 'post')).status).toBe(200);
    const off = await mk(owner, '/documents', { type: 'write_off', warehouseId: whB, costItemId: scrap, lines: [line(bolt, 2, 0)] });
    expect((await act(owner, off.id, 'post')).status).toBe(200);
    const un = await act(owner, t.id, 'unpost');
    expect(un.status).toBe(422);
    expect(un.body.error.code).toBe('stock_conflict');
    // после отмены списания перемещение снимается с проведения
    expect((await act(owner, off.id, 'unpost')).status).toBe(200);
    expect((await act(owner, t.id, 'unpost')).status).toBe(200);
    expect(await balance(bolt, whA)).toMatchObject({ qty: '5.000' });
    expect(await balance(bolt, whB)).toMatchObject({ qty: '0.000' });
  });

  test('concurrent transfers in both directions do not deadlock', async () => {
    const board = await goods('Доска');
    await receive(board, 20, 50);
    const other = await goods('Доска');
    const whC = (await mk(owner, '/warehouses', { name: `Цех ${++counter}` })).id;
    const receipt = await mk(owner, '/documents', { type: 'receipt', counterpartyId: supplier, warehouseId: whC, priceIncludesVat: false, lines: [line(other, 20, 50)] });
    await act(owner, receipt.id, 'post');
    const [a, b] = await Promise.all([
      mk(owner, '/documents', { type: 'stock_transfer', warehouseId: whA, targetWarehouseId: whC, lines: [line(board, 5, 0)] }),
      mk(owner, '/documents', { type: 'stock_transfer', warehouseId: whC, targetWarehouseId: whA, lines: [line(other, 5, 0)] }),
    ]);
    const res = await Promise.all([act(owner, a.id, 'post'), act(owner, b.id, 'post')]);
    expect(res.map(r => r.status)).toEqual([200, 200]);
    expect(await balance(board, whA)).toMatchObject({ qty: '15.000' });
    expect(await balance(board, whC)).toMatchObject({ qty: '5.000' });
  });
});

describe('write-off and posting', () => {
  test('a write-off needs an expense cost item and writes the goods off at the average cost', async () => {
    const board = await goods('Доска');
    await receive(board, 5, 40);
    const noItem = await mk(owner, '/documents', { type: 'write_off', warehouseId: whA, lines: [line(board, 1, 0)] });
    const r1 = await act(owner, noItem.id, 'post');
    expect(r1.status).toBe(422);
    expect(r1.body.error.code).toBe('cost_item_required');
    const wrongKind = await owner.post('/documents', { type: 'write_off', warehouseId: whA, costItemId: surplus, lines: [line(board, 1, 0)] });
    expect(wrongKind.status).toBe(422);
    expect(wrongKind.body.error.code).toBe('cost_item_kind_mismatch');
    const off = await mk(owner, '/documents', { type: 'write_off', warehouseId: whA, costItemId: scrap, lines: [line(board, 2, 0)] });
    const posted = await act(owner, off.id, 'post');
    expect(posted.status).toBe(200);
    expect(posted.body.number).toMatch(/^СП-\d{4}-\d{5}$/);
    expect(await balance(board, whA)).toMatchObject({ qty: '3.000' });
    // списание не имеет продажной цены: стоимость живёт в движениях
    expect(posted.body.lines[0]).toMatchObject({ price: '0.00', vatRate: 'none', stockRole: 'out' });
    const moves = (await owner.get(`/stock/moves?documentId=${off.id}`)).body.items as any[];
    expect(Number(moves[0].cost)).toBe(40);
  });

  test('the posting price is the current average by default, and a member cannot set it', async () => {
    const bolt = await goods('Болт');
    await receive(bolt, 10, 30);
    const p = await mk(owner, '/documents', { type: 'stock_posting', warehouseId: whA, costItemId: surplus, lines: [line(bolt, 2, 0)] });
    expect(p.lines[0].price).toBe('30.00'); // средняя по складу
    expect((await act(owner, p.id, 'post')).status).toBe(200);
    const memberPosting = await mk(member, '/documents', { type: 'stock_posting', warehouseId: whA, costItemId: surplus, lines: [line(bolt, 1, 999)] });
    expect(memberPosting.lines[0].price).toBe('30.00'); // сервер подставил среднюю, цену клиента не взял
    const adminPosting = await mk(owner, '/documents', { type: 'stock_posting', warehouseId: whA, costItemId: surplus, lines: [line(bolt, 1, 55)] });
    expect(adminPosting.lines[0].price).toBe('55.00'); // admin вправе задать цену прихода
  });

  test('the default cost: the average, then the last purchase price, then the purchase price of the item', async () => {
    const bolt = await goods('Болт');
    await receive(bolt, 1, 30);
    const avg = (await owner.get(`/stock/default-cost?warehouseId=${whA}&productId=${bolt}`)).body;
    expect(avg).toMatchObject({ cost: '30.00', source: 'avg' });
    const empty = (await mk(owner, '/products', { name: `Без остатка ${++counter}`, price: 100, purchasePrice: 77 })).id;
    const purchase = (await owner.get(`/stock/default-cost?warehouseId=${whA}&productId=${empty}`)).body;
    expect(purchase).toMatchObject({ cost: '77.00', source: 'purchase' });
    // на складе, где товар ещё не лежал, берётся цена последнего проведённого поступления
    const whC = (await mk(owner, '/warehouses', { name: `Склад ${++counter}` })).id;
    const last = (await owner.get(`/stock/default-cost?warehouseId=${whC}&productId=${bolt}`)).body;
    expect(last).toMatchObject({ cost: '30.00', source: 'last_receipt' });
  });
});

describe('cost visibility', () => {
  test('only admins and owners see the cost: balances, movements, the posting price and the journal', async () => {
    const board = await goods('Доска');
    await receive(board, 3, 25);
    const p = await mk(owner, '/documents', { type: 'stock_posting', warehouseId: whA, costItemId: surplus, lines: [line(board, 1, 0)] });
    await act(owner, p.id, 'post');
    expect((await member.get(`/stock/balances?productId=${board}`)).body.items[0].avgCost).toBeNull();
    expect((await guest.get(`/stock/balances?productId=${board}`)).body.items[0].value).toBeNull();
    expect((await member.get('/stock/avg-costs')).body.items).toHaveLength(0);
    const moves = (await member.get(`/stock/moves?productId=${board}`)).body.items as any[];
    expect(moves.every(m => m.cost === null)).toBe(true);
    const journal = (await member.get('/documents?group=stock')).body;
    expect(journal.items.filter((d: any) => d.costTotal !== null)).toHaveLength(0);
    expect(journal.sum.cost).toBeNull();
    const detail = (await member.get(`/documents/${p.id}`)).body;
    expect(detail.lines[0].price).toBe('0.00');
    expect(detail.costTotal).toBeNull();
    // владелец и администратор видят стоимость
    expect((await owner.get(`/stock/balances?productId=${board}`)).body.items[0].avgCost).toBe('25.0000');
    expect((await owner.get(`/documents/${p.id}`)).body.lines[0].price).toBe('25.00');
  });
});

describe('internal documents in the journal', () => {
  test('the group filter shows only internal documents, and the sales sums do not include them', async () => {
    const stock = (await owner.get('/documents?group=stock')).body;
    expect(stock.items.every((d: any) => ['stock_transfer', 'write_off', 'stock_posting'].includes(d.type))).toBe(true);
    const customer = (await mk(owner, '/companies', { name: 'ООО «Покупатель»', inn: '7707083893' })).id;
    const sale = await mk(owner, '/documents', { type: 'invoice', counterpartyId: customer, lines: [line(await goods('Продажа'), 1, 500)] });
    expect((await act(owner, sale.id, 'post')).status).toBe(200);
    const sales = (await owner.get('/documents?group=sales')).body;
    expect(sales.items.every((d: any) => !['stock_transfer', 'write_off', 'stock_posting'].includes(d.type))).toBe(true);
    expect(Number(sales.sum.total)).toBeGreaterThan(0);
  });

  test('a document without a counterparty is posted: an internal document needs none', async () => {
    const board = await goods('Доска');
    await receive(board, 5, 10);
    const d = await mk(owner, '/documents', { type: 'write_off', warehouseId: whA, costItemId: scrap, lines: [line(board, 1, 0)] });
    expect(d.counterpartyId).toBeNull();
    expect((await act(owner, d.id, 'post')).status).toBe(200);
  });

  test('a sale still needs a counterparty', async () => {
    const d = await mk(owner, '/documents', { type: 'invoice', lines: [line(await goods('Счёт'), 1, 100)] });
    const r = await act(owner, d.id, 'post');
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('counterparty_required');
  });
});

describe('state of a document', () => {
  test('a type without states refuses the change', async () => {
    const board = await goods('Доска');
    await receive(board, 2, 10);
    const d = await mk(owner, '/documents', { type: 'write_off', warehouseId: whA, costItemId: scrap, lines: [line(board, 1, 0)] });
    const r = await act(owner, d.id, 'state', { state: 'shipped' });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('state_not_allowed');
  });
});
