/* Подготавливает последний ежедневный XML для скачивания. Данные читаются под RLS в контексте воркспейса. */
import { eq, sql } from 'drizzle-orm';
import { exportEnterpriseData, integrations1cSchedules, modulesByWorkspace, recordEvent, withContext, workspaces, type Sql } from '@erp/db';
import { addDays, wallClock } from '@erp/shared';

export async function runIcExportsOnce(connection: Sql, now = new Date()) {
  const candidates = await withContext(connection, {}, db => db.select({
    workspaceId: integrations1cSchedules.workspaceId,
    timezone: workspaces.timezone,
    options: integrations1cSchedules.options,
    exportedDate: integrations1cSchedules.exportedDate,
  }).from(integrations1cSchedules).innerJoin(workspaces, eq(workspaces.id, integrations1cSchedules.workspaceId))
    .where(sql`${integrations1cSchedules.options}->>'enabled' = 'true'`), 'app_worker');
  const due = candidates.flatMap(({ workspaceId, timezone, options, exportedDate }) => {
    const local = wallClock(now, timezone).toISOString();
    const date = addDays(local.slice(0, 10), -1);
    const time = local.slice(11, 16);
    return time >= options.time && (!exportedDate || exportedDate < date) ? [{ workspaceId, date, time }] : [];
  });
  if (!due.length) return 0;

  const modules = await modulesByWorkspace(connection, now);
  let ready = 0;
  for (const { workspaceId, date, time } of due) {
    if (!modules.get(workspaceId)?.has('integrations')) continue;
    const context = { workspaceId, system: true };
    try {
      const exported = await withContext(connection, context, async db => {
        const [row] = await db.select({
          options: integrations1cSchedules.options,
          date: integrations1cSchedules.exportedDate,
        }).from(integrations1cSchedules).where(eq(integrations1cSchedules.workspaceId, workspaceId))
          .for('update', { skipLocked: true });
        if (!row?.options.enabled || time < row.options.time || (row.date && row.date >= date)) return false;
        const { xml } = await exportEnterpriseData(db, { workspaceId, memberId: null }, { ...row.options, dateFrom: date, dateTo: date });
        await db.update(integrations1cSchedules).set({ xml, exportedDate: date, failedAt: null })
          .where(eq(integrations1cSchedules.workspaceId, workspaceId));
        await recordEvent(db, { workspaceId, type: 'ic_export.ready', entity: 'ic_export', payload: { date } });
        return true;
      });
      if (exported) ready++;
    } catch {
      // Database errors can include query parameters with accounting data. Log only the workspace.
      console.error(`[1c-export] failed for workspace ${workspaceId}`);
      await withContext(connection, context, async db => {
        await db.update(integrations1cSchedules).set({ failedAt: now }).where(sql`
          ${integrations1cSchedules.workspaceId} = ${workspaceId}
          and ${integrations1cSchedules.options}->>'enabled' = 'true'
          and (${integrations1cSchedules.exportedDate} is null or ${integrations1cSchedules.exportedDate} < ${date}::date)
        `);
      });
    }
  }
  return ready;
}
