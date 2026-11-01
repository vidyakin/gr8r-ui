/* Шаблоны договоров (docs/architecture/contracts.md): назначения шаблонов, параметры сторон, печать из договора и документов,
   PDF договора без документа, изоляция арендаторов. */
import { beforeAll, describe, expect, test } from 'bun:test';
import { Client } from './helpers';

let owner: Client;
let member: Client;
let other: Client;
let ws: string;
let company: string;
let product: string;
let contract: string;

const mk = async (c: Client, path: string, body: Record<string, unknown> = {}) => {
  const r = await c.post(path, body);
  if (r.status >= 300) throw new Error(`${path} ${JSON.stringify(body)}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'Договоры WS' });
  ws = owner.workspaceId!;
  member = new Client();
  await member.signup();
  const inv = await owner.post(`/workspaces/${ws}/invites`, { email: member.user!.email, role: 'member' });
  await member.post('/invites/accept', { token: inv.body.token });
  member.workspaceId = ws;
  other = new Client();
  await other.signup({ workspaceName: 'Чужие договоры WS' });
  const org = ((await owner.get('/organizations')).body.items as any[])[0];
  const upd = await owner.patch(`/organizations/${org.id}`, { directorName: 'Иванов И. И.', directorTitle: 'Генерального директора' });
  expect(upd.status).toBe(200);
  company = (await mk(owner, '/companies', { name: 'ООО «Заказчик»', inn: '7728168971' })).id;
  product = (await mk(owner, '/products', { name: 'Шкаф <офисный>', kind: 'goods', price: 5000, vatRate: 'none' })).id;
  contract = (
    await mk(owner, '/contracts', {
      companyId: company,
      number: 'Д-77',
      date: '2026-03-01',
      validFrom: '2026-03-01',
      paymentDays: 7,
      orgSignerBasis: 'доверенности № 3',
      partySignerName: 'Сидоров С. С.',
      partySignerTitle: 'директора',
      partySignerBasis: 'Устава',
    })
  ).id;
});

describe('назначения шаблонов', () => {
  test('API принимает назначения договоров, назначение после создания не меняется', async () => {
    for (const purpose of ['contract', 'contract_order', 'contract_invoice', 'contract_work_order']) {
      const t = await mk(owner, '/doc-templates', { name: `Т ${purpose}`, purpose, body: 'x' });
      expect(t.purpose).toBe(purpose);
    }
    const list = (await owner.get('/doc-templates?purpose=contract_order')).body.items as any[];
    expect(list.map(t => t.purpose)).toEqual(['contract_order']);
    const t = list[0];
    const r = await owner.patch(`/doc-templates/${t.id}`, { purpose: 'quote', name: 'Новое имя' });
    expect(r.status).toBe(200);
    expect(r.body.purpose).toBe('contract_order');
    expect((await owner.post('/doc-templates', { name: 'Бред', purpose: 'memo' })).status).toBe(400);
  });
});

describe('печать договора', () => {
  let tpl: any;

  test('параметры договора и сторон из карточки; встроенный шаблон без выбора', async () => {
    tpl = await mk(owner, '/doc-templates', { name: 'Мой договор', purpose: 'contract', body: '# Договор № {{Номер договора}}\n\n{{Организация в лице}}\n\n{{Контрагент в лице}}\n\nОтсрочка: {{Отсрочка оплаты}}\n\nТовары: {{Номер документа}}' });
    const html = (await owner.get(`/contracts/${contract}/print?template=${tpl.id}`)).body as string;
    expect(html).toContain('Договор № Д-77');
    expect(html).toContain('в лице Генерального директора Иванов И. И., действующего на основании доверенности № 3');
    expect(html).toContain('ООО «Заказчик», в лице директора Сидоров С. С., действующего на основании Устава');
    expect(html).toContain('Отсрочка: 7 дн.');
    expect(html).not.toContain('Товары:');
    const def = (await owner.get(`/contracts/${contract}/print`)).body as string;
    expect(def).toContain('Договор № Д-77');
    expect(def).not.toContain('{{');
  });

  test('шаблон другого назначения и чужой «только автор» — 404', async () => {
    const wrong = await mk(owner, '/doc-templates', { name: 'Не тот', purpose: 'contract_invoice', body: 'x' });
    expect((await owner.get(`/contracts/${contract}/print?template=${wrong.id}`)).status).toBe(404);
    const mine = await mk(owner, '/doc-templates', { name: 'Личный', purpose: 'contract', body: 'Секрет', onlyAuthor: true });
    expect((await member.get(`/contracts/${contract}/print?template=${mine.id}`)).status).toBe(404);
    expect((await member.post(`/contracts/${contract}/pdf`, { templateId: mine.id })).status).toBe(404);
  });

  test('PDF договора: задача в очереди, файл pending', async () => {
    const r = await owner.post(`/contracts/${contract}/pdf`, { templateId: tpl.id });
    expect(r.status).toBe(202);
    expect(r.body.status).toBe('pending');
    const st = await owner.get(`/contracts/${contract}/pdf/${r.body.id}`);
    expect(st.body.status).toBe('pending');
    expect((await owner.get(`/contracts/${contract}/pdf/${r.body.id}?download=1`)).status).toBe(409);
  });
});

describe('договор + документ', () => {
  let order: any;
  let invoice: any;
  let noContract: any;
  let tOrder: any;

  beforeAll(async () => {
    const lines = [{ productId: product, qty: '2', price: '5000', vatRate: 'none' }];
    order = await mk(owner, '/documents', { type: 'customer_order', counterpartyId: company, contractId: contract, lines });
    invoice = await mk(owner, '/documents', { type: 'invoice', counterpartyId: company, contractId: contract, lines });
    noContract = await mk(owner, '/documents', { type: 'invoice', counterpartyId: company, lines });
    tOrder = await mk(owner, '/doc-templates', { name: 'Договор + заказ', purpose: 'contract_order', body: 'Договор {{Номер договора}}, заказ {{Номер документа}}\n\n{{Товары}}\n\n{{Подписи сторон}}' });
  });

  test('заказ покупателя печатает договор со строками и реквизитами', async () => {
    const html = (await owner.get(`/documents/${order.id}/print/contract_order?template=${tOrder.id}`)).body as string;
    expect(html).toContain('Договор Д-77, заказ (черновик)');
    expect(html).toContain('Шкаф &lt;офисный&gt;');
    expect(html).toContain('10 000,00');
    expect(html).toContain('ИНН 7728168971');
    // без шаблона — встроенный
    expect((await owner.get(`/documents/${order.id}/print/contract_order`)).body).toContain('Договор № Д-77');
  });

  test('форма доступна только своему типу документа и только при договоре', async () => {
    expect((await owner.get(`/documents/${invoice.id}/print/contract_order`)).status).toBe(422);
    expect((await owner.get(`/documents/${invoice.id}/print/contract_invoice`)).status).toBe(200);
    expect((await owner.get(`/documents/${noContract.id}/print/contract_invoice`)).status).toBe(422);
    expect((await owner.post(`/documents/${noContract.id}/pdf`, { form: 'contract_invoice' })).status).toBe(422);
    // шаблон назначения «contract_order» не подходит счёту
    expect((await owner.get(`/documents/${invoice.id}/print/contract_invoice?template=${tOrder.id}`)).status).toBe(404);
  });

  test('PDF составной формы: файл с шаблоном', async () => {
    const r = await owner.post(`/documents/${order.id}/pdf`, { form: 'contract_order', templateId: tOrder.id });
    expect(r.status).toBe(202);
  });

  test('изоляция арендаторов', async () => {
    expect((await other.get(`/contracts/${contract}/print`)).status).toBe(404);
    expect((await other.post(`/contracts/${contract}/pdf`, {})).status).toBe(404);
    expect((await other.get(`/documents/${order.id}/print/contract_order`)).status).toBe(404);
  });
});
