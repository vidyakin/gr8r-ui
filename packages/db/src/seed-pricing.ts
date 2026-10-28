/* Демо-данные видов цен (задача 1178, по-русски): «Оптовая» = Розничная − 15 % с округлением до 1 ₽,
   «Дилерская» = себестоимость + 25 %, цены поставщика Atlas с проведённой установкой цен.
   Вызывается в конце сида, когда все товары уже созданы. */
import { and, asc, eq, isNull } from 'drizzle-orm';
import { changeByPercent, NO_ROUNDING } from '@gr8r/shared';
import type { Db } from './client';
import { postDocument, type DocCtx } from './documents';
import { backfillProductPrices, createPriceKind, createPriceSetting, ensurePriceKinds } from './pricing';
import { companies, contracts, products } from './schema';

const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * 864e5).toISOString().slice(0, 10);

export async function seedPricing(db: Db, ctx: DocCtx, refs: { supplierId: string; customerId: string }): Promise<void> {
  const ws = ctx.workspaceId;
  const sys = await ensurePriceKinds(db, ws);
  await backfillProductPrices(db, ws);
  const wholesale = await createPriceKind(db, ctx, { name: 'Оптовая', method: 'derived', baseKindId: sys.retail.id, markupPct: '-15', roundingStep: '1', roundingMode: 'math' });
  await createPriceKind(db, ctx, { name: 'Дилерская', method: 'cost_based', costBasis: 'avg_cost', markupPct: '25', roundingStep: '1', roundingMode: 'up' });
  const [supplier] = await db.select({ id: companies.id, name: companies.name }).from(companies).where(eq(companies.id, refs.supplierId)).limit(1);
  if (supplier) {
    const atlas = await createPriceKind(db, ctx, { name: `Цены поставщика ${supplier.name}`, method: 'manual', supplierId: supplier.id, updateFromReceipts: true });
    // установка цен поставщика: закупочные цены первых товаров со скидкой 5 % к закупочной
    const goods = await db
      .select({ id: products.id, purchasePrice: products.purchasePrice })
      .from(products)
      .where(and(eq(products.workspaceId, ws), eq(products.kind, 'goods'), isNull(products.archivedAt)))
      .orderBy(asc(products.name))
      .limit(4);
    const lines = goods.filter(g => Number(g.purchasePrice) > 0).map(g => ({ productId: g.id, priceKindId: atlas, price: changeByPercent(g.purchasePrice, '-5', NO_ROUNDING) }));
    if (lines.length) {
      const id = await createPriceSetting(db, ctx, { date: iso(20), comment: 'Прайс поставщика на месяц', lines });
      await postDocument(db, ctx, id);
    }
  }
  // демо-договор клиента работает по оптовым ценам
  await db.update(contracts).set({ priceKindId: wholesale, priceType: 'Оптовая' }).where(and(eq(contracts.workspaceId, ws), eq(contracts.companyId, refs.customerId)));
  // черновик установки цен: повышение розницы на 5 % по первым товарам — для показа массового изменения
  const retail = await db
    .select({ id: products.id, price: products.price })
    .from(products)
    .where(and(eq(products.workspaceId, ws), eq(products.kind, 'goods'), isNull(products.archivedAt)))
    .orderBy(asc(products.name))
    .limit(3);
  const draftLines = retail.filter(r => Number(r.price) > 0).map(r => ({ productId: r.id, priceKindId: sys.retail.id, price: changeByPercent(r.price, '5', NO_ROUNDING) }));
  if (draftLines.length) await createPriceSetting(db, ctx, { comment: 'Плановое повышение розничных цен на 5 %', lines: draftLines });
}
