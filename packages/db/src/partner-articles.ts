/* Коды и номенклатура контрагентов (docs/architecture/counterparties.md): наш код у контрагента и артикулы товаров у него.
   Вызывается под контекстом арендатора (RLS), фильтр по workspace_id не нужен. */
import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from './client';
import { counterpartyCodes, productPartnerArticles } from './schema';

export interface PartnerArticle {
  article: string;
  name: string;
}

/** Артикулы и наименования товаров у контрагента: productId → запись (товаров без записи в карте нет) */
export async function partnerArticlesFor(db: Db, companyId: string | null | undefined, productIds: string[]): Promise<Map<string, PartnerArticle>> {
  const ids = [...new Set(productIds)];
  if (!companyId || !ids.length) return new Map();
  const rows = await db
    .select({ productId: productPartnerArticles.productId, article: productPartnerArticles.article, name: productPartnerArticles.name })
    .from(productPartnerArticles)
    .where(and(eq(productPartnerArticles.companyId, companyId), inArray(productPartnerArticles.productId, ids)));
  return new Map(rows.map(r => [r.productId, { article: r.article, name: r.name }]));
}

/** Наш код у контрагента для организации; пусто — не задан */
export async function counterpartyCodeFor(db: Db, companyId: string | null | undefined, organizationId: string): Promise<string> {
  if (!companyId) return '';
  const [row] = await db
    .select({ code: counterpartyCodes.code })
    .from(counterpartyCodes)
    .where(and(eq(counterpartyCodes.companyId, companyId), eq(counterpartyCodes.organizationId, organizationId)))
    .limit(1);
  return row?.code ?? '';
}
