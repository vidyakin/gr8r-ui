/* Задача воркера production.close_period: закрытие месяца (или периода «за период») и отмена закрытия (этап 6).

   Запускается под ролью app_user в контексте арендатора — RLS действует, чужие записи недоступны даже по известному id.
   Каждый месяц — своя транзакция: ошибка одного месяца не откатывает уже закрытые предыдущие (в статус уходит failed).
   Месяцы закрываются по порядку, отмена — в обратном; внутри транзакции месяца держится рекомендательная блокировка
   воркспейса, поэтому два закрытия одного воркспейса не идут одновременно. */
import { and, eq } from 'drizzle-orm';
import { monthRange } from '@gr8r/shared';
import { closePeriodMonth, productionCostClosings, reopenPeriodMonth, withContext, type DocCtx, type Sql } from '@gr8r/db';

/** payload задачи: месяц «2026-10», необязательный конец периода и признак отмены закрытия */
export interface ClosePeriodPayload {
  month: string;
  through?: string;
  reopen?: boolean;
}

const isMonth = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
const MONTH_RE = 'production.close_period job: payload';

export async function runClosePeriod(sql: Sql, workspaceId: string, payload: ClosePeriodPayload): Promise<string[]> {
  if (!isMonth(payload.month)) throw new Error(`${MONTH_RE}.month must be YYYY-MM`);
  if (payload.through !== undefined && !isMonth(payload.through)) throw new Error(`${MONTH_RE}.through must be YYYY-MM`);
  const { month, through, reopen } = payload;
  const months = through && through > month ? monthRange(month, through) : [month];
  const ctx: DocCtx = { workspaceId, memberId: null, role: 'owner' };
  const failed: string[] = [];
  for (const m of reopen ? [...months].reverse() : months) {
    try {
      await withContext(sql, { workspaceId }, async db => void (reopen ? await reopenPeriodMonth(db, ctx, m) : await closePeriodMonth(db, ctx, m)), 'app_user');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await withContext(
        sql,
        { workspaceId },
        db => db.update(productionCostClosings).set({ status: 'failed', error: msg.slice(0, 1000), updatedAt: new Date() }).where(and(eq(productionCostClosings.workspaceId, workspaceId), eq(productionCostClosings.period, `${m}-01`))),
        'app_user',
      );
      failed.push(m);
    }
  }
  return failed;
}
