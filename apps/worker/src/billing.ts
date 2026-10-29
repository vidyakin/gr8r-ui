/* Задача воркера billing.run: раз в сутки по часовому поясу арендатора для договоров обслуживания, у которых наступил
   день выставления. Счёт за период создаётся один раз (billing_runs), поэтому повторный запуск и два воркера
   не создают двух счетов. */
import { and, eq, isNull } from 'drizzle-orm';
import { contracts, modulesByWorkspace, runBilling, withContext, workspaces, type Sql } from '@gr8r/db';
import { dateInTimezone, periodOf, shiftPeriod } from '@gr8r/shared';

/** Выставленные счета за этот проход (для журнала воркера) */
export async function runBillingOnce(sql: Sql, at: Date = new Date()): Promise<number> {
  const zones = await withContext(sql, {}, db => db.select({ id: workspaces.id, timezone: workspaces.timezone }).from(workspaces), 'app_worker');
  const modules = await modulesByWorkspace(sql);
  let created = 0;
  for (const ws of zones) {
    if (!modules.get(ws.id)?.has('services')) continue; // модуль «Услуги» выключен: счета по договорам не выставляем
    const today = dateInTimezone(ws.timezone, at);
    const n = await withContext(
      sql,
      { workspaceId: ws.id },
      async db => {
        const list = await db.select().from(contracts).where(and(eq(contracts.workspaceId, ws.id), eq(contracts.isService, true), isNull(contracts.archivedAt)));
        let count = 0;
        for (const c of list) {
          const periodicity = c.periodicity ?? 'month';
          const period = periodOf(periodicity, today);
          // день выставления наступил (в коротком месяце — последний день)
          const day = Number(today.slice(8, 10));
          const billingDay = Math.min(c.billingDay, Number(period.end.slice(8, 10)));
          if (day < billingDay) continue;
          // договор действует в этом периоде или в прошедшем: после окончания договора выставляются работы его последнего периода
          if (c.validTo && c.validTo < shiftPeriod(periodicity, period, -1).start) continue;
          if (c.validFrom > period.end) continue;
          const res = await runBilling(db, { workspaceId: ws.id, memberId: null, role: 'owner' }, { period: period.key, contractIds: [c.id] });
          count += res.items.filter(i => !i.skipped).length;
        }
        return count;
      },
      'app_worker',
    );
    created += n;
  }
  return created;
}
