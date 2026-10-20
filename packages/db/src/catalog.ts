/* Каталог: общий код API и сидов. */
import { OKEI_UNITS } from '@gr8r/shared';
import type { Db } from './client';
import { units } from './schema';

/** Базовый набор единиц ОКЕИ для нового воркспейса (повторный вызов ничего не дублирует) */
export async function registerBaseUnits(db: Db, workspaceId: string) {
  await db
    .insert(units)
    .values(OKEI_UNITS.map(u => ({ workspaceId, code: u.code, name: u.name, symbol: u.symbol, isBase: true })))
    .onConflictDoNothing();
}
