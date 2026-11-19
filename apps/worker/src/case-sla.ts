/* Проход воркера «просрочка SLA обращений» (docs/architecture/cases.md): раз в минуту по каждому воркспейсу с модулем crm
   просроченные открытые обращения получают отметку и событие case.sla_breached (один раз на каждый срок), ответственный — уведомление.
   Проход идёт под app_user с app.workspace_id арендатора: RLS ограничивает выборку этим воркспейсом. Повтор прохода ничего не создаёт:
   отметка ставится в той же транзакции. */
import { modulesByWorkspace, scanCaseSla, withContext, workspaces, type Sql } from '@erp/db';

/** Число объявленных нарушений за проход */
export async function runCaseSlaOnce(sql: Sql, at: Date = new Date()): Promise<number> {
  const list = await withContext(sql, {}, db => db.select({ id: workspaces.id }).from(workspaces), 'app_worker');
  const modules = await modulesByWorkspace(sql);
  let n = 0;
  for (const ws of list) if (modules.get(ws.id)?.has('crm')) n += await withContext(sql, { workspaceId: ws.id }, db => scanCaseSla(db, ws.id, at));
  return n;
}
