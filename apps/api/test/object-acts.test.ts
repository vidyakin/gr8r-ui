/* Акты выполненных работ объекта (задача 1273): предложение строк по виду (объёмы = done_qty − принято,
   веха = сумма вехи, часы = неучтённые подтверждённые часы × ставка), нельзя принять больше выполненного,
   аванс актом не закрывается, часы не берутся дважды, подпись и её отмена (member → 403), выставление счёта
   и акта оказания услуг с объектом и заказчиком, суммы с НДС по ставкам сметы, оплата → «оплачено» в сводке
   и у вехи, печать КС-2/КС-3 с суммой прописью, изоляция арендаторов. */
import { beforeAll, describe, expect, test } from 'bun:test';
import { addMember, admin, Client, uniq } from './helpers';

let owner: Client;
let member: Client;
let other: Client;
let customerId = '';
let bankId = '';
let crewId = '';

const mk = async (c: Client, path: string, body: Record<string, unknown> = {}) => {
  const r = await c.post(path, body);
  if (r.status >= 300) throw new Error(`${path} ${JSON.stringify(body)}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};
const uid = () => crypto.randomUUID();

/** Заказчик и объект с согласованной основной сметой; позиции — work с выполненным объёмом */
async function object(number = `ACT-${uniq()}`, extra: Record<string, unknown> = {}) {
  return (await mk(owner, '/objects', { number, name: `Объект ${number}`, customerId, ...extra })) as any;
}

/** Согласованная основная смета объекта; items — позиции (qty, price, vatRate, doneQty) */
async function estimate(objectId: string, items: Record<string, unknown>[]) {
  const est = await mk(owner, `/objects/${objectId}/estimates`, { name: 'Смета объекта' });
  const put = await owner.put(`/estimates/${est.id}/items`, {
    sections: [],
    items: items.map(i => ({ id: uid(), unitCode: '796', kind: 'work', qty: '1', price: '0', vatRate: '20', ...i })),
  });
  if (put.status >= 300) throw new Error(`items ${est.id}: ${put.status} ${JSON.stringify(put.body)}`);
  await mk(owner, `/estimates/${est.id}/approve`);
  return { id: est.id as string, items: put.body.items as any[] };
}

/** Подтверждённая смена с часами работника */
async function shift(objectId: string, workDate: string, hours: { memberId: string; hours: string }[]) {
  const created = await mk(owner, `/objects/${objectId}/shifts`, { workDate });
  const saved = await owner.put(`/shifts/${created.id}`, { hours: hours.map(h => ({ ...h, estimateItemId: null })), volumes: [] });
  if (saved.status >= 300) throw new Error(`save shift: ${saved.status} ${JSON.stringify(saved.body)}`);
  await mk(owner, `/shifts/${created.id}/confirm`);
  return created.id as string;
}

const suggestion = async (objectId: string, q: Record<string, string>) => {
  const sp = new URLSearchParams(q);
  return owner.get(`/objects/${objectId}/acts/suggestion?${sp}`);
};
const revenue = async (objectId: string) => (await owner.get(`/objects/${objectId}/revenue`)).body;

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'Object acts WS' });
  member = await addMember(owner, 'member');
  other = new Client();
  await other.signup({ workspaceName: 'Other object acts WS' });
  customerId = (await mk(owner, '/companies', { name: 'Заказчик КС', inn: '7707083893', kpp: '770701001', legalAddress: 'г. Москва, ул. Строителей, 1' })).id;
  const orgId = (await owner.get('/organizations')).body.items[0].id;
  bankId = (await mk(owner, `/organizations/${orgId}/bank-accounts`, { bik: '044525225', account: '40702810400000000001', bankName: 'Тест-банк' })).id;
  // работник без входа: часы смены для акта «по часам»
  crewId = (await mk(owner, '/members/workers', { name: 'Сидоров Пётр', personnelNumber: 'Т-901' })).id;
});

describe('акт по объёмам', () => {
  test('предложение строк = done_qty − уже принято; больше выполненного принять нельзя', async () => {
    const obj = await object();
    const est = await estimate(obj.id, [
      { name: 'Прокладка кабеля', unitCode: '006', qty: '100', price: '250', doneQty: '40' },
      { name: 'Монтаж щита', qty: '2', price: '12000', doneQty: '1' },
      { name: 'Пусконаладка', qty: '1', price: '30000', doneQty: '0' },
    ]);
    const s = await suggestion(obj.id, { kind: 'volumes', from: '2026-11-01', to: '2026-11-30' });
    expect(s.status).toBe(200);
    // позиция без выполнения в предложение не попадает
    expect(s.body.lines).toHaveLength(2);
    expect(s.body.lines[0].qty).toBe('40.000');
    expect(s.body.lines[1].qty).toBe('1.000');
    expect(s.body.totals.net).toBe('22000.00');

    // принимаем часть: 30 м кабеля
    const cable = est.items[0];
    const act = await mk(owner, `/objects/${obj.id}/acts`, {
      kind: 'volumes',
      actDate: '2026-11-30',
      periodFrom: '2026-11-01',
      periodTo: '2026-11-30',
      lines: [{ estimateItemId: cable.id, qty: '30' }],
    });
    expect(act.number).toBe(`КС-${obj.number.toUpperCase()}-01`);
    expect(act.status).toBe('draft');
    expect(act.totals).toMatchObject({ net: '7500.00', vat: '1500.00', total: '9000.00' });

    // черновик в «принято» не входит: после подписания предложение уменьшится на принятое
    await mk(owner, `/object-acts/${act.id}/sign`, {});
    const after = await suggestion(obj.id, { kind: 'volumes', from: '2026-11-01', to: '2026-11-30' });
    expect(after.body.lines[0].qty).toBe('10.000');
    expect(after.body.lines[0].acceptedQty).toBe('30.000');

    // больше выполненного — 422 act_qty_exceeds_done
    const bad = await owner.post(`/objects/${obj.id}/acts`, { kind: 'volumes', actDate: '2026-11-30', periodFrom: '2026-11-01', periodTo: '2026-11-30', lines: [{ estimateItemId: cable.id, qty: '11' }] });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('act_qty_exceeds_done');
  });

  test('сводка выручки: выполнено по смете, принято по подписанным актам', async () => {
    const obj = await object();
    const est = await estimate(obj.id, [{ name: 'Работы', qty: '10', price: '1000', doneQty: '10' }]);
    expect(await revenue(obj.id)).toMatchObject({ done: '10000.00', accepted: '0.00', invoiced: '0.00', paid: '0.00' });
    const act = await mk(owner, `/objects/${obj.id}/acts`, { kind: 'volumes', actDate: '2026-11-30', periodFrom: '2026-11-01', periodTo: '2026-11-30' });
    await mk(owner, `/object-acts/${act.id}/sign`, {});
    expect(await revenue(obj.id)).toMatchObject({ done: '10000.00', accepted: '10000.00' });
    expect(est.items[0].doneQty).toBe('10.000');
  });

  test('пустой акт: нечего принимать — 422 act_empty', async () => {
    const obj = await object();
    await estimate(obj.id, [{ name: 'Работы', qty: '5', price: '100', doneQty: '0' }]);
    const r = await owner.post(`/objects/${obj.id}/acts`, { kind: 'volumes', actDate: '2026-11-30' });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('act_empty');
  });
});

describe('акт по вехе', () => {
  test('одна строка — сумма вехи; аванс актом не закрывается', async () => {
    const obj = await object();
    await estimate(obj.id, [{ name: 'Работы', qty: '1', price: '100000', doneQty: '0' }]);
    const stage = await mk(owner, `/objects/${obj.id}/milestones`, { name: 'Кабельные трассы', kind: 'stage', amount: '40000' });
    const advance = await mk(owner, `/objects/${obj.id}/milestones`, { name: 'Аванс заказчика', kind: 'advance', amount: '30000' });

    const s = await suggestion(obj.id, { kind: 'milestone', from: '2026-11-01', to: '2026-11-30', milestoneId: stage.id });
    expect(s.status).toBe(200);
    expect(s.body.lines).toHaveLength(1);
    expect(s.body.lines[0]).toMatchObject({ name: 'Кабельные трассы', qty: '1', price: '40000.00', amount: '40000.00' });

    const adv = await suggestion(obj.id, { kind: 'milestone', milestoneId: advance.id });
    expect(adv.status).toBe(422);
    expect(adv.body.error.code).toBe('advance_not_actable');

    const act = await mk(owner, `/objects/${obj.id}/acts`, { kind: 'milestone', milestoneId: stage.id, actDate: '2026-11-30', periodFrom: '2026-11-01', periodTo: '2026-11-30' });
    expect(act.milestoneId).toBe(stage.id);
    expect(act.totals.net).toBe('40000.00');

    // веха уже закрыта актом: второй акт — 422 act_milestone_used
    await mk(owner, `/object-acts/${act.id}/sign`, {});
    const again = await owner.post(`/objects/${obj.id}/acts`, { kind: 'milestone', milestoneId: stage.id, actDate: '2026-11-30' });
    expect(again.status).toBe(422);
    expect(again.body.error.code).toBe('act_milestone_used');
  });
});

describe('акт по часам', () => {
  test('неучтённые подтверждённые часы × ставка; без ставки — 422; повторно часы не берутся', async () => {
    const obj = await object();
    await estimate(obj.id, [{ name: 'Работы', qty: '1', price: '1000', doneQty: '0' }]);
    await shift(obj.id, '2026-11-10', [{ memberId: crewId, hours: '8' }]);
    await shift(obj.id, '2026-11-11', [{ memberId: crewId, hours: '6' }]);

    // ставки нет — 422 customer_rate_required
    const noRate = await suggestion(obj.id, { kind: 'hours', from: '2026-11-01', to: '2026-11-30' });
    expect(noRate.status).toBe(422);
    expect(noRate.body.error.code).toBe('customer_rate_required');

    await owner.patch(`/objects/${obj.id}`, { customerHourRate: '1500' });
    const s = await suggestion(obj.id, { kind: 'hours', from: '2026-11-01', to: '2026-11-30' });
    expect(s.status).toBe(200);
    expect(s.body.hours).toEqual({ hours: '14.000', rate: '1500.00' });
    expect(s.body.lines[0]).toMatchObject({ qty: '14.000', price: '1500.00', amount: '21000.00' });
    expect(s.body.totals).toMatchObject({ net: '21000.00', vat: '4200.00' });

    const act = await mk(owner, `/objects/${obj.id}/acts`, { kind: 'hours', actDate: '2026-11-30', periodFrom: '2026-11-01', periodTo: '2026-11-30' });
    expect(act.totals.net).toBe('21000.00');

    // часы уже в акте: предложение пустое, второй акт по часам — 422 act_empty
    const again = await suggestion(obj.id, { kind: 'hours', from: '2026-11-01', to: '2026-11-30' });
    expect(again.body.hours.hours).toBe('0.000');
    expect(again.body.lines).toHaveLength(0);
    const second = await owner.post(`/objects/${obj.id}/acts`, { kind: 'hours', actDate: '2026-11-30', periodFrom: '2026-11-01', periodTo: '2026-11-30' });
    expect(second.status).toBe(422);
    expect(second.body.error.code).toBe('act_empty');
  });
});

describe('подпись, отмена подписи и выставление', () => {
  test('подпись фиксирует строки, member не может отменить подпись (403)', async () => {
    const obj = await object();
    await estimate(obj.id, [{ name: 'Работы', qty: '4', price: '1000', doneQty: '4' }]);
    const act = await mk(owner, `/objects/${obj.id}/acts`, { kind: 'volumes', actDate: '2026-11-30', periodFrom: '2026-11-01', periodTo: '2026-11-30' });
    const signed = await mk(owner, `/object-acts/${act.id}/sign`, {});
    expect(signed.status).toBe('signed');
    expect(signed.signedAt).not.toBeNull();

    // подписанный акт не правится
    const edit = await owner.patch(`/object-acts/${act.id}`, { note: 'поздно' });
    expect(edit.status).toBe(422);
    expect(edit.body.error.code).toBe('act_signed');

    // отмена подписи: member — 403, владелец — можно
    const forbidden = await member.post(`/object-acts/${act.id}/unsign`, {});
    expect(forbidden.status).toBe(403);
    const back = await mk(owner, `/object-acts/${act.id}/unsign`, {});
    expect(back.status).toBe('draft');
    expect(back.signedAt).toBeNull();

    // черновик снова правится и удаляется
    const patched = await owner.patch(`/object-acts/${act.id}`, { note: 'черновик' });
    expect(patched.status).toBe(200);
    expect(patched.body.note).toBe('черновик');
    expect((await owner.del(`/object-acts/${act.id}`)).status).toBe(200);
  });

  test('выставление: счёт и акт оказания услуг с объектом, заказчиком и НДС по ставкам сметы', async () => {
    const obj = await object();
    await estimate(obj.id, [
      { name: 'Работы с НДС 20', qty: '2', price: '1000', vatRate: '20', doneQty: '2' },
      { name: 'Работы без НДС', qty: '1', price: '500', vatRate: 'none', doneQty: '1' },
    ]);
    const act = await mk(owner, `/objects/${obj.id}/acts`, { kind: 'volumes', actDate: '2026-11-30', periodFrom: '2026-11-01', periodTo: '2026-11-30' });
    await mk(owner, `/object-acts/${act.id}/sign`, {});
    const invoiced = await mk(owner, `/object-acts/${act.id}/invoice`, {});
    expect(invoiced.warnings).toEqual([]);
    expect(invoiced.act.invoiceDocument).not.toBeNull();
    expect(invoiced.act.actDocument).not.toBeNull();

    const invoice = (await owner.get(`/documents/${invoiced.invoiceDocumentId}`)).body;
    const actDoc = (await owner.get(`/documents/${invoiced.actDocumentId}`)).body;
    expect(invoice.type).toBe('invoice');
    expect(actDoc.type).toBe('act');
    // объект и контрагент-заказчик объекта
    expect(invoice.objectId).toBe(obj.id);
    expect(invoice.counterpartyId).toBe(customerId);
    expect(actDoc.objectId).toBe(obj.id);
    expect(actDoc.counterpartyId).toBe(customerId);
    // суммы: 2000 + НДС 400 + 500 без НДС = 2900; НДС по ставкам строк
    expect(actDoc.amountNet).toBe('2500.00');
    expect(actDoc.vatTotal).toBe('400.00');
    expect(actDoc.total).toBe('2900.00');
    expect(invoice.total).toBe('2900.00');
    expect(actDoc.status).toBe('posted');
    // служебная услуга одна на воркспейс: строки документа ссылаются на неё, наименование — из акта
    expect(actDoc.lines.every((l: any) => l.productId === actDoc.lines[0].productId)).toBe(true);
    expect(actDoc.lines[0].name).toBe('Работы с НДС 20');

    // повторно выставить нельзя
    const again = await owner.post(`/object-acts/${act.id}/invoice`, {});
    expect(again.status).toBe(422);
    expect(again.body.error.code).toBe('act_already_invoiced');

    const rev = await revenue(obj.id);
    expect(rev.accepted).toBe('2500.00');
    expect(rev.invoiced).toBe('2500.00');
  });

  test('оплата документа акта → «оплачено» в сводке и у вехи', async () => {
    const obj = await object();
    await estimate(obj.id, [{ name: 'Работы', qty: '1', price: '60000', doneQty: '1' }]);
    const stage = await mk(owner, `/objects/${obj.id}/milestones`, { name: 'Этап 1', kind: 'stage', amount: '60000' });
    const act = await mk(owner, `/objects/${obj.id}/acts`, { kind: 'milestone', milestoneId: stage.id, actDate: '2026-11-30', periodFrom: '2026-11-01', periodTo: '2026-11-30' });
    await mk(owner, `/object-acts/${act.id}/sign`, {});
    const invoiced = await mk(owner, `/object-acts/${act.id}/invoice`, {});

    const pay = await mk(owner, '/payments', {
      type: 'bank_receipt',
      bankAccountId: bankId,
      counterpartyId: customerId,
      operation: 'from_customer',
      date: '2026-12-01',
      lines: [{ settlementDocumentId: invoiced.actDocumentId, amount: '30000' }],
    });
    await mk(owner, `/documents/${pay.id}/post`);

    const rev = await revenue(obj.id);
    expect(rev.paid).toBe('30000.00');
    expect(rev.invoiced).toBe('60000.00');

    const milestones = (await owner.get(`/objects/${obj.id}/milestones`)).body;
    const row = milestones.items.find((m: any) => m.id === stage.id);
    expect(row.invoiced).toBe('60000.00');
    expect(row.paid).toBe('30000.00');
    expect(row.act).toMatchObject({ id: act.id, number: act.number });
    expect(milestones.summary.stages).toMatchObject({ invoiced: '60000.00', paid: '30000.00' });

    // по акту есть оплата: отмена подписи — 422 act_has_payments
    const unsign = await owner.post(`/object-acts/${act.id}/unsign`, {});
    expect(unsign.status).toBe(422);
    expect(unsign.body.error.code).toBe('act_has_payments');
  });
});

describe('печатные формы КС-2 и КС-3', () => {
  test('КС-2 отдаёт HTML со строками и суммой прописью, КС-3 — с итогами за период', async () => {
    const obj = await object('KS-PRINT');
    await estimate(obj.id, [{ name: 'Монтаж лотка', qty: '3', price: '1000', doneQty: '3' }]);
    const act = await mk(owner, `/objects/${obj.id}/acts`, { kind: 'volumes', actDate: '2026-11-30', periodFrom: '2026-11-01', periodTo: '2026-11-30' });
    await mk(owner, `/object-acts/${act.id}/sign`, {});

    const ks2 = await owner.get(`/object-acts/${act.id}/print/ks2`);
    expect(ks2.status).toBe(200);
    expect(ks2.headers.get('content-type')).toContain('text/html');
    expect(ks2.body).toContain('Акт о приёмке выполненных работ');
    expect(ks2.body).toContain('КС-2');
    expect(ks2.body).toContain('Монтаж лотка');
    expect(ks2.body.replace(/\u00a0/g, ' ')).toContain('3 000,00');
    expect(ks2.body).toContain('Три тысячи шестьсот рублей 00 копеек');

    const ks3 = await owner.get(`/object-acts/${act.id}/print/ks3`);
    expect(ks3.status).toBe(200);
    expect(ks3.body).toContain('Справка о стоимости выполненных работ');
    expect(ks3.body).toContain('КС-3');
    expect(ks3.body).toContain('с начала проведения работ');
    expect(ks3.body).toContain('Три тысячи шестьсот рублей 00 копеек');
  });

  test('черновик печатается с пометкой «ЧЕРНОВИК»', async () => {
    const obj = await object('KS-DRAFT');
    await estimate(obj.id, [{ name: 'Работы', qty: '1', price: '100', doneQty: '1' }]);
    const act = await mk(owner, `/objects/${obj.id}/acts`, { kind: 'volumes', actDate: '2026-11-30', periodFrom: '2026-11-01', periodTo: '2026-11-30' });
    const html = await owner.get(`/object-acts/${act.id}/print/ks2`);
    expect(html.status).toBe(200);
    expect(html.body).toContain('ЧЕРНОВИК');
  });
});

describe('изоляция арендаторов', () => {
  test('чужой объект и чужой акт недоступны', async () => {
    const obj = await object();
    await estimate(obj.id, [{ name: 'Работы', qty: '1', price: '100', doneQty: '1' }]);
    const act = await mk(owner, `/objects/${obj.id}/acts`, { kind: 'volumes', actDate: '2026-11-30', periodFrom: '2026-11-01', periodTo: '2026-11-30' });

    expect((await other.get(`/objects/${obj.id}/acts`)).status).toBe(422);
    expect((await other.get(`/objects/${obj.id}/revenue`)).status).toBe(422);
    expect((await other.get(`/object-acts/${act.id}`)).status).toBe(404);
    expect((await other.post(`/object-acts/${act.id}/sign`, {})).status).toBe(404);
    expect((await other.get(`/objects/${obj.id}/acts/suggestion?kind=volumes`)).status).toBe(422);
  });

  test('ссылки на чужие документы не подставляются: акт другого воркспейса не оплатить', async () => {
    const obj = await object();
    await estimate(obj.id, [{ name: 'Работы', qty: '1', price: '100', doneQty: '1' }]);
    const act = await mk(owner, `/objects/${obj.id}/acts`, { kind: 'volumes', actDate: '2026-11-30', periodFrom: '2026-11-01', periodTo: '2026-11-30' });
    await mk(owner, `/object-acts/${act.id}/sign`, {});
    const invoiced = await mk(owner, `/object-acts/${act.id}/invoice`, {});
    // данные других арендаторов: документ существует, но не виден чужому воркспейсу
    const [row] = await admin`select count(*)::int as n from documents where id = ${invoiced.actDocumentId}`;
    expect(row.n).toBe(1);
    expect((await other.get(`/documents/${invoiced.actDocumentId}`)).status).toBe(404);
  });
});
