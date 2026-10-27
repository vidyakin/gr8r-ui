/* Задача воркера crm.next_contacts (задача 1133): раз в сутки по часовому поясу воркспейса компаниям с наступившей датой
   следующего контакта создаётся дело и уведомление, дата очищается. Журнал crm_next_contact_runs делает проход идемпотентным
   (повтор и два воркера не создают второго дела). */
import { runNextContacts, withContext, workspaces, type Sql } from '@gr8r/db';
import { dateInTimezone } from '@gr8r/shared';

/** Созданные дела за проход (для журнала воркера) */
export async function runNextContactsOnce(sql: Sql, at: Date = new Date()): Promise<number> {
  const zones = await withContext(sql, {}, db => db.select({ id: workspaces.id, timezone: workspaces.timezone }).from(workspaces), 'app_worker');
  let created = 0;
  for (const ws of zones) {
    const today = dateInTimezone(ws.timezone, at);
    created += await withContext(sql, { workspaceId: ws.id }, db => runNextContacts(db, ws.id, today), 'app_worker');
  }
  return created;
}
