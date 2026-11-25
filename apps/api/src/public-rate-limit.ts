import { sql as dsql } from 'drizzle-orm';
import { rateLimits, withContext, type Sql } from '@erp/db';

/** Учитывает обращение и возвращает false, если лимит окна исчерпан (счётчик коммитится отдельной транзакцией) */
export async function allowPublicRequest(sql: Sql, key: string, max: number, windowSec: number): Promise<boolean> {
  const hits = await withContext(sql, {}, async db => {
    const [r] = await db
      .insert(rateLimits)
      .values({ key, hits: 1 })
      .onConflictDoUpdate({
        target: rateLimits.key,
        set: {
          hits: dsql`case when ${rateLimits.windowStart} < now() - make_interval(secs => ${windowSec}) then 1 else ${rateLimits.hits} + 1 end`,
          windowStart: dsql`case when ${rateLimits.windowStart} < now() - make_interval(secs => ${windowSec}) then now() else ${rateLimits.windowStart} end`,
        },
      })
      .returning({ hits: rateLimits.hits });
    return r!.hits;
  });
  return hits <= max;
}
