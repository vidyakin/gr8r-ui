/* Роль контрагента: флажки покупатель/поставщик, фильтр списка, флажок при проведении закупки, разметка миграции 0119. */
import { beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { Client, admin } from './helpers';

let owner: Client;
let ws: string;
let org: string;
let wh: string;
let product: string;

const mk = async (path: string, body: Record<string, unknown>) => {
  const r = await owner.post(path, body);
  if (r.status !== 201) throw new Error(`${path}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};
const mkDoc = (type: string, counterpartyId: string) =>
  mk('/documents', { type, counterpartyId, organizationId: org, warehouseId: wh, lines: [{ productId: product, qty: 1, price: 2 }] });

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'Roles WS' });
  ws = owner.workspaceId!;
  org = (await owner.get('/organizations')).body.items[0].id;
  wh = (await owner.get('/warehouses')).body.items[0].id;
  product = (await mk('/products', { name: 'Товар ролей', price: 5, purchasePrice: 2, vatRate: '20' })).id;
});

describe('company roles', () => {
  test('defaults, patch and the role filter', async () => {
    const a = await mk('/companies', { name: 'Покупатель по умолчанию' });
    expect(a).toMatchObject({ isCustomer: true, isSupplier: false });
    const b = await mk('/companies', { name: 'Только поставщик', isCustomer: false, isSupplier: true });
    expect(b).toMatchObject({ isCustomer: false, isSupplier: true });
    const both = await mk('/companies', { name: 'Оба', isSupplier: true });
    expect(both).toMatchObject({ isCustomer: true, isSupplier: true });
    const ids = async (q: string) => (await owner.get(`/companies?${q}&limit=100`)).body.items.map((c: any) => c.id);
    expect(await ids('role=supplier')).toEqual(expect.arrayContaining([b.id, both.id]));
    expect(await ids('role=supplier')).not.toContain(a.id);
    expect(await ids('role=customer')).toEqual(expect.arrayContaining([a.id, both.id]));
    expect(await ids('role=customer')).not.toContain(b.id);
    expect((await owner.patch(`/companies/${a.id}`, { isSupplier: true })).body.isSupplier).toBe(true);
    expect((await owner.get('/companies?role=bad')).status).toBe(400);
  });

  test('posting a purchase document marks the counterparty as a supplier', async () => {
    const co = await mk('/companies', { name: 'Новый поставщик' });
    const d = await mkDoc('receipt', co.id);
    expect((await owner.get(`/companies/${co.id}`)).body.isSupplier).toBe(false);
    expect((await owner.post(`/documents/${d.id}/post`)).status).toBe(200);
    expect((await owner.get(`/companies/${co.id}`)).body).toMatchObject({ isSupplier: true, isCustomer: true });
  });

  test('migration 0119 marks existing counterparties', async () => {
    const sup = await mk('/companies', { name: 'Миграция: поставщик' });
    const both = await mk('/companies', { name: 'Миграция: оба' });
    const cust = await mk('/companies', { name: 'Миграция: покупатель' });
    await mkDoc('receipt', sup.id);
    await mkDoc('receipt', both.id);
    await mkDoc('invoice', both.id);
    await mkDoc('invoice', cust.id);
    await admin`update companies set is_supplier = false, is_customer = true where workspace_id = ${ws}`;
    const stmts = readFileSync(new URL('../../../packages/db/drizzle/0119_company_roles.sql', import.meta.url), 'utf8').split('--> statement-breakpoint');
    // две последние инструкции — разметка (первые две добавляют колонки, они уже применены)
    await admin.unsafe(stmts[stmts.length - 2]!);
    await admin.unsafe(stmts[stmts.length - 1]!);
    const row = async (id: string) => (await admin`select is_customer, is_supplier from companies where id = ${id}`)[0]!;
    expect(await row(sup.id)).toMatchObject({ is_supplier: true, is_customer: false });
    expect(await row(both.id)).toMatchObject({ is_supplier: true, is_customer: true });
    expect(await row(cust.id)).toMatchObject({ is_supplier: false, is_customer: true });
  });
});
