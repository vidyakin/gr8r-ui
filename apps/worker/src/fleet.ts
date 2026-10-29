/* Проход воркера «сроки документов автопарка» (задача 1210): уведомления и событие fleet_document.expiring / expired для автоматизаций.
   Повтор прохода ничего не создаёт: отметка notified_* ставится в той же транзакции (packages/db/src/fleet.ts). */
import { modulesByWorkspace, runFleetDocumentReminders, withContext, workspaces, type Sql } from '@gr8r/db';
import { dateInTimezone } from '@gr8r/shared';

/** Число отправленных напоминаний за проход */
export async function runFleetOnce(sql: Sql, at: Date = new Date()): Promise<number> {
  const list = await withContext(sql, {}, db => db.select({ id: workspaces.id, timezone: workspaces.timezone }).from(workspaces), 'app_worker');
  const modules = await modulesByWorkspace(sql);
  let n = 0;
  for (const ws of list) {
    if (!modules.get(ws.id)?.has('transport')) continue;
    const today = dateInTimezone(ws.timezone, at);
    n += await withContext(sql, { workspaceId: ws.id }, db => runFleetDocumentReminders(db, ws.id, today), 'app_worker');
  }
  return n;
}
