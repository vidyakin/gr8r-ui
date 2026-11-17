/* Проход воркера «просрочка согласований» (задача 1199): раз в минуту по каждому воркспейсу с модулем docflow вызывается scanOverdue —
   уведомление согласующему и автору и событие approval.step_overdue один раз на задачу (отметка overdue_notified_at в той же транзакции).
   Проход идёт под app_user с app.workspace_id арендатора: RLS ограничивает scanOverdue этим воркспейсом (под app_worker он увидел бы все). */
import { modulesByWorkspace, scanOverdue, withContext, workspaces, type Sql } from '@erp/db';

/** Число задач, о просрочке которых объявлено за проход */
export async function runApprovalOverdueOnce(sql: Sql, at: Date = new Date()): Promise<number> {
  const list = await withContext(sql, {}, db => db.select({ id: workspaces.id }).from(workspaces), 'app_worker');
  const modules = await modulesByWorkspace(sql);
  let n = 0;
  for (const ws of list) if (modules.get(ws.id)?.has('docflow')) n += await withContext(sql, { workspaceId: ws.id }, db => scanOverdue(db, at));
  return n;
}
