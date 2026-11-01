/* Демо скидок и лояльности (задача 1179, по-русски): правила «наибольшая», суммируемое и по промокоду, промокод,
   настроенная программа, дисконтная, накопительная и бонусная карты с движениями баллов. Вызывается в конце сида,
   когда клиенты и документы уже созданы. Документы сид не пересчитывает: проведённые остаются как были. */
import type { Db } from './client';
import type { DocCtx } from './documents';
import { createDiscountRule, createLoyaltyCard, createPromoCode, updateLoyaltyProgram } from './loyalty';
import { loyaltyTransactions } from './schema';

const addDays = (days: number) => new Date(Date.now() + days * 864e5);
const iso = (days: number) => addDays(days).toISOString().slice(0, 10);

export async function seedLoyalty(db: Db, ctx: DocCtx, refs: { customerId: string; secondCustomerId: string }): Promise<void> {
  const ws = ctx.workspaceId;
  // программа: 5 % баллами с продаж, списание до 30 % суммы, баллы сгорают через год, шкала накопительной карты
  await updateLoyaltyProgram(db, ctx, {
    accrualPct: '5',
    redemptionLimitPct: '30',
    expirationDays: 365,
    cumulativeScale: [
      { fromAmount: '50000', pct: '3' },
      { fromAmount: '150000', pct: '5' },
      { fromAmount: '500000', pct: '8' },
    ],
  });

  // две несуммируемые скидки: применяется наибольшая, и суммируемая надбавка поверх неё
  await createDiscountRule(db, ctx, { name: 'Постоянному клиенту', discountPct: '7', customerIds: [refs.customerId] });
  await createDiscountRule(db, ctx, { name: 'Скидка выходного дня', discountPct: '12', weekdays: [6, 7] });
  await createDiscountRule(db, ctx, { name: 'За объём: от 10 штук в строке', discountPct: '3', stackable: true, minLineQty: '10' });
  // правило только по промокоду и сам промокод
  const promoRule = await createDiscountRule(db, ctx, { name: 'Зимняя акция по промокоду', discountPct: '15', promoOnly: true, validFrom: iso(-10), validTo: iso(60) });
  await createPromoCode(db, ctx, { code: 'ZIMA15', ruleId: promoRule, validFrom: iso(-10), validTo: iso(60), usageLimit: 100 });

  // дисконтная карта постоянного процента, накопительная (процент по шкале) и бонусная с историей баллов
  await createLoyaltyCard(db, ctx, { number: 'DC-0001', customerId: refs.customerId, kind: 'discount', discountPct: '5' });
  await createLoyaltyCard(db, ctx, { number: 'CU-0001', customerId: refs.secondCustomerId, kind: 'cumulative' });
  const bonus = await createLoyaltyCard(db, ctx, { number: 'BN-0001', customerId: refs.customerId, kind: 'bonus' });
  // журнал только на добавление: два начисления с разным сроком годности и частичное списание
  const row = (daysAgo: number, kind: 'accrual' | 'redemption', points: string, comment: string, expiresInDays?: number) => ({
    workspaceId: ws,
    cardId: bonus,
    kind,
    points,
    comment,
    expiresAt: expiresInDays === undefined ? null : addDays(expiresInDays),
    createdAt: addDays(-daysAgo),
  });
  await db.insert(loyaltyTransactions).values([
    row(60, 'accrual', '1200.00', 'Начисление по покупке', 305),
    row(20, 'accrual', '450.00', 'Начисление по покупке', 345),
    row(10, 'redemption', '-300.00', 'Списание при покупке'),
  ]);
}
