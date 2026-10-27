/* Заявка на расход (задача 1174г): сколько по ней оплачено и переход в «оплачена». Отдельный модуль без импорта payments.ts —
   его вызывают хуки проведения оплат (docs/architecture/payments.md, «Платёжный календарь»). */
import { and, eq, inArray } from 'drizzle-orm';
import { dec } from '@gr8r/shared';
import type { Db } from './client';
import type { DocCtx } from './documents';
import { recordEvent } from './events';
import { documents } from './schema';

const PAY_TYPES = ['cash_payment', 'bank_payment'];

/** Сумма оплат на основании заявки: проведённых и черновиков (черновики резервируют остаток, чтобы не заплатить дважды) */
export async function requestPaidAmounts(db: Db, requestId: string): Promise<{ posted: bigint; draft: bigint }> {
  const rows = await db.select({ status: documents.status, total: documents.total }).from(documents).where(and(eq(documents.basedOnId, requestId), inArray(documents.type, PAY_TYPES)));
  let posted = 0n;
  let draft = 0n;
  for (const r of rows) {
    if (r.status === 'posted') posted += dec(r.total);
    else if (r.status === 'draft') draft += dec(r.total);
  }
  return { posted, draft };
}

/** Заявка оплачена, когда проведённые оплаты покрывают её сумму; снятие оплаты возвращает «согласована» */
export async function syncRequestPaid(db: Db, ctx: DocCtx, requestId: string): Promise<void> {
  const [req] = await db.select({ type: documents.type, state: documents.state, total: documents.total, status: documents.status }).from(documents).where(eq(documents.id, requestId)).limit(1);
  if (!req || req.type !== 'payment_request' || req.status !== 'posted') return;
  const { posted } = await requestPaidAmounts(db, requestId);
  const to = req.state === 'approved' && posted >= dec(req.total) ? 'paid' : req.state === 'paid' && posted < dec(req.total) ? 'approved' : null;
  if (!to) return;
  await db.update(documents).set({ state: to, updatedAt: new Date() }).where(eq(documents.id, requestId));
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'document.updated', entity: 'document', recordId: requestId, actorId: ctx.memberId, payload: { changes: { state: { from: req.state, to } } } });
}
