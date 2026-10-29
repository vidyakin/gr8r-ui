/* Проход воркера «норматив этапа сделки» (задача 1176): по каждой сделке, застрявшей на этапе дольше норматива, один раз за вход
   в этап пишется событие deal.stage_overdue (его слушает триггер автоматизаций). Повтор прохода ничего не создаёт: отметка
   deals.stage_overdue_notified_at ставится в той же транзакции. */
import { modulesByWorkspace, runDealOverdue, withContext, workspaces, type Sql } from '@gr8r/db';

/** Число объявленных просрочек за проход */
export async function runDealOverdueOnce(sql: Sql, at: Date = new Date()): Promise<number> {
  const list = await withContext(sql, {}, db => db.select({ id: workspaces.id }).from(workspaces), 'app_worker');
  const modules = await modulesByWorkspace(sql);
  let n = 0;
  for (const ws of list) if (modules.get(ws.id)?.has('crm')) n += await withContext(sql, { workspaceId: ws.id }, db => runDealOverdue(db, ws.id, at), 'app_worker');
  return n;
}
