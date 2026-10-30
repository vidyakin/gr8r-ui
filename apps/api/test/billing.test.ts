/* Договоры, тарифные планы и биллинг (этап 8 «УНФ: Услуги»): подстановка договора по умолчанию, правила
   абонентской позиции, идемпотентность запуска (два воркера не создают двух счетов), границы периода и дня выставления. */
import { beforeAll, describe, expect, test } from 'bun:test';
import { admin } from './helpers';
import { Client } from './helpers';
import { runBillingOnce } from '../../worker/src/billing';

let owner: Client;
let other: Client;
let ws: string;
let customer: string;
let consult: string;
let repair: string;
let plan: string;
let contract: string;

const mk = async (c: Client, path: string, body: Record<string, unknown>) => {
  const r = await c.post(path, body);
  if (r.status !== 201) throw new Error(`${path} ${JSON.stringify(body)}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'Биллинг WS' });
  ws = owner.workspaceId!;
  other = new Client();
  await other.signup({ workspaceName: 'Чужой биллинг WS' });
  customer = (await mk(owner, '/companies', { name: 'ООО «Абонент»', inn: '7728168971' })).id;
  consult = (await mk(owner, '/products', { name: 'Консультация', kind: 'service', unitCode: '356', price: 1000, vatRate: 'none' })).id;
  repair = (await mk(owner, '/products', { name: 'Ремонт', kind: 'work', unitCode: '356', price: 1500, vatRate: 'none' })).id;
  plan = (await mk(owner, '/tariff-plans', { name: 'Тариф «Поддержка»', extraProductPolicy: 'allow' })).id;
  await owner.post(`/tariff-plans/${plan}/lines`, {
    lines: [
      { productId: consult, qty: '5', price: '1000', isSubscription: true },
      { productId: repair, qty: '1', price: '1500', isSubscription: false },
    ],
  });
  contract = (
    await mk(owner, '/contracts', {
      companyId: customer,
      number: 'Д-2026-1',
      date: '2026-01-01',
      kind: 'customer',
      validFrom: '2026-01-01',
      paymentDays: 5,
      isDefault: true,
      isService: true,
      tariffPlanId: plan,
      periodicity: 'month',
      billingDay: 1,
      documentPackage: 'invoice',
    })
  ).id;
});

/** Счета, выставленные биллингом (по комментарию запуска) */
const invoices = async () => ((await owner.get('/documents?type=invoice&limit=200')).body.items as any[]).filter(d => String(d.comment).startsWith('Billing for'));

describe('contracts', () => {
  test('a contract is created; the same number is a warning, not an error', async () => {
    const list = await owner.get('/contracts');
    expect(list.status).toBe(200);
    expect((list.body.items as any[]).some(c => c.id === contract)).toBe(true);

    const same = await owner.post('/contracts', { companyId: customer, number: 'Д-2026-1', date: '2026-02-01', validFrom: '2026-02-01' });
    expect(same.status).toBe(201);
    expect((same.body.warnings as string[])[0]).toContain('Д-2026-1');
  });

  test('a service contract needs a tariff plan and a periodicity', async () => {
    const r = await owner.post('/contracts', { companyId: customer, date: '2026-01-01', validFrom: '2026-01-01', isService: true });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('tariff_plan_required');
  });

  test('the default contract of the customer is set in a new document with its payment days', async () => {
    const doc = await mk(owner, '/documents', { type: 'invoice', counterpartyId: customer, date: '2026-10-05', lines: [{ productId: consult, qty: '1', price: '1000' }] });
    expect(doc.contractId).toBe(contract);
    expect(doc.dueDate).toBe('2026-10-10'); // срок оплаты договора
  });

  test('the contracts of another workspace are not visible and their id is rejected', async () => {
    const list = await other.get('/contracts');
    expect((list.body.items as any[]).some(c => c.id === contract)).toBe(false);
    const foreign = (await mk(other, '/contracts', { companyId: (await mk(other, '/companies', { name: 'Чужой клиент 2', inn: '7707083893' })).id, number: 'Ч-2', date: '2026-01-01', validFrom: '2026-01-01' })).id;
    const doc = await owner.post('/documents', { type: 'invoice', counterpartyId: customer, contractId: foreign, date: '2026-10-05', lines: [{ productId: consult, qty: '1', price: '1000' }] });
    expect(doc.status).toBe(422);
    expect(doc.body.error.code).toBe('invalid_reference');
  });

  test('the database rejects a contract of another tenant (composite foreign key)', async () => {
    // договор чужого арендатора: составной внешний ключ (workspace_id, contract_id) его не пускает
    const foreign = (await mk(other, '/contracts', { companyId: (await mk(other, '/companies', { name: 'Чужой клиент', inn: '7707083893' })).id, number: 'Ч-1', date: '2026-01-01', validFrom: '2026-01-01' })).id;
    const [org] = await admin`select id from organizations where workspace_id = ${ws} limit 1`;
    let failed = false;
    try {
      await admin`insert into documents (workspace_id, type, date, organization_id, counterparty_id, contract_id) values (${ws}, 'invoice', '2026-10-05', ${org!.id}, ${customer}, ${foreign})`;
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
  });

  test('a product outside the tariff plan is forbidden or warned about when posting', async () => {
    const extra = (await mk(owner, '/products', { name: 'Внеплановый товар', kind: 'service', unitCode: '876', price: 300, vatRate: 'none' })).id;
    const forbidPlan = (await mk(owner, '/tariff-plans', { name: 'Тариф «Запрет»', extraProductPolicy: 'forbid' })).id;
    await owner.post(`/tariff-plans/${forbidPlan}/lines`, { lines: [{ productId: consult, qty: '1', price: '1000', isSubscription: true }] });
    const forbidContract = (await mk(owner, '/contracts', { companyId: customer, number: 'Д-запрет', date: '2026-01-01', validFrom: '2026-01-01', isService: true, tariffPlanId: forbidPlan, periodicity: 'month', billingDay: 1 })).id;
    const doc = await mk(owner, '/documents', { type: 'invoice', counterpartyId: customer, contractId: forbidContract, date: '2026-10-05', lines: [{ productId: extra, qty: '1', price: '300' }] });
    const post = await owner.post(`/documents/${doc.id}/post`);
    expect(post.status).toBe(422);
    expect(post.body.error.code).toBe('extra_product_forbidden');

    const warnPlan = (await mk(owner, '/tariff-plans', { name: 'Тариф «Предупреждение»', extraProductPolicy: 'warn' })).id;
    await owner.post(`/tariff-plans/${warnPlan}/lines`, { lines: [{ productId: consult, qty: '1', price: '1000', isSubscription: true }] });
    const warnContract = (await mk(owner, '/contracts', { companyId: customer, number: 'Д-предупреждение', date: '2026-01-01', validFrom: '2026-01-01', isService: true, tariffPlanId: warnPlan, periodicity: 'month', billingDay: 1 })).id;
    const doc2 = await mk(owner, '/documents', { type: 'invoice', counterpartyId: customer, contractId: warnContract, date: '2026-10-05', lines: [{ productId: extra, qty: '1', price: '300' }] });
    expect((await owner.post(`/documents/${doc2.id}/post`)).status).toBe(200);
  });

  test('a document of a contract that is not valid on its date is not posted', async () => {
    const expired = (await mk(owner, '/contracts', { companyId: customer, number: 'Д-2025', date: '2025-01-01', validFrom: '2025-01-01', validTo: '2025-12-31' })).id;
    const doc = await mk(owner, '/documents', { type: 'invoice', counterpartyId: customer, contractId: expired, date: '2026-10-05', lines: [{ productId: consult, qty: '1', price: '1000' }] });
    const post = await owner.post(`/documents/${doc.id}/post`);
    expect(post.status).toBe(422);
    expect(post.body.error.code).toBe('contract_not_valid');
  });
});

describe('billing: the invoice of the period', () => {
  test('the subscription is issued for the current period and the works by fact for the previous one', async () => {
    // отгрузка сентября по договору — первичный документ периода факта
    const realization = await mk(owner, '/documents', { type: 'realization', counterpartyId: customer, contractId: contract, date: '2026-09-20', lines: [{ productId: repair, qty: '2', price: '1500' }] });
    expect((await owner.post(`/documents/${realization.id}/post`)).status).toBe(200);

    const preview = await owner.get('/billing/preview?period=2026-10');
    expect(preview.status).toBe(200);
    const item = (preview.body.items as any[]).find(i => i.contractId === contract)!;
    expect(item.period).toBe('2026-10');
    expect(item.factPeriod).toBe('2026-09');
    expect(item.lines.map((l: any) => l.name)).toContain('Консультация за октябрь 2026');
    expect(item.lines.map((l: any) => l.name)).toContain('Ремонт за сентябрь 2026');
    // предпросмотр ничего не записывает
    expect(await invoices()).toHaveLength(0);

    const run = await owner.post('/billing/run', { period: '2026-10', contractIds: [contract] });
    expect(run.status).toBe(200);
    expect(run.body.items[0]).toMatchObject({ skipped: false });
    const docs = await invoices();
    expect(docs).toHaveLength(1);
    const detail = (await owner.get(`/documents/${docs[0].id}`)).body;
    expect(detail.lines.map((l: any) => l.name)).toContain('Консультация за октябрь 2026');
    expect(detail.contractId).toBe(contract);
    // счёт периода проводится сразу: номер выдаётся при проведении
    expect(detail.status).toBe('posted');
    expect(detail.number).toMatch(/^СЧ-/);
  });

  test('a repeated run creates nothing new', async () => {
    const before = await invoices();
    const run = await owner.post('/billing/run', { period: '2026-10', contractIds: [contract] });
    expect(run.body.items[0]).toMatchObject({ skipped: true });
    expect(await invoices()).toHaveLength(before.length);
  });

  test('a primary document is billed once: the next period has only the subscription', async () => {
    const run = await owner.post('/billing/run', { period: '2026-11', contractIds: [contract] });
    expect(run.body.items[0]).toMatchObject({ skipped: false });
    const docs = await invoices();
    const november = docs.find(d => d.comment.includes('2026-11'))!;
    const detail = (await owner.get(`/documents/${november.id}`)).body;
    expect(detail.lines.map((l: any) => l.name)).toContain('Консультация за ноябрь 2026');
    expect(detail.lines.map((l: any) => l.name)).not.toContain('Ремонт за сентябрь 2026');
  });

  test('the billing breakdown of the invoice keeps the original lines', async () => {
    const docs = await invoices();
    const invoice = docs.find(d => d.comment.includes('2026-10'))!;
    const breakdown = await owner.get(`/billing/breakdown/${invoice.id}`);
    expect(breakdown.status).toBe(200);
    expect(breakdown.body.subscriptionPeriod).toBe('2026-10');
    expect(breakdown.body.factPeriod).toBe('2026-09');
    const rows = breakdown.body.lines.flatMap((l: any) => l.rows);
    expect(rows.some((r: any) => r.source === 'realization')).toBe(true);
  });

  test('two parallel workers issue one invoice for the period', async () => {
    const plan2 = (await mk(owner, '/tariff-plans', { name: 'Тариф «Параллельный»' })).id;
    await owner.post(`/tariff-plans/${plan2}/lines`, { lines: [{ productId: consult, qty: '2', price: '1000', isSubscription: true }] });
    const c2 = (await mk(owner, '/contracts', { companyId: customer, number: 'Д-паралл', date: '2026-01-01', validFrom: '2026-01-01', isService: true, tariffPlanId: plan2, periodicity: 'month', billingDay: 1 })).id;
    const before = (await invoices()).length;
    const [a, b] = await Promise.all([owner.post('/billing/run', { period: '2026-12', contractIds: [c2] }), owner.post('/billing/run', { period: '2026-12', contractIds: [c2] })]);
    const created = [a.body.items[0], b.body.items[0]].filter((i: any) => !i.skipped).length;
    expect(created).toBe(1);
    expect((await invoices()).length).toBe(before + 1);
  });
});

describe('billing: checks found in review', () => {
  let c5: string;
  beforeAll(async () => {
    const plan5 = (await mk(owner, '/tariff-plans', { name: 'Тариф «Акт»' })).id;
    await owner.post(`/tariff-plans/${plan5}/lines`, { lines: [{ productId: consult, qty: '1', price: '1000', isSubscription: true }] });
    c5 = (await mk(owner, '/contracts', { companyId: customer, number: 'Д-акт', date: '2026-01-01', validFrom: '2026-01-01', isService: true, tariffPlanId: plan5, periodicity: 'month', billingDay: 1, documentPackage: 'invoice_act' })).id;
  });

  test('the act of the package does not sell again what a shipment has already sold', async () => {
    // отгрузка февраля уже признала выручку и долг клиента — в акт она второй раз не идёт
    const realization = await mk(owner, '/documents', { type: 'realization', counterpartyId: customer, contractId: c5, date: '2027-02-10', lines: [{ productId: repair, qty: '1', price: '1500' }] });
    expect((await owner.post(`/documents/${realization.id}/post`)).status).toBe(200);
    const run = await owner.post('/billing/run', { period: '2027-03', contractIds: [c5] });
    expect(run.body.items[0]).toMatchObject({ skipped: false });
    const invoice = (await owner.get(`/documents/${run.body.items[0].documentId}`)).body;
    expect(Number(invoice.total)).toBe(2500);
    const act = ((await owner.get('/documents?type=act&limit=200')).body.items as any[]).find(d => d.contractId === c5)!;
    expect(Number(act.total)).toBe(1000); // только абонплата марта
  });

  test('a cancelled invoice frees its period and its primary documents for a new run', async () => {
    // работа апреля по договору и счёт мая; счёт отменяют — следующий запуск выставляет май заново вместе с работой
    const realization = await mk(owner, '/documents', { type: 'realization', counterpartyId: customer, contractId: c5, date: '2027-04-10', lines: [{ productId: repair, qty: '1', price: '1500' }] });
    expect((await owner.post(`/documents/${realization.id}/post`)).status).toBe(200);
    const run = await owner.post('/billing/run', { period: '2027-05', contractIds: [c5] });
    const docId = run.body.items[0].documentId as string;
    const acts = ((await owner.get('/documents?type=act&limit=200')).body.items as any[]).filter(d => d.contractId === c5 && d.basedOnId === docId);
    for (const a of acts) {
      expect((await owner.post(`/documents/${a.id}/unpost`)).status).toBe(200);
      expect((await owner.post(`/documents/${a.id}/cancel`)).status).toBe(200);
    }
    expect((await owner.post(`/documents/${docId}/unpost`)).status).toBe(200);
    expect((await owner.post(`/documents/${docId}/cancel`)).status).toBe(200);
    const again = await owner.post('/billing/run', { period: '2027-05', contractIds: [c5] });
    expect(again.body.items[0]).toMatchObject({ skipped: false });
    const invoice = (await owner.get(`/documents/${again.body.items[0].documentId}`)).body;
    expect(Number(invoice.total)).toBe(2500); // абонплата мая + работа апреля снова в счёте
    // не отменённый счёт период держит
    expect((await owner.post('/billing/run', { period: '2027-05', contractIds: [c5] })).body.items[0]).toMatchObject({ skipped: true });
  });

  test('the contract report counts the income of a sale once', async () => {
    // по договору: отгрузки 1500 + 1500 и акты абонплаты марта и мая по 1000 (отменённый акт не в счёт);
    // счета — только требования оплаты, выручкой их не считаем
    const r = await owner.get(`/billing/report?contractId=${c5}`);
    expect(r.status).toBe(200);
    const row = (r.body.items as any[]).find(x => x.contractId === c5)!;
    expect(row.income).toBe('5000.00');
  });
});

describe('billing: the worker task', () => {
  test('the invoice is issued on the billing day in the time zone of the workspace', async () => {
    // полночь по Москве — 21:00 UTC предыдущего дня: выставляем в этот момент
    const plan3 = (await mk(owner, '/tariff-plans', { name: 'Тариф «Воркер»' })).id;
    await owner.post(`/tariff-plans/${plan3}/lines`, { lines: [{ productId: consult, qty: '1', price: '1000', isSubscription: true }] });
    const c3 = (await mk(owner, '/contracts', { companyId: customer, number: 'Д-воркер', date: '2026-01-01', validFrom: '2026-01-01', isService: true, tariffPlanId: plan3, periodicity: 'month', billingDay: 1 })).id;
    // до дня выставления счёта нет
    await runBillingOnce(admin, new Date('2026-03-31T21:00:00Z')); // 1 апреля 00:00 по Москве
    const after = (await owner.get(`/documents?type=invoice&limit=200`)).body.items as any[];
    expect(after.some(d => d.comment.includes('2026-04') && d.contractId === c3)).toBe(true);
  });

  test('a billing day of 31 falls on the last day of a short month', async () => {
    const plan4 = (await mk(owner, '/tariff-plans', { name: 'Тариф «31»' })).id;
    await owner.post(`/tariff-plans/${plan4}/lines`, { lines: [{ productId: consult, qty: '1', price: '1000', isSubscription: true }] });
    const c4 = (await mk(owner, '/contracts', { companyId: customer, number: 'Д-31', date: '2026-01-01', validFrom: '2026-01-01', isService: true, tariffPlanId: plan4, periodicity: 'month', billingDay: 31 })).id;
    // 27 февраля: день выставления ещё не наступил (в феврале он приходится на 28-е)
    await runBillingOnce(admin, new Date('2027-02-27T09:00:00Z'));
    let docs = (await owner.get(`/documents?type=invoice&limit=200`)).body.items as any[];
    expect(docs.some(d => d.comment.includes('2027-02') && d.contractId === c4)).toBe(false);
    // 28 февраля: день выставления наступил
    await runBillingOnce(admin, new Date('2027-02-28T09:00:00Z'));
    docs = (await owner.get(`/documents?type=invoice&limit=200`)).body.items as any[];
    expect(docs.some(d => d.comment.includes('2027-02') && d.contractId === c4)).toBe(true);
  });
  test('contract: archive (even if used), archived list, restore; document cancel keeps its reason', async () => {
    const c = await mk(owner, '/contracts', { companyId: customer, number: 'АРХ-1', date: '2027-01-01', kind: 'customer', validFrom: '2027-01-01' });
    const doc = await mk(owner, '/documents', { type: 'realization', counterpartyId: customer, contractId: c.id, date: '2027-01-10', lines: [{ productId: repair, qty: '1', price: '100' }] });
    expect((await owner.del(`/contracts/${c.id}`)).body).toMatchObject({ archived: true });
    expect(((await owner.get(`/contracts?companyId=${customer}`)).body.items as any[]).some(x => x.id === c.id)).toBe(false);
    expect(((await owner.get(`/contracts?companyId=${customer}&archived=true`)).body.items as any[]).some(x => x.id === c.id)).toBe(true);
    expect((await owner.post(`/contracts/${c.id}/restore`)).status).toBe(200);
    expect((await owner.post(`/documents/${doc.id}/cancel`, { reason: 'Клиент отказался' })).status).toBe(200);
    expect((await owner.get(`/documents/${doc.id}`)).body).toMatchObject({ status: 'cancelled', cancelReason: 'Клиент отказался' });
    expect((await owner.post(`/documents/${doc.id}/restore`)).status).toBe(200);
    expect((await owner.get(`/documents/${doc.id}`)).body.cancelReason).toBeNull();
  });
});
