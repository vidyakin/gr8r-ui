/* Скидки и лояльность (задача 1179): правила автоскидок (наибольшая/суммирование), карта лояльности как кандидат скидки,
   ручная скидка строки, промокоды (срок/лимит), начисление и списание баллов бонусной карты, сторно при отмене проведения
   и частичное сторно при возврате, изоляция арендаторов. */
import { beforeAll, describe, expect, test } from 'bun:test';
import { loyaltyTransactions, runLoyaltyExpiration, withContext } from '@gr8r/db';
import { Client, admin, sql } from './helpers';

let owner: Client;
let other: Client;
let customer: string;
let customer2: string;
let product: string; // товар, ед. шт, цена 1000

const mk = async (c: Client, path: string, body: Record<string, unknown>) => {
  const r = await c.post(path, body);
  if (r.status !== 201) throw new Error(`${path} ${JSON.stringify(body)}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};
const line = (productId: string, qty: number | string, price: number | string, extra: Record<string, unknown> = {}) => ({ productId, qty, price, ...extra });
const doc = async (c: Client, type: string, lines: any[], extra: Record<string, unknown> = {}) => {
  const r = await c.post('/documents', { type, counterpartyId: customer, lines, ...extra });
  if (r.status !== 201) throw new Error(`doc ${type}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as any;
};
const post = async (id: string, c = owner) => {
  const r = await c.post(`/documents/${id}/post`);
  if (r.status !== 200) throw new Error(`post ${id}: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};

beforeAll(async () => {
  owner = new Client();
  await owner.signup({ workspaceName: 'Loyalty WS' });
  other = new Client();
  await other.signup({ workspaceName: 'Other loyalty WS' });
  await owner.patch('/stock/settings', { allowNegativeStock: true }); // тест проверяет скидки и баллы, не складской учёт
  customer = (await mk(owner, '/companies', { name: 'ООО «Покупатель»', inn: '7707083893', kpp: '770701001' })).id;
  customer2 = (await mk(owner, '/companies', { name: 'ООО «Другой покупатель»', inn: '7728168971' })).id;
  product = (await mk(owner, '/products', { name: 'Товар для скидок', price: 1000, vatRate: '20' })).id;
});

describe('discount rules: largest wins, stackable sums up', () => {
  test('two non-stackable rules: the larger percent applies', async () => {
    const small = await mk(owner, '/loyalty/discount-rules', { name: 'Малая скидка', discountPct: 5, stackable: false });
    const big = await mk(owner, '/loyalty/discount-rules', { name: 'Большая скидка', discountPct: 10, stackable: false });
    const d = await doc(owner, 'realization', [line(product, 1, 1000)]);
    const l = d.lines[0];
    expect(l.discountPct).toBe('10.00');
    await owner.del(`/loyalty/discount-rules/${small.id}`);
    await owner.del(`/loyalty/discount-rules/${big.id}`);
  });

  test('a stackable rule adds on top of the largest non-stackable one', async () => {
    const base = await mk(owner, '/loyalty/discount-rules', { name: 'Базовая', discountPct: 10, stackable: false });
    const extra = await mk(owner, '/loyalty/discount-rules', { name: 'Доп. суммируемая', discountPct: 3, stackable: true });
    const d = await doc(owner, 'realization', [line(product, 1, 1000)]);
    expect(d.lines[0].discountPct).toBe('13.00');
    await owner.del(`/loyalty/discount-rules/${base.id}`);
    await owner.del(`/loyalty/discount-rules/${extra.id}`);
  });
});

describe('loyalty card as a discount candidate', () => {
  test('discount card competes with a rule on equal terms — the larger percent wins', async () => {
    const rule = await mk(owner, '/loyalty/discount-rules', { name: 'Правило 7%', discountPct: 7, stackable: false });
    const card = await mk(owner, '/loyalty/cards', { number: 'CARD-001', customerId: customer, kind: 'discount', discountPct: 12 });
    const d = await doc(owner, 'realization', [line(product, 1, 1000)]);
    await owner.put(`/loyalty/documents/${d.id}/loyalty`, { loyaltyCardId: card.id });
    await owner.post(`/loyalty/documents/${d.id}/recalc-discounts`, {});
    const after = (await owner.get(`/documents/${d.id}`)).body;
    expect(after.lines[0].discountPct).toBe('12.00'); // карта (12%) больше правила (7%)
    await owner.del(`/loyalty/discount-rules/${rule.id}`);
    await owner.del(`/loyalty/cards/${card.id}`);
  });

  test('a rule wins over the card when the rule percent is larger', async () => {
    const rule = await mk(owner, '/loyalty/discount-rules', { name: 'Правило 20%', discountPct: 20, stackable: false });
    const card = await mk(owner, '/loyalty/cards', { number: 'CARD-002', customerId: customer, kind: 'discount', discountPct: 5 });
    const d = await doc(owner, 'realization', [line(product, 1, 1000)]);
    await owner.put(`/loyalty/documents/${d.id}/loyalty`, { loyaltyCardId: card.id });
    await owner.post(`/loyalty/documents/${d.id}/recalc-discounts`, {});
    const after = (await owner.get(`/documents/${d.id}`)).body;
    expect(after.lines[0].discountPct).toBe('20.00');
    await owner.del(`/loyalty/discount-rules/${rule.id}`);
    await owner.del(`/loyalty/cards/${card.id}`);
  });

  test('a cumulative card gives a percent from its program scale based on posted purchases', async () => {
    await owner.patch('/loyalty/program', { cumulativeScale: [{ fromAmount: '0', pct: '2' }, { fromAmount: '5000', pct: '15' }] });
    const card = await mk(owner, '/loyalty/cards', { number: 'CARD-003', customerId: customer2, kind: 'cumulative' });
    // проведённых покупок у клиента ещё нет — действует первая ступень шкалы (2%)
    const d1 = await (async () => { const r = await owner.post('/documents', { type: 'realization', counterpartyId: customer2, lines: [line(product, 10, 1000)] }); return r.body; })();
    await owner.put(`/loyalty/documents/${d1.id}/loyalty`, { loyaltyCardId: card.id });
    await owner.post(`/loyalty/documents/${d1.id}/recalc-discounts`, {});
    const after1 = (await owner.get(`/documents/${d1.id}`)).body;
    expect(after1.lines[0].discountPct).toBe('2.00');
    await post(d1.id); // проводим (сумма после скидки 2% ~9800) — сумма покупок клиента переходит порог 5000 следующей ступени
    const d2 = await (async () => { const r = await owner.post('/documents', { type: 'realization', counterpartyId: customer2, lines: [line(product, 10, 1000)] }); return r.body; })();
    await owner.put(`/loyalty/documents/${d2.id}/loyalty`, { loyaltyCardId: card.id });
    await owner.post(`/loyalty/documents/${d2.id}/recalc-discounts`, {});
    const after2 = (await owner.get(`/documents/${d2.id}`)).body;
    expect(after2.lines[0].discountPct).toBe('15.00'); // сумма проведённых покупок клиента (6000 с НДС) перешла порог 5000
  });
});

describe('manual discount beats automatic', () => {
  test('a manually set discount on a line survives recalculation', async () => {
    const rule = await mk(owner, '/loyalty/discount-rules', { name: 'Авто 9%', discountPct: 9, stackable: false });
    const d = await doc(owner, 'realization', [line(product, 1, 1000)]);
    expect(d.lines[0].discountPct).toBe('9.00');
    const lineId = d.lines[0].id;
    const patched = (await owner.patch(`/documents/${d.id}`, { lines: [{ id: lineId, productId: product, qty: '1', price: '1000', discountPct: '50', discountManual: true }] })).body;
    expect(patched.lines[0].discountPct).toBe('50.00');
    await owner.post(`/loyalty/documents/${d.id}/recalc-discounts`, {});
    const after = (await owner.get(`/documents/${d.id}`)).body;
    expect(after.lines[0].discountPct).toBe('50.00'); // ручная скидка не перезаписана автопересчётом
    await owner.del(`/loyalty/discount-rules/${rule.id}`);
  });
});

describe('manual discount without the flag (clients that do not know discountManual)', () => {
  test('a percent on a new line and a changed percent stay manual, an unchanged automatic percent stays automatic', async () => {
    const rule = await mk(owner, '/loyalty/discount-rules', { name: 'Авто 7%', discountPct: 7, stackable: false });
    const d = await doc(owner, 'invoice', [line(product, 1, 1000, { discountPct: 3 }), line(product, 2, 1000)]);
    expect(d.lines.map((l: any) => l.discountPct)).toEqual(['3.00', '7.00']);
    const [manual, auto] = d.lines;
    const body = (a: string, b: string) => ({ lines: [{ id: manual.id, productId: product, qty: '1', price: '1000', discountPct: a }, { id: auto.id, productId: product, qty: '2', price: '1000', discountPct: b }] });
    await owner.post(`/loyalty/documents/${d.id}/recalc-discounts`, {});
    expect((await owner.get(`/documents/${d.id}`)).body.lines[0].discountPct).toBe('3.00');
    // прежний процент авто-строки не делает её ручной: новое правило на неё действует
    await owner.patch(`/documents/${d.id}`, body('3', '7'));
    const bigger = await mk(owner, '/loyalty/discount-rules', { name: 'Авто 12%', discountPct: 12, stackable: false });
    await owner.post(`/loyalty/documents/${d.id}/recalc-discounts`, {});
    expect((await owner.get(`/documents/${d.id}`)).body.lines.map((l: any) => l.discountPct)).toEqual(['3.00', '12.00']);
    // обнулённая вручную скидка остаётся нулём
    await owner.patch(`/documents/${d.id}`, body('3', '0'));
    await owner.post(`/loyalty/documents/${d.id}/recalc-discounts`, {});
    expect((await owner.get(`/documents/${d.id}`)).body.lines.map((l: any) => l.discountPct)).toEqual(['3.00', '0.00']);
    // discountManual: false возвращает строку автоматике
    await owner.patch(`/documents/${d.id}`, { lines: [{ id: manual.id, productId: product, qty: '1', price: '1000', discountManual: false }, { id: auto.id, productId: product, qty: '2', price: '1000', discountPct: '0' }] });
    expect((await owner.get(`/documents/${d.id}`)).body.lines[0].discountPct).toBe('12.00');
    await owner.del(`/loyalty/discount-rules/${rule.id}`);
    await owner.del(`/loyalty/discount-rules/${bigger.id}`);
  });

  test('a document created on the basis of another inherits line discounts without new rules applied', async () => {
    const order = await doc(owner, 'customer_order', [line(product, 1, 1000)]);
    expect(order.lines[0].discountPct).toBe('0.00');
    const rule = await mk(owner, '/loyalty/discount-rules', { name: 'Поздняя 20%', discountPct: 20, stackable: false });
    const inv = (await owner.post(`/documents/${order.id}/based-on`, { type: 'invoice' })).body;
    expect(inv.lines[0].discountPct).toBe('0.00');
    await owner.del(`/loyalty/discount-rules/${rule.id}`);
  });
});

describe('points expiration: two lots', () => {
  test('points spent from the first lot are not counted against the second one', async () => {
    const ws = owner.workspaceId!;
    const company = (await mk(owner, '/companies', { name: 'ООО «Два лота»', inn: '7736050003' })).id;
    const card = await mk(owner, '/loyalty/cards', { number: 'LOTS-1', customerId: company, kind: 'bonus' });
    const insert = (kind: string, points: string, expiresAt: Date | null, createdAt: Date) =>
      withContext(sql, { workspaceId: ws }, db => db.insert(loyaltyTransactions).values({ workspaceId: ws, cardId: card.id, kind: kind as any, points, expiresAt, createdAt }));
    await insert('accrual', '100.00', new Date('2020-01-01'), new Date('2019-01-01'));
    await insert('accrual', '100.00', new Date('2021-01-01'), new Date('2019-02-01'));
    await insert('redemption', '-30.00', null, new Date('2019-03-01'));
    await withContext(sql, { workspaceId: ws }, db => runLoyaltyExpiration(db, ws, new Date('2020-06-01')));
    expect((await owner.get(`/loyalty/cards/${card.id}`)).body.balance).toBe('100.00');
    await withContext(sql, { workspaceId: ws }, db => runLoyaltyExpiration(db, ws, new Date('2021-06-01')));
    expect((await owner.get(`/loyalty/cards/${card.id}`)).body.balance).toBe('0.00');
    expect(await withContext(sql, { workspaceId: ws }, db => runLoyaltyExpiration(db, ws, new Date('2021-06-01')))).toBe(0);
  });
});

describe('points and money on posting', () => {
  const bonus = async (number: string, inn: string) => {
    const company = (await mk(owner, '/companies', { name: `ООО ${number}`, inn })).id;
    return { company, card: await mk(owner, '/loyalty/cards', { number, customerId: company, kind: 'bonus' }) };
  };
  const balance = async (id: string) => (await owner.get(`/loyalty/cards/${id}`)).body.balance;
  const sale = async (company: string, card: string, points?: string) => {
    const d = await doc(owner, 'realization', [line(product, 1, 1000)], { counterpartyId: company });
    await owner.put(`/loyalty/documents/${d.id}/loyalty`, { loyaltyCardId: card, ...(points ? { pointsRedeemed: points } : {}) });
    return d;
  };

  test('redeemed points reduce the document total, unposting restores it', async () => {
    await owner.patch('/loyalty/program', { accrualPct: 10, redemptionLimitPct: 50 });
    const { company, card } = await bonus('MONEY-1', '7702070139');
    await post((await sale(company, card.id)).id); // +100
    const d = await sale(company, card.id, '100');
    await post(d.id);
    const posted = (await owner.get(`/documents/${d.id}`)).body;
    expect(posted.total).toBe('900.00');
    expect(posted.lines[0].total).toBe('900.00');
    expect(await balance(card.id)).toBe('90.00'); // 100 - 100 + 10% от 900
    await owner.post(`/documents/${d.id}/unpost`);
    expect((await owner.get(`/documents/${d.id}`)).body.total).toBe('1000.00');
    expect(await balance(card.id)).toBe('100.00');
  });

  test('post-unpost cycles do not reverse twice', async () => {
    const { company, card } = await bonus('CYCLE-1', '7710140679');
    const d = await sale(company, card.id);
    for (let i = 0; i < 3; i++) {
      await post(d.id);
      expect(await balance(card.id)).toBe('100.00');
      await owner.post(`/documents/${d.id}/unpost`);
      expect(await balance(card.id)).toBe('0.00');
    }
  });

  test('return and its unposting, then unposting the sale: the balance is never negative', async () => {
    const { company, card } = await bonus('RET-1', '7707049388');
    const d = await sale(company, card.id);
    await post(d.id);
    const ret = (await owner.post(`/documents/${d.id}/based-on`, { type: 'customer_return' })).body;
    await post(ret.id);
    expect(await balance(card.id)).toBe('0.00');
    await owner.post(`/documents/${ret.id}/unpost`);
    expect(await balance(card.id)).toBe('100.00');
    await post(ret.id);
    await owner.post(`/documents/${ret.id}/unpost`);
    await owner.post(`/documents/${d.id}/unpost`);
    expect(await balance(card.id)).toBe('0.00');
  });

  test('returning a sale paid with points refunds the paid money and returns the points to the card', async () => {
    await owner.patch('/loyalty/program', { accrualPct: 10, redemptionLimitPct: 50 });
    const { company, card } = await bonus('REFUND-1', '7720518494');
    await post((await sale(company, card.id)).id); // +100
    const d = await sale(company, card.id, '100');
    await post(d.id); // -100 +90
    expect(await balance(card.id)).toBe('90.00');
    const ret = (await owner.post(`/documents/${d.id}/based-on`, { type: 'customer_return' })).body;
    await post(ret.id);
    const posted = (await owner.get(`/documents/${ret.id}`)).body;
    expect(posted.total).toBe('900.00');
    expect(posted.loyalty.pointsRedeemed).toBe('100.00');
    expect(await balance(card.id)).toBe('100.00'); // +100 списанные, -90 начисленные
    await owner.post(`/documents/${ret.id}/unpost`);
    const draft = (await owner.get(`/documents/${ret.id}`)).body;
    expect(draft.total).toBe('1000.00');
    expect(draft.loyalty).toBeNull();
    expect(await balance(card.id)).toBe('90.00');
    await post(ret.id);
    expect((await owner.get(`/documents/${ret.id}`)).body.total).toBe('900.00');
    expect(await balance(card.id)).toBe('100.00');
  });

  test('a partial return refunds points in proportion', async () => {
    await owner.patch('/loyalty/program', { accrualPct: 10, redemptionLimitPct: 50 });
    const { company, card } = await bonus('REFUND-2', '7704340310');
    const first = await doc(owner, 'realization', [line(product, 2, 1000)], { counterpartyId: company });
    await owner.put(`/loyalty/documents/${first.id}/loyalty`, { loyaltyCardId: card.id });
    await post(first.id); // +200
    const d = await doc(owner, 'realization', [line(product, 2, 1000)], { counterpartyId: company });
    await owner.put(`/loyalty/documents/${d.id}/loyalty`, { loyaltyCardId: card.id, pointsRedeemed: '200' });
    await post(d.id); // -200 +180, сумма 1800
    expect((await owner.get(`/documents/${d.id}`)).body.total).toBe('1800.00');
    const ret = (await owner.post(`/documents/${d.id}/based-on`, { type: 'customer_return' })).body;
    await owner.patch(`/documents/${ret.id}`, { lines: [{ id: ret.lines[0].id, productId: product, qty: '1', price: '1000' }] });
    await post(ret.id);
    expect((await owner.get(`/documents/${ret.id}`)).body.total).toBe('900.00');
    expect(await balance(card.id)).toBe('190.00'); // 180 +100 списанных -90 начисленных
  });

  test('a card of another customer is rejected', async () => {
    const { card } = await bonus('ALIEN-1', '7743013901');
    const d = await doc(owner, 'realization', [line(product, 1, 1000)]);
    const r = await owner.put(`/loyalty/documents/${d.id}/loyalty`, { loyaltyCardId: card.id });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('loyalty_card_foreign');
  });

  test('the based-on document keeps the card', async () => {
    const { company, card } = await bonus('CHAIN-1', '7714698320');
    const order = await doc(owner, 'customer_order', [line(product, 1, 1000)], { counterpartyId: company });
    await owner.put(`/loyalty/documents/${order.id}/loyalty`, { loyaltyCardId: card.id });
    await post(order.id);
    const sh = (await owner.post(`/documents/${order.id}/based-on`, { type: 'realization' })).body;
    expect((await owner.get(`/loyalty/documents/${sh.id}/loyalty`)).body.loyaltyCardId).toBe(card.id);
  });
});

describe('promo code on a document', () => {
  test('a batch of one-time codes', async () => {
    const rule = await mk(owner, '/loyalty/discount-rules', { name: 'Рассылка 5', discountPct: 5, stackable: false, promoOnly: true });
    const r = await owner.post('/loyalty/promo-codes/issue', { ruleId: rule.id, count: 3, prefix: 'MAIL-' });
    expect(r.status).toBe(201);
    expect(new Set(r.body.codes).size).toBe(3);
    expect(r.body.codes[0]).toStartWith('MAIL-');
    await owner.del(`/loyalty/discount-rules/${rule.id}`);
  });

  test('any letter case counts against the limit, recalculation keeps the code, null removes it', async () => {
    const rule = await mk(owner, '/loyalty/discount-rules', { name: 'Промо 25', discountPct: 25, stackable: false, promoOnly: true });
    const promo = await mk(owner, '/loyalty/promo-codes', { code: 'CaseCode', ruleId: rule.id, usageLimit: 1 });
    const d = await doc(owner, 'realization', [line(product, 1, 1000)]);
    await owner.post(`/loyalty/documents/${d.id}/recalc-discounts`, { promoCode: 'casecode' });
    expect((await owner.get(`/loyalty/documents/${d.id}/loyalty`)).body.promoCodeId).toBe(promo.id);
    await owner.post(`/loyalty/documents/${d.id}/recalc-discounts`, {});
    expect((await owner.get(`/documents/${d.id}`)).body.lines[0].discountPct).toBe('25.00');
    await owner.post(`/loyalty/documents/${d.id}/recalc-discounts`, { promoCode: null });
    expect((await owner.get(`/documents/${d.id}`)).body.lines[0].discountPct).toBe('0.00');
    expect((await owner.get(`/loyalty/documents/${d.id}/loyalty`)).body.promoCodeId).toBeNull();
  });
});

describe('promo codes: validity window and usage limit', () => {
  test('an expired promo code is rejected', async () => {
    const rule = await mk(owner, '/loyalty/discount-rules', { name: 'Промо-правило', discountPct: 15, stackable: false, promoOnly: true });
    const promo = await mk(owner, '/loyalty/promo-codes', { code: `EXPIRED-${Date.now()}`, ruleId: rule.id, validTo: '2000-01-01' });
    const d = await doc(owner, 'realization', [line(product, 1, 1000)]);
    const r = await owner.post(`/loyalty/documents/${d.id}/recalc-discounts`, { promoCode: promo.code });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('invalid_promo_code');
    await owner.del(`/loyalty/discount-rules/${rule.id}`);
  });

  test('usage limit: the code stops applying once the limit is reached', async () => {
    const rule = await mk(owner, '/loyalty/discount-rules', { name: 'Лимитное промо-правило', discountPct: 15, stackable: false, promoOnly: true });
    const promo = await mk(owner, '/loyalty/promo-codes', { code: `LIMIT1-${Date.now()}`, ruleId: rule.id, usageLimit: 1 });
    const d1 = await doc(owner, 'realization', [line(product, 1, 1000)]);
    const r1 = await owner.post(`/loyalty/documents/${d1.id}/recalc-discounts`, { promoCode: promo.code });
    expect(r1.status).toBe(200);
    await post(d1.id); // использование засчитывается при проведении (incrementPromoUsage в applyLoyaltyOnPost)
    const d2 = await doc(owner, 'realization', [line(product, 1, 1000)]);
    const r2 = await owner.post(`/loyalty/documents/${d2.id}/recalc-discounts`, { promoCode: promo.code });
    expect(r2.status).toBe(422);
    expect(r2.body.error.code).toBe('invalid_promo_code');
    await owner.del(`/loyalty/discount-rules/${rule.id}`);
  });
});

describe('bonus card: accrual, redemption, reversal on unpost, partial reversal on return', () => {
  test('accrual on posting, redemption limited by document percent and balance', async () => {
    await owner.patch('/loyalty/program', { accrualPct: '5', redemptionLimitPct: '50', expirationDays: 365 });
    const card = await mk(owner, '/loyalty/cards', { number: 'BONUS-001', customerId: customer, kind: 'bonus' });
    const d1 = await doc(owner, 'realization', [line(product, 1, 1000)]);
    await owner.put(`/loyalty/documents/${d1.id}/loyalty`, { loyaltyCardId: card.id });
    await post(d1.id);
    const afterAccrual = (await owner.get(`/loyalty/cards/${card.id}`)).body;
    expect(afterAccrual.balance).toBe('50.00'); // 5% от 1000

    const d2 = await doc(owner, 'realization', [line(product, 1, 1000)]);
    await owner.put(`/loyalty/documents/${d2.id}/loyalty`, { loyaltyCardId: card.id, pointsRedeemed: '1000' }); // просит списать больше лимита и остатка
    await post(d2.id);
    const afterRedeem = (await owner.get(`/loyalty/cards/${card.id}`)).body;
    // списано не больше min(запрошенного, 50% от суммы документа = 500, остатка = 50) = 50
    expect(afterRedeem.balance).toBe('47.50'); // было 50, списано 50 (-50) и начислено 5% от (1000-50)=47.5 (+47.5) => 50-50+47.5=47.5
  });

  test('cancelling posting reverses both accrual and redemption', async () => {
    const card = await mk(owner, '/loyalty/cards', { number: 'BONUS-002', customerId: customer2, kind: 'bonus' });
    const d = await doc(owner, 'realization', [line(product, 1, 1000)], { counterpartyId: customer2 });
    await owner.put(`/loyalty/documents/${d.id}/loyalty`, { loyaltyCardId: card.id });
    await post(d.id);
    const after = (await owner.get(`/loyalty/cards/${card.id}`)).body;
    expect(Number(after.balance)).toBeGreaterThan(0);
    await owner.post(`/documents/${d.id}/unpost`);
    const reversed = (await owner.get(`/loyalty/cards/${card.id}`)).body;
    expect(reversed.balance).toBe('0.00');
  });

  test('a customer return partially reverses the accrual proportionally to the returned amount', async () => {
    const card = await mk(owner, '/loyalty/cards', { number: 'BONUS-003', customerId: customer, kind: 'bonus' });
    const d = await doc(owner, 'realization', [line(product, 2, 1000)]); // сумма 2000, НДС сверху цены по умолчанию товара
    await owner.put(`/loyalty/documents/${d.id}/loyalty`, { loyaltyCardId: card.id });
    await post(d.id);
    const before = (await owner.get(`/loyalty/cards/${card.id}`)).body;
    const accrualBefore = Number(before.balance);
    expect(accrualBefore).toBeGreaterThan(0);
    const ret = (await owner.post(`/documents/${d.id}/based-on`, { type: 'customer_return' })).body;
    // возвращаем половину количества — сумма возврата примерно половина суммы продажи
    const retLine = ret.lines[0];
    const patchRes = await owner.patch(`/documents/${ret.id}`, { lines: [{ id: retLine.id, productId: retLine.productId, qty: String(Number(retLine.qty) / 2), price: retLine.price }] });
    expect(patchRes.status).toBe(200);
    await post(ret.id);
    const after = (await owner.get(`/loyalty/cards/${card.id}`)).body;
    expect(Number(after.balance)).toBeLessThan(accrualBefore);
    expect(Number(after.balance)).toBeGreaterThan(0);
  });

  test('runLoyaltyExpiration burns accrual lots past expiresAt (FIFO), idempotently', async () => {
    const card = await mk(owner, '/loyalty/cards', { number: 'BONUS-004', customerId: customer, kind: 'bonus' });
    const d = await doc(owner, 'realization', [line(product, 1, 1000)]);
    await owner.put(`/loyalty/documents/${d.id}/loyalty`, { loyaltyCardId: card.id });
    await post(d.id);
    const before = (await owner.get(`/loyalty/cards/${card.id}`)).body;
    expect(Number(before.balance)).toBeGreaterThan(0);
    // лот начислен со сроком по программе (365 дней) — искусственно переводим его в прошлое, чтобы проверить сгорание
    await admin`update loyalty_transactions set expires_at = now() - interval '1 day' where card_id = ${card.id} and kind = 'accrual'`;
    const ws = owner.workspaceId!;
    const burned1 = await withContext(sql, { workspaceId: ws }, db => runLoyaltyExpiration(db, ws));
    expect(burned1).toBe(1);
    const after = (await owner.get(`/loyalty/cards/${card.id}`)).body;
    expect(after.balance).toBe('0.00');
    // повторный проход идемпотентен — уже сгоревший лот повторно не списывается
    const burned2 = await withContext(sql, { workspaceId: ws }, db => runLoyaltyExpiration(db, ws));
    expect(burned2).toBe(0);
    const stillZero = (await owner.get(`/loyalty/cards/${card.id}`)).body;
    expect(stillZero.balance).toBe('0.00');
  });
});

describe('tenant isolation', () => {
  test('a discount rule, promo code and loyalty card are invisible to another tenant', async () => {
    const rule = await mk(owner, '/loyalty/discount-rules', { name: 'Чужое правило', discountPct: 10 });
    const promo = await mk(owner, '/loyalty/promo-codes', { code: `TENANT-${Date.now()}`, ruleId: rule.id });
    const card = await mk(owner, '/loyalty/cards', { number: 'TENANT-CARD', customerId: customer, kind: 'discount', discountPct: 5 });

    expect((await other.get(`/loyalty/discount-rules/${rule.id}`)).status).toBe(404);
    expect((await other.get('/loyalty/promo-codes')).body.items ?? []).not.toContainEqual(expect.objectContaining({ id: promo.id }));
    expect((await other.get(`/loyalty/cards/${card.id}`)).status).toBe(404);
    expect((await other.get('/loyalty/cards')).body.items).toEqual([]);

    await owner.del(`/loyalty/discount-rules/${rule.id}`);
  });
});
