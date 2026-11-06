/* Параметрические изделия в плане производства: значения параметров у строки плана, потребности по формулам спецификации,
   пропущенные строки с причиной, заполнение из заказов покупателей и передача значений в заказ на производство. */
import { beforeAll, describe, expect, test } from 'bun:test';
import { Client, uniq } from './helpers';

let owner: Client;
let wood: string; // материал: расход по формуле width * 2
let cabinet: string; // товар параметрического изделия
let spec: string; // параметрическая спецификация
let fg: string;
let customer: string;

const mk = async (c: Client, path: string, body: Record<string, unknown>) => {
  const r = await c.post(path, body);
  if (r.status >= 300) throw new Error(`${path} ${JSON.stringify(body)}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};
/** Понедельник текущей недели со сдвигом (периоды плана начинаются с понедельника) */
const monday = (weeks = 0) => {
  const d = new Date();
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - (day === 0 ? 6 : day - 1) + weeks * 7);
  return d.toISOString().slice(0, 10);
};
const fromMonday = (weeks: number, days: number) => new Date(Date.parse(`${monday(weeks)}T00:00:00Z`) + days * 864e5).toISOString().slice(0, 10);

const plan = (lines: Record<string, unknown>[]) =>
  mk(owner, '/production-plans', { name: `План ${uniq()}`, periodFrom: monday(), periodTo: monday(3), step: 'week', warehouseId: fg, lines });
const woodNeed = async (planId: string) => {
  const needs = (await owner.get(`/production-plans/${planId}/needs`)).body;
  return { qty: needs.materials.find((m: any) => m.productId === wood)?.qty as string | undefined, skipped: needs.skipped as any[] };
};

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: `Plan params ${uniq()}` });
  wood = (await mk(owner, '/products', { name: `Доска ${uniq()}`, unitCode: '006', price: 100, vatRate: 'none' })).id;
  cabinet = (await mk(owner, '/products', { name: `Шкаф ${uniq()}`, price: 9000 })).id;
  fg = (await mk(owner, '/warehouses', { name: `Склад ${uniq()}` })).id;
  customer = (await mk(owner, '/companies', { name: `Покупатель ${uniq()}` })).id;
  spec = (await mk(owner, '/manufactured-items', { name: `Шкаф по ширине ${uniq()}`, productId: cabinet, batchQty: '1', overheadPct: '0', params: [{ key: 'width', name: 'Ширина', type: 'number', options: {} }] })).id;
  await mk(owner, `/manufactured-items/${spec}/lines`, { kind: 'material', productId: wood, qty: 1, qtyExpr: 'width * 2' });
  await mk(owner, '/production-orders/product-settings', { productId: cabinet, replenishment: 'production', defaultItemId: spec });
});

describe('parametric products in the production plan', () => {
  test('needs are calculated by the formula with the values of each line; different values are different lines', async () => {
    const p = await plan([
      { itemId: spec, periodStart: monday(), qty: '10', params: { width: 3 } },
      { itemId: spec, periodStart: monday(), qty: '2', params: { width: 5 } },
    ]);
    expect(p.lines).toHaveLength(2);
    expect(p.lines.map((l: any) => l.params.width).sort()).toEqual([3, 5]);
    // 10 × (3 × 2) + 2 × (5 × 2) = 80
    const n = await woodNeed(p.id);
    expect(n.qty).toBe('80.000');
    expect(n.skipped).toEqual([]);
  });

  test('a parametric line without values is not silently dropped: it is listed as skipped with the reason', async () => {
    const p = await plan([{ itemId: spec, periodStart: monday(), qty: '4' }]);
    const n = await woodNeed(p.id);
    expect(n.qty).toBeUndefined();
    expect(n.skipped).toHaveLength(1);
    expect(n.skipped[0]).toMatchObject({ itemId: spec, qty: '4.000', reason: 'missing_params' });
  });

  test('values are checked against the parameters of the specification', async () => {
    const r = await owner.post('/production-plans', { name: 'Плохие параметры', periodFrom: monday(), periodTo: monday(1), step: 'week', warehouseId: fg, lines: [{ itemId: spec, periodStart: monday(), qty: '1', params: { depth: 4 } }] });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('invalid_params');
  });

  test('editing a saved line keeps its id and stores the new quantity and values', async () => {
    const p = await plan([{ itemId: spec, periodStart: monday(), qty: '1', params: { width: 2 } }]);
    const line = p.lines[0];
    const r = await owner.patch(`/production-plans/${p.id}`, { lines: [{ id: line.id, itemId: spec, periodStart: monday(), qty: '7', params: { width: 4 } }] });
    expect(r.status).toBe(200);
    const after = (await owner.get(`/production-plans/${p.id}`)).body;
    expect(after.lines).toHaveLength(1);
    expect(after.lines[0]).toMatchObject({ id: line.id, qty: '7.000', params: { width: 4 } });
    expect((await woodNeed(p.id)).qty).toBe('56.000');
  });

  test('fill by customer orders carries the values of the order lines; equal values are summed', async () => {
    const order = await mk(owner, '/documents', {
      type: 'customer_order',
      counterpartyId: customer,
      dueDate: fromMonday(1, 2),
      lines: [
        { productId: cabinet, qty: '4', price: '9000', discountPct: '0', params: { width: 3 } },
        { productId: cabinet, qty: '1', price: '9000', discountPct: '0', params: { width: 5 } },
        { productId: cabinet, qty: '2', price: '9000', discountPct: '0', params: { width: 3 } },
      ],
    });
    expect((await owner.post(`/documents/${order.id}/post`)).status).toBe(200);
    const p = await plan([]);
    await owner.post(`/production-plans/${p.id}/fill`, { source: 'customer_orders', mode: 'replace', periods: 3 });
    const lines = (await owner.get(`/production-plans/${p.id}`)).body.lines.filter((l: any) => l.itemId === spec);
    expect(lines.map((l: any) => [l.periodStart, l.params.width, l.qty]).sort()).toEqual([
      [monday(1), 3, '6.000'],
      [monday(1), 5, '1.000'],
    ]);
    // 6 × 6 + 1 × 10 = 46
    expect((await woodNeed(p.id)).qty).toBe('46.000');
  });

  test('orders by the plan get the values of the plan line', async () => {
    const p = await plan([{ itemId: spec, periodStart: monday(), qty: '3', params: { width: 4 } }]);
    expect((await owner.patch(`/production-plans/${p.id}`, { status: 'approved' })).status).toBe(200);
    const res = await mk(owner, `/production-plans/${p.id}/orders`, {});
    expect(res.created).toHaveLength(1);
    const filled = await owner.post(`/production-orders/${res.created[0].id}/fill-from-bom`);
    expect(filled.status).toBe(200);
    // 3 × (4 × 2) = 24
    expect(filled.body.components.find((c: any) => c.productId === wood)?.qty).toBe('24.000');
  });
});
