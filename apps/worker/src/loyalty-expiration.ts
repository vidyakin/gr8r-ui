/* Проход воркера «сгорание баллов» (задача 1179): раз в час по каждому арендатору с модулем «Торговля» (там же лояльность)
   сгорают истёкшие начисления баллов в порядке FIFO (packages/db/src/loyalty.ts, runLoyaltyExpiration). Идемпотентно:
   повтор прохода не списывает уже сгоревшие лоты повторно (сверяется движение 'expiration' с reversesId лота). */
import { modulesByWorkspace, runLoyaltyExpiration, withContext, workspaces, type Sql } from '@gr8r/db';

/** Число созданных движений 'expiration' за проход */
export async function runLoyaltyExpirationOnce(sql: Sql, at: Date = new Date()): Promise<number> {
  const list = await withContext(sql, {}, db => db.select({ id: workspaces.id }).from(workspaces), 'app_worker');
  const modules = await modulesByWorkspace(sql);
  let n = 0;
  for (const ws of list) if (modules.get(ws.id)?.has('trade')) n += await withContext(sql, { workspaceId: ws.id }, db => runLoyaltyExpiration(db, ws.id, at), 'app_worker');
  return n;
}
