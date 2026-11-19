/* Планировщик входящей почты (docs/architecture/email.md): INBOX раз в три минуты.
   Межарендаторский проход только собирает id; постановка задач — под app_user с блокировкой ящика. */
import { and, eq, isNotNull, sql as dsql } from 'drizzle-orm';
import { jobs, mailboxes, withContext, type Sql } from '@erp/db';

export async function scheduleEmailSyncs(sql: Sql): Promise<number> {
  const boxes = await withContext(sql, {}, db => db
    .select({ id: mailboxes.id, workspaceId: mailboxes.workspaceId })
    .from(mailboxes)
    .where(and(isNotNull(mailboxes.imapHost), isNotNull(mailboxes.imapPort))), 'app_worker');
  let queued = 0;
  for (const box of boxes) {
    queued += await withContext(sql, { workspaceId: box.workspaceId }, async db => {
      const [current] = await db.select().from(mailboxes).where(eq(mailboxes.id, box.id)).for('update');
      if (!current?.imapHost || !current.imapPort || !current.imapSecure || !current.imapUser) return 0;
      const [busy] = await db.select({ id: jobs.id }).from(jobs).where(and(
        eq(jobs.workspaceId, box.workspaceId),
        eq(jobs.type, 'email.sync'),
        dsql`${jobs.payload}->>'mailboxId' = ${box.id}`,
        dsql`(${jobs.status} in ('queued', 'running') or ${jobs.createdAt} > now() - interval '3 minutes')`,
      )).limit(1);
      if (busy) return 0;
      await db.insert(jobs).values({ workspaceId: box.workspaceId, type: 'email.sync', payload: { mailboxId: box.id }, maxAttempts: 5 });
      return 1;
    });
  }
  return queued;
}
