/* Коммерческие предложения (docs/architecture/quotes.md): варианты КП в КП и заказе покупателя, группы строк,
   шаблоны КП с доступностью «только автор», печать стандартной формы и по шаблону, PDF по шаблону, изоляция арендаторов. */
import { beforeAll, describe, expect, test } from 'bun:test';
import { Client } from './helpers';

let owner: Client;
let member: Client;
let other: Client;
let ws: string;
let phone: string;
let cable: string;
let company: string;

const mk = async (c: Client, path: string, body: Record<string, unknown> = {}) => {
  const r = await c.post(path, body);
  if (r.status >= 300) throw new Error(`${path} ${JSON.stringify(body)}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};

const line = (productId: string, qty: number, price: number, groupName = '') => ({ productId, qty: String(qty), price: String(price), vatRate: 'none', groupName });

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'Quotes WS' });
  ws = owner.workspaceId!;
  member = new Client();
  await member.signup();
  const inv = await owner.post(`/workspaces/${ws}/invites`, { email: member.user!.email, role: 'member' });
  await member.post('/invites/accept', { token: inv.body.token });
  member.workspaceId = ws;
  other = new Client();
  await other.signup({ workspaceName: 'Other quotes WS' });
  phone = (await mk(owner, '/products', { name: 'Смартфон', sku: 'PH-1', kind: 'goods', price: 1000, vatRate: 'none' })).id;
  cable = (await mk(owner, '/products', { name: 'Кабель', sku: 'CB-1', kind: 'goods', price: 100, vatRate: 'none' })).id;
  company = (await mk(owner, '/companies', { name: 'ООО «Покупатель»', inn: '7728168971' })).id;
});

describe('варианты КП', () => {
  let quote: any;

  test('группы строк сохраняются, правка без groupName их не сбрасывает', async () => {
    quote = await mk(owner, '/documents', { type: 'quote', counterpartyId: company, lines: [line(phone, 2, 1000, 'Оборудование'), line(cable, 3, 100, 'Аксессуары')] });
    expect(quote.lines.map((l: any) => l.groupName)).toEqual(['Оборудование', 'Аксессуары']);
    expect(quote.variants).toEqual([]);
    expect(quote.variantName).toBeNull();
    const r = await owner.patch(`/documents/${quote.id}`, { lines: quote.lines.map((l: any) => ({ id: l.id, productId: l.productId, qty: l.qty, price: l.price, vatRate: 'none' })) });
    expect(r.body.lines.map((l: any) => l.groupName)).toEqual(['Оборудование', 'Аксессуары']);
  });

  test('новый вариант-копия становится основным, прежний уходит в список', async () => {
    const r = await owner.post(`/documents/${quote.id}/variants`, { name: 'Эконом', copy: true });
    expect(r.status).toBe(201);
    expect(r.body.variantName).toBe('Эконом');
    expect(r.body.variants).toHaveLength(1);
    expect(r.body.variants[0].name).toBe('Вариант 1');
    expect(r.body.variants[0].totals.total).toBe('2300.00');
    // у копии свои id строк
    expect(r.body.lines.map((l: any) => l.id)).not.toContain(quote.lines[0].id);
    // правим основной: сумма документа — по основному варианту
    const e = await owner.patch(`/documents/${quote.id}`, { lines: [line(cable, 1, 100)] });
    expect(e.body.total).toBe('100.00');
    quote = e.body;
  });

  test('«Сделать основным» меняет местами, id строк и группы сохраняются', async () => {
    const v1 = quote.variants[0];
    const r = await owner.post(`/documents/${quote.id}/variants/${v1.id}/activate`);
    expect(r.status).toBe(200);
    expect(r.body.variantName).toBe('Вариант 1');
    expect(r.body.total).toBe('2300.00');
    expect(r.body.lines.map((l: any) => l.groupName)).toEqual(['Оборудование', 'Аксессуары']);
    expect(r.body.variants.map((v: any) => [v.name, v.totals.total])).toEqual([['Эконом', '100.00']]);
    quote = r.body;
  });

  test('пустой вариант, переименование и удаление', async () => {
    let r = await owner.post(`/documents/${quote.id}/variants`, { copy: false });
    expect(r.body.lines).toEqual([]);
    expect(r.body.variantName).toBe('Вариант 3');
    expect(r.body.variants).toHaveLength(2);
    const eco = r.body.variants.find((v: any) => v.name === 'Эконом');
    r = await owner.patch(`/documents/${quote.id}/variants/${eco.id}`, { name: 'Эконом+' });
    expect(r.body.variants.map((v: any) => v.name)).toContain('Эконом+');
    r = await owner.patch(`/documents/${quote.id}`, { variantName: 'Пустой' });
    expect(r.body.variantName).toBe('Пустой');
    // вернуть «Вариант 1» основным и удалить остальные: у документа больше нет вариантов
    const v1 = r.body.variants.find((v: any) => v.name === 'Вариант 1');
    r = await owner.post(`/documents/${quote.id}/variants/${v1.id}/activate`);
    for (const v of r.body.variants) r = await owner.del(`/documents/${quote.id}/variants/${v.id}`);
    expect(r.body.variants).toEqual([]);
    expect(r.body.variantName).toBeNull();
    expect(r.body.total).toBe('2300.00');
  });

  test('варианты только у КП и заказа покупателя и только в черновике', async () => {
    const inv = await mk(owner, '/documents', { type: 'invoice', counterpartyId: company, lines: [line(cable, 1, 100)] });
    expect((await owner.post(`/documents/${inv.id}/variants`, {})).body.error.code).toBe('variants_not_available');
    const order = await mk(owner, '/documents', { type: 'customer_order', counterpartyId: company, lines: [line(phone, 1, 1000)] });
    expect((await owner.post(`/documents/${order.id}/variants`, { copy: true })).status).toBe(201);
    expect((await owner.post(`/documents/${order.id}/post`)).status).toBe(200);
    const r = await owner.post(`/documents/${order.id}/variants`, {});
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('not_draft');
  });

  test('«на основании» берёт основной вариант с группами', async () => {
    await owner.post(`/documents/${quote.id}/variants`, { name: 'Только кабель', copy: false });
    await owner.patch(`/documents/${quote.id}`, { lines: [line(cable, 5, 100, 'Кабели')] });
    expect((await owner.post(`/documents/${quote.id}/post`)).status).toBe(200);
    const r = await owner.post(`/documents/${quote.id}/based-on`, { type: 'customer_order' });
    expect(r.status).toBe(201);
    const order = (await owner.get(`/documents/${r.body.id}`)).body;
    expect(order.lines.map((l: any) => [l.name, l.qty, l.groupName])).toEqual([['Кабель', '5.000', 'Кабели']]);
    expect(order.variants).toEqual([]);
  });

  test('печать КП: стандартная форма с вариантами, группами и экранированием', async () => {
    const html = (await owner.get(`/documents/${quote.id}/print/quote`)).body as string;
    expect(html).toContain('Коммерческое предложение');
    expect(html).toContain('ООО «Покупатель»');
    expect(html).toContain('Только кабель');
    expect(html).toContain('Вариант 1');
    expect(html).toContain('Оборудование');
    // счёт тоже показывает группы
    expect((await owner.get(`/documents/${quote.id}/print/invoice`)).body).toContain('Кабели');
    // у реализации формы КП нет
    const real = await mk(owner, '/documents', { type: 'act', counterpartyId: company, lines: [line(cable, 1, 100)] });
    expect((await owner.get(`/documents/${real.id}/print/quote`)).status).toBe(422);
  });
});

describe('шаблоны КП', () => {
  let shared: any;
  let mine: any;
  let quote: any;

  beforeAll(async () => {
    quote = await mk(owner, '/documents', { type: 'quote', counterpartyId: company, comment: 'Скидка <b>5%</b>', lines: [line(phone, 1, 1000)] });
  });

  test('создание участником, правка — автор или admin+', async () => {
    shared = await mk(member, '/doc-templates', { name: 'КП общее', body: '# Предложение для {{Контрагент}}\n\n**Итого:** {{Сумма}} ({{Сумма прописью}})\n{{Товары}}\nПримечание: {{Комментарий}}\nНет такого: {{Неизвестно}}\nПусто: {{Действительно до}}' });
    expect(shared.purpose).toBe('quote');
    mine = await mk(owner, '/doc-templates', { name: 'КП моё', body: 'Секрет {{Номер}}', onlyAuthor: true });
    expect((await owner.patch(`/doc-templates/${shared.id}`, { name: 'КП общее (admin)' })).status).toBe(200);
    const other2 = await mk(owner, '/doc-templates', { name: 'Чужое для участника', body: 'x' });
    expect((await member.patch(`/doc-templates/${other2.id}`, { name: 'нельзя' })).status).toBe(403);
    expect((await member.del(`/doc-templates/${other2.id}`)).status).toBe(403);
    expect((await owner.post('/doc-templates', { name: 'Договор', purpose: 'contract' })).status).toBe(400);
  });

  test('«только автор» — шаблон не виден и не печатается другими', async () => {
    const forMember = ((await member.get('/doc-templates?purpose=quote')).body.items as any[]).map(t => t.name);
    expect(forMember).not.toContain('КП моё');
    expect((await member.get(`/doc-templates/${mine.id}`)).status).toBe(404);
    expect((await member.get(`/documents/${quote.id}/print/quote?template=${mine.id}`)).status).toBe(404);
    expect((await owner.get(`/documents/${quote.id}/print/quote?template=${mine.id}`)).body).toContain('Секрет (черновик)');
  });

  test('печать по шаблону: подстановка, экранирование, незнакомый параметр и пустая строка', async () => {
    const html = (await owner.get(`/documents/${quote.id}/print/quote?template=${shared.id}`)).body as string;
    expect(html).toContain('<h1 class="center">Предложение для ООО «Покупатель»</h1>');
    expect(html).toContain('<b>Итого:</b> 1\u00a0000,00 (Одна тысяча рублей 00 копеек)');
    expect(html).toContain('Смартфон');
    expect(html).toContain('Скидка &lt;b&gt;5%&lt;/b&gt;');
    expect(html).toContain('{{Неизвестно}}');
    expect(html).not.toContain('Пусто:');
  });

  test('«Используется» и архив', async () => {
    await owner.patch(`/doc-templates/${shared.id}`, { isUsed: false });
    expect(((await owner.get('/doc-templates?used=true')).body.items as any[]).map(t => t.id)).not.toContain(shared.id);
    expect((await owner.del(`/doc-templates/${shared.id}`)).status).toBe(200);
    expect(((await owner.get('/doc-templates')).body.items as any[]).map(t => t.id)).not.toContain(shared.id);
    expect((await owner.get(`/documents/${quote.id}/print/quote?template=${shared.id}`)).status).toBe(404);
  });

  test('PDF по шаблону: файл с шаблоном; чужой «только автор» — 404', async () => {
    const r = await owner.post(`/documents/${quote.id}/pdf`, { form: 'quote', templateId: mine.id });
    expect(r.status).toBe(202);
    expect((await member.post(`/documents/${quote.id}/pdf`, { form: 'quote', templateId: mine.id })).status).toBe(404);
  });

  test('изоляция арендаторов', async () => {
    expect((await other.get(`/doc-templates/${mine.id}`)).status).toBe(404);
    expect((await other.get('/doc-templates')).body.items).toEqual([]);
    expect((await other.post(`/documents/${quote.id}/variants`, {})).status).toBe(404);
  });
});
