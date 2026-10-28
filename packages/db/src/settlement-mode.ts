/* Смена режима взаиморасчётов контрагента (`companies.settlement_mode`) с уже проведёнными документами: зачёты пересчитываются по новому режиму.
   Правила — docs/architecture/payments.md, «Смена режима расчётов». Вызывается из PATCH /companies/:id в той же транзакции, что и сама смена. */
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { ACCRUAL_TYPES, dec, type DocumentType, type SettlementMode } from '@gr8r/shared';
import type { Db } from './client';
import { loadPeriodLock } from './cost-closing';
import type { DocCtx } from './documents';
import { DomainError } from './errors';
import { recordEvent } from './events';
import { replayOpeningSettlements } from './opening-balances';
import { replayPaymentSettlements } from './payments';
import { documents, settlementMoves } from './schema';
import { postAccrual } from './settlements';

/** Сальдо по сторонам: перераспределение по документам и авансам его не меняет, поэтому служит проверкой пересчёта */
async function balances(db: Db, companyId: string): Promise<string> {
  const rows = await db
    .select({ side: settlementMoves.side, s: sql<string>`coalesce(sum(${settlementMoves.amount}), 0)::text` })
    .from(settlementMoves)
    .where(eq(settlementMoves.companyId, companyId))
    .groupBy(settlementMoves.side);
  return rows.map(r => `${r.side}:${dec(r.s)}`).sort().join('|');
}

/** Пересчитать зачёты контрагента по режиму, который уже записан в `companies`.
    Строки взаиморасчётов компании удаляются и пишутся заново теми же функциями, что при проведении, в порядке проведения документов.
    Если среди документов есть датированный закрытым периодом — 422 `settlement_mode_period_closed`. Возвращает число пересчитанных документов */
export async function recalcSettlementMode(db: Db, ctx: DocCtx, companyId: string, from: SettlementMode, to: SettlementMode): Promise<number> {
  if (from === to) return 0;
  const ids = (await db.selectDistinct({ id: settlementMoves.documentId }).from(settlementMoves).where(eq(settlementMoves.companyId, companyId))).map(r => r.id);
  if (!ids.length) return 0;
  const docs = await db
    .select()
    .from(documents)
    .where(and(inArray(documents.id, ids), eq(documents.status, 'posted')))
    .orderBy(asc(documents.postedAt), asc(documents.createdAt), asc(documents.id));
  const { closedThrough } = await loadPeriodLock(db, ctx.workspaceId);
  const locked = docs.filter(d => closedThrough && d.date <= closedThrough);
  if (locked.length)
    throw new DomainError(422, 'settlement_mode_period_closed', `The settlement mode cannot be changed: documents dated up to ${closedThrough} are in a closed period`, {
      closedThrough,
      documents: locked.slice(0, 20).map(d => ({ id: d.id, number: d.number, date: d.date })),
    });
  const before = await balances(db, companyId);
  await db.delete(settlementMoves).where(eq(settlementMoves.companyId, companyId));
  for (const d of docs) {
    if (d.type === 'opening_balance') await replayOpeningSettlements(db, ctx.workspaceId, d, companyId);
    else if (ACCRUAL_TYPES[d.type as DocumentType]) await postAccrual(db, ctx.workspaceId, d.id);
    else await replayPaymentSettlements(db, ctx.workspaceId, d, companyId);
  }
  if ((await balances(db, companyId)) !== before) throw new Error('The settlement balance changed during recalculation: nothing was saved (settlement_recalc_mismatch)');
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'company.settlement_mode_changed', entity: 'company', recordId: companyId, actorId: ctx.memberId, payload: { from, to, documents: docs.length } });
  return docs.length;
}
