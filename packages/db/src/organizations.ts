/* Страновые настройки организации в транзакции воркспейса. */
import { asc, desc, eq, isNull } from 'drizzle-orm';
import { getCountryPack } from '@erp/shared';
import type { Db } from './client';
import { organizations } from './schema';

export async function organizationCurrency(db: Db, id: string): Promise<string> {
  const [org] = await db.select({ country: organizations.country }).from(organizations).where(eq(organizations.id, id)).limit(1);
  return getCountryPack(org?.country).currency;
}

export async function organizationVatDefaults(db: Db, id: string) {
  const [org] = await db.select({ country: organizations.country, defaultVatRate: organizations.defaultVatRate })
    .from(organizations).where(eq(organizations.id, id)).limit(1);
  return vatDefaults(org);
}

function vatDefaults(org?: { country: string; defaultVatRate: string }) {
  const pack = getCountryPack(org?.country);
  const configured = org?.defaultVatRate;
  const defaultVatRate = configured && pack.vatRates.includes(configured) ? configured : pack.defaultVatRate;
  return { pack, defaultVatRate };
}

export async function workspaceVatDefaults(db: Db) {
  const [org] = await db.select({ country: organizations.country, defaultVatRate: organizations.defaultVatRate })
    .from(organizations).where(isNull(organizations.archivedAt))
    .orderBy(desc(organizations.isDefault), asc(organizations.createdAt)).limit(1);
  const { pack, defaultVatRate } = vatDefaults(org);
  return { pack, defaultVatRate: pack.code === 'RU' ? pack.defaultVatRate : defaultVatRate };
}
