/* Согласование по маршрутам (задача 1199, docs/plans/2026-11-16-approvals.md; раздел docs/architecture/approvals.md).
   Маршруты, процессы и задачи согласующих. Все функции работают на транзакции арендатора (Db под withContext); процесс
   всегда блокируется строкой approvals FOR UPDATE, поэтому два держателя одной должности не решат задачу одновременно.
   Проверка «без согласования нельзя» (assertApproved) вызывается из HTTP-слоя (POST /documents/:id/post, PATCH /contracts/:id),
   системные проведения (биллинг, выписка, закрытие месяца…) её не вызывают. Заявка на расход запускает процесс сама (хук afterPost). */
import { createHash } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNull, lt, max, sql } from 'drizzle-orm';
import { DOCUMENT_META, overdueHours, pickRoute, type ApprovalBox, type ApprovalDecision, type ApprovalState, type ApprovalTargetKind, type DocumentType } from '@erp/shared';
import type { Db } from './client';
import type { DocCtx } from './documents';
import { DomainError } from './errors';
import { recordEvent } from './events';
import { readMyModules } from './licensing';
import {
  approvalRouteParticipants,
  approvalRoutes,
  approvalRouteSteps,
  approvals,
  approvalTasks,
  companies,
  contracts,
  documentLines,
  documents,
  memberPositions,
  members,
  notifications,
  paymentLines,
  positions,
  type ApprovalSnapshot,
} from './schema';

export type ApprovalRow = typeof approvals.$inferSelect;
export type ApprovalTaskRow = typeof approvalTasks.$inferSelect;
export type ApprovalRouteRow = typeof approvalRoutes.$inferSelect;

export interface ApprovalObjectRef {
  kind: ApprovalTargetKind;
  id: string;
}

/** Включён ли модуль «Документооборот» у текущего арендатора (без него маршрутов нет и ничего не блокируется) */
export async function docflowOn(db: Db): Promise<boolean> {
  return (await readMyModules(db)).has('docflow');
}

const sha = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const nowMs = () => new Date();

/* ---------------- объект согласования ---------------- */

interface LoadedTarget {
  kind: ApprovalTargetKind;
  id: string;
  documentType: string | null;
  organizationId: string | null;
  total: string | null;
  /** Документ: draft | posted | cancelled; договор: signed | unsigned | archived */
  status: string;
  label: string;
}

async function loadTarget(db: Db, t: ApprovalObjectRef, lock = false): Promise<LoadedTarget> {
  if (t.kind === 'document') {
    const q = db.select().from(documents).where(eq(documents.id, t.id)).limit(1);
    const [d] = await (lock ? q.for('update') : q);
    if (!d) throw new DomainError(404, 'not_found', 'document not found');
    const meta = DOCUMENT_META[d.type as DocumentType];
    return { kind: 'document', id: d.id, documentType: d.type, organizationId: d.organizationId, total: d.total, status: d.status, label: `${meta?.label ?? d.type} ${d.number ?? '(черновик)'}` };
  }
  const q = db.select().from(contracts).where(eq(contracts.id, t.id)).limit(1);
  const [c] = await (lock ? q.for('update') : q);
  if (!c) throw new DomainError(404, 'not_found', 'contract not found');
  return { kind: 'contract', id: c.id, documentType: null, organizationId: c.organizationId, total: null, status: c.archivedAt ? 'archived' : c.isSigned ? 'signed' : 'unsigned', label: `Договор ${c.number || ''}`.trim() };
}

/** Отпечаток объекта: шапка и состав (документ — дата, организация, контрагент, договор, сумма, хеш строк учёта и платёжных строк) */
export async function fingerprintOf(db: Db, t: ApprovalObjectRef): Promise<string> {
  if (t.kind === 'contract') {
    const [c] = await db.select().from(contracts).where(eq(contracts.id, t.id)).limit(1);
    if (!c) throw new DomainError(404, 'not_found', 'contract not found');
    return sha({ n: c.number, d: c.date, k: c.kind, co: c.companyId, o: c.organizationId, vf: c.validFrom, vt: c.validTo, pd: c.paymentDays, sv: c.isService, tp: c.tariffPlanId, pe: c.periodicity, bd: c.billingDay, dp: c.documentPackage, note: c.note, s: [c.orgSignerBasis, c.partySignerName, c.partySignerTitle, c.partySignerBasis] });
  }
  const [d] = await db.select().from(documents).where(eq(documents.id, t.id)).limit(1);
  if (!d) throw new DomainError(404, 'not_found', 'document not found');
  const lines = await db.select().from(documentLines).where(eq(documentLines.documentId, t.id)).orderBy(asc(documentLines.sortOrder), asc(documentLines.id));
  const pay = await db.select().from(paymentLines).where(eq(paymentLines.documentId, t.id)).orderBy(asc(paymentLines.sortOrder), asc(paymentLines.id));
  return sha({
    d: d.date,
    o: d.organizationId,
    c: d.counterpartyId,
    k: d.contractId,
    t: d.total,
    l: lines.map(l => [l.productId, l.name, l.qty, l.price, l.discountPct, l.vatRate, l.total, l.unitFactor]),
    p: pay.map(l => [l.amount, l.cashFlowItemId, l.settlementDocumentId, l.contractId, l.counterpartyId, l.memberId, l.costItemId]),
  });
}

/* ---------------- подбор маршрута ---------------- */

/** Первый подходящий неархивный маршрут по sort_order; null — согласование не требуется. Модуль не проверяет — это делает вызывающий */
export async function matchRoute(db: Db, t: ApprovalObjectRef): Promise<ApprovalRouteRow | null> {
  const target = await loadTarget(db, t);
  const routes = await db.select().from(approvalRoutes).where(and(isNull(approvalRoutes.archivedAt), eq(approvalRoutes.targetKind, t.kind))).orderBy(asc(approvalRoutes.sortOrder), asc(approvalRoutes.createdAt), asc(approvalRoutes.id));
  return pickRoute(routes, { kind: t.kind, documentType: target.documentType, organizationId: target.organizationId, total: target.total });
}

/* ---------------- уведомления ---------------- */

async function notify(db: Db, ctx: DocCtx, recipientId: string, approvalId: string, text: string, snippet = ''): Promise<void> {
  if (recipientId === ctx.memberId) return;
  const [n] = await db.insert(notifications).values({ workspaceId: ctx.workspaceId, recipientId, type: 'approval', actorId: ctx.memberId, approvalId, text, snippet }).returning({ id: notifications.id });
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'notification.created', entity: 'notification', recordId: n!.id, actorId: ctx.memberId, payload: { recipientId, via: 'approval' } });
}

const objectOf = (ap: Pick<ApprovalRow, 'documentId' | 'contractId'>): ApprovalObjectRef => (ap.documentId ? { kind: 'document', id: ap.documentId } : { kind: 'contract', id: ap.contractId! });

/* ---------------- запуск ---------------- */

/** Держатели должности: активные участники */
async function holdersOf(db: Db, positionId: string): Promise<string[]> {
  const rows = await db
    .select({ id: members.id })
    .from(memberPositions)
    .innerJoin(members, eq(members.id, memberPositions.memberId))
    .where(and(eq(memberPositions.positionId, positionId), eq(members.status, 'active')))
    .orderBy(asc(members.createdAt), asc(members.id));
  return rows.map(r => r.id);
}

async function buildSnapshot(db: Db, routeId: string): Promise<ApprovalSnapshot> {
  const steps = await db.select().from(approvalRouteSteps).where(eq(approvalRouteSteps.routeId, routeId)).orderBy(asc(approvalRouteSteps.sortOrder), asc(approvalRouteSteps.id));
  const snap: ApprovalSnapshot = { steps: [] };
  for (const [i, s] of steps.entries()) {
    const parts = await db.select().from(approvalRouteParticipants).where(eq(approvalRouteParticipants.stepId, s.id)).orderBy(asc(approvalRouteParticipants.sortOrder), asc(approvalRouteParticipants.id));
    const participants: ApprovalSnapshot['steps'][number]['participants'] = [];
    for (const p of parts) {
      if (p.memberId) {
        const [m] = await db.select({ status: members.status }).from(members).where(eq(members.id, p.memberId)).limit(1);
        participants.push({ memberId: p.memberId, positionId: null, positionName: null, holders: m && m.status === 'active' ? [p.memberId] : [] });
      } else {
        const [pos] = await db.select({ name: positions.name }).from(positions).where(eq(positions.id, p.positionId!)).limit(1);
        participants.push({ memberId: null, positionId: p.positionId, positionName: pos?.name ?? '', holders: await holdersOf(db, p.positionId!) });
      }
    }
    const empty = !participants.length || participants.some(p => !p.holders.length);
    if (empty) throw new DomainError(422, 'route_step_empty', `Step ${i + 1}${s.name ? ` «${s.name}»` : ''} has no approvers: a position without holders or an inactive member`, { stepIndex: i, stepName: s.name });
    snap.steps.push({ name: s.name, mode: s.mode, dueHours: s.dueHours, participants });
  }
  if (!snap.steps.length) throw new DomainError(422, 'route_step_empty', 'The route has no steps', { stepIndex: 0, stepName: '' });
  return snap;
}

/** Активирует задачи группы: pending, срок считается от активации */
async function activateGroup(db: Db, ctx: DocCtx, ap: ApprovalRow, tasks: ApprovalTaskRow[], dueHours: number | null): Promise<void> {
  if (!tasks.length) return;
  const dueAt = dueHours ? new Date(Date.now() + dueHours * 3_600_000) : null;
  await db.update(approvalTasks).set({ state: 'pending', dueAt }).where(inArray(approvalTasks.id, tasks.map(t => t.id)));
  const label = (await loadTarget(db, objectOf(ap))).label;
  for (const t of tasks) await notify(db, ctx, t.memberId, ap.id, `На согласование: ${label}`, ap.routeName);
}

async function activateStep(db: Db, ctx: DocCtx, ap: ApprovalRow, stepIndex: number): Promise<void> {
  const step = ap.snapshot.steps[stepIndex]!;
  const tasks = await db.select().from(approvalTasks).where(and(eq(approvalTasks.approvalId, ap.id), eq(approvalTasks.stepIndex, stepIndex))).orderBy(asc(approvalTasks.seq));
  if (step.mode === 'parallel') return activateGroup(db, ctx, ap, tasks, step.dueHours);
  const firstSeq = tasks[0]?.seq;
  await activateGroup(db, ctx, ap, tasks.filter(t => t.seq === firstSeq), step.dueHours);
}

/** Отправляет объект на согласование: подбирает маршрут, снимает снимок, создаёт задачи первого этапа.
    Для заявки на расход вызывается из хука проведения (afterPosting) */
export async function startApproval(db: Db, ctx: DocCtx, ref: ApprovalObjectRef, opts: { afterPosting?: boolean } = {}): Promise<string> {
  const target = await loadTarget(db, ref, true);
  if (ref.kind === 'document') {
    if (target.documentType === 'payment_request' && !opts.afterPosting) throw new DomainError(422, 'approval_not_applicable', 'A payment request is submitted for approval by posting it');
    if (target.documentType !== 'payment_request' && target.status !== 'draft') throw new DomainError(409, 'not_draft', 'Only a draft can be sent for approval');
  } else {
    if (target.status === 'archived') throw new DomainError(409, 'archived', 'The contract is archived');
    if (target.status === 'signed') throw new DomainError(422, 'already_signed', 'The contract is already signed');
  }
  const [active] = await db.select({ id: approvals.id }).from(approvals).where(and(eq(approvals.state, 'in_progress'), ref.kind === 'document' ? eq(approvals.documentId, ref.id) : eq(approvals.contractId, ref.id))).limit(1);
  if (active) throw new DomainError(422, 'approval_in_progress', 'The approval is already in progress', { approvalId: active.id });
  const route = await matchRoute(db, ref);
  if (!route) throw new DomainError(422, 'route_not_found', 'No approval route matches this object');
  const snapshot = await buildSnapshot(db, route.id);
  const [r] = await db
    .select({ m: max(approvals.round) })
    .from(approvals)
    .where(ref.kind === 'document' ? eq(approvals.documentId, ref.id) : eq(approvals.contractId, ref.id));
  const [ap] = await db
    .insert(approvals)
    .values({
      workspaceId: ctx.workspaceId,
      targetKind: ref.kind,
      documentId: ref.kind === 'document' ? ref.id : null,
      contractId: ref.kind === 'contract' ? ref.id : null,
      routeId: route.id,
      routeName: route.name,
      round: (r?.m ?? 0) + 1,
      snapshot,
      currentStep: 0,
      fingerprint: await fingerprintOf(db, ref),
      authorId: ctx.memberId,
    })
    .returning();
  const rows: (typeof approvalTasks.$inferInsert)[] = [];
  snapshot.steps.forEach((s, stepIndex) =>
    s.participants.forEach((p, seq) => {
      for (const memberId of p.holders) rows.push({ workspaceId: ctx.workspaceId, approvalId: ap!.id, stepIndex, seq, groupKey: `${stepIndex}:${seq}`, memberId, positionName: p.positionName, state: 'waiting' });
    }),
  );
  await db.insert(approvalTasks).values(rows);
  await activateStep(db, ctx, ap!, 0);
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'approval.started', entity: 'approval', recordId: ap!.id, actorId: ctx.memberId, payload: { approvalId: ap!.id, targetKind: ref.kind, documentId: ap!.documentId, contractId: ap!.contractId, round: ap!.round, routeName: route.name } });
  return ap!.id;
}

/* ---------------- решение ---------------- */

export interface DecideInput {
  decision: ApprovalDecision;
  comment?: string;
}

async function loadLocked(db: Db, id: string): Promise<ApprovalRow> {
  const [ap] = await db.select().from(approvals).where(eq(approvals.id, id)).limit(1).for('update');
  if (!ap) throw new DomainError(404, 'not_found', 'approval not found');
  return ap;
}

/** Решение по задаче: согласовать, отклонить или оставить комментарий (процесс не двигает). Решает только её исполнитель */
export async function decide(db: Db, ctx: DocCtx, taskId: string, input: DecideInput): Promise<ApprovalRow> {
  const [t0] = await db.select({ approvalId: approvalTasks.approvalId }).from(approvalTasks).where(eq(approvalTasks.id, taskId)).limit(1);
  if (!t0) throw new DomainError(404, 'not_found', 'task not found');
  const ap = await loadLocked(db, t0.approvalId);
  const [task] = await db.select().from(approvalTasks).where(eq(approvalTasks.id, taskId)).limit(1);
  if (!task) throw new DomainError(404, 'not_found', 'task not found');
  if (task.memberId !== ctx.memberId) throw new DomainError(403, 'forbidden', 'The task belongs to another member');
  if (ap.state !== 'in_progress') throw new DomainError(409, 'approval_not_in_progress', 'The approval is already finished');
  if (task.state !== 'pending') throw new DomainError(409, 'task_not_pending', 'The task is already closed');
  const comment = (input.comment ?? '').trim();
  const now = nowMs();
  if (input.decision === 'comment') {
    if (!comment) throw new DomainError(422, 'comment_required', 'A comment needs text');
    await db.update(approvalTasks).set({ notes: [...task.notes, { text: comment, at: now.toISOString() }] }).where(eq(approvalTasks.id, taskId));
    await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'approval.decided', entity: 'approval', recordId: ap.id, actorId: ctx.memberId, payload: { approvalId: ap.id, taskId, decision: 'comment' } });
    return ap;
  }
  await db.update(approvalTasks).set({ state: 'done', decision: input.decision, comment, decidedAt: now }).where(eq(approvalTasks.id, taskId));
  // остальные держатели той же должности: задача закрыта
  await db.update(approvalTasks).set({ state: 'skipped' }).where(and(eq(approvalTasks.approvalId, ap.id), eq(approvalTasks.stepIndex, task.stepIndex), eq(approvalTasks.groupKey, task.groupKey), inArray(approvalTasks.state, ['pending', 'waiting'])));
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'approval.decided', entity: 'approval', recordId: ap.id, actorId: ctx.memberId, payload: { approvalId: ap.id, taskId, decision: input.decision, stepIndex: task.stepIndex } });
  if (input.decision === 'reject') return finish(db, ctx, ap, 'rejected');
  return advance(db, ctx, ap);
}

/** Двигает процесс после согласования задачи: следующий участник этапа, следующий этап или итог «согласовано» */
async function advance(db: Db, ctx: DocCtx, ap: ApprovalRow): Promise<ApprovalRow> {
  const step = ap.snapshot.steps[ap.currentStep]!;
  const tasks = await db.select().from(approvalTasks).where(and(eq(approvalTasks.approvalId, ap.id), eq(approvalTasks.stepIndex, ap.currentStep))).orderBy(asc(approvalTasks.seq));
  const groups = new Map<string, ApprovalTaskRow[]>();
  for (const t of tasks) groups.set(t.groupKey, [...(groups.get(t.groupKey) ?? []), t]);
  const open = [...groups.values()].filter(g => !g.some(t => t.state === 'done' && t.decision === 'approve'));
  if (open.length) {
    // последовательный этап: когда никто не ждёт решения — активируем следующего по очереди
    if (step.mode === 'sequential' && !tasks.some(t => t.state === 'pending')) {
      const next = open.sort((a, b) => a[0]!.seq - b[0]!.seq)[0]!;
      await activateGroup(db, ctx, ap, next, step.dueHours);
    }
    return ap;
  }
  const nextIndex = ap.currentStep + 1;
  if (nextIndex >= ap.snapshot.steps.length) return finish(db, ctx, ap, 'approved');
  const [moved] = await db.update(approvals).set({ currentStep: nextIndex }).where(eq(approvals.id, ap.id)).returning();
  await activateStep(db, ctx, moved!, nextIndex);
  return moved!;
}

async function finish(db: Db, ctx: DocCtx, ap: ApprovalRow, state: Extract<ApprovalState, 'approved' | 'rejected' | 'cancelled'>, reason?: string): Promise<ApprovalRow> {
  const ref = objectOf(ap);
  await db.update(approvalTasks).set({ state: 'skipped' }).where(and(eq(approvalTasks.approvalId, ap.id), inArray(approvalTasks.state, ['pending', 'waiting'])));
  const [done] = await db
    .update(approvals)
    .set({ state, finishedAt: nowMs(), cancelReason: state === 'cancelled' ? (reason ?? '') : null, approvedFingerprint: state === 'approved' ? await fingerprintOf(db, ref) : null })
    .where(eq(approvals.id, ap.id))
    .returning();
  // заявка на расход: итог процесса ставит состояние документа
  if (ap.documentId && state !== 'cancelled') {
    const [d] = await db.select({ type: documents.type, state: documents.state }).from(documents).where(eq(documents.id, ap.documentId)).limit(1);
    if (d?.type === 'payment_request') {
      await db.update(documents).set({ state: state === 'approved' ? 'approved' : 'rejected', updatedAt: nowMs() }).where(eq(documents.id, ap.documentId));
      await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'document.updated', entity: 'document', recordId: ap.documentId, actorId: ctx.memberId, payload: { changes: { state: { from: d.state, to: state === 'approved' ? 'approved' : 'rejected' } } } });
    }
  }
  await recordEvent(db, {
    workspaceId: ctx.workspaceId,
    type: state === 'cancelled' ? 'approval.cancelled' : 'approval.completed',
    entity: 'approval',
    recordId: ap.id,
    actorId: ctx.memberId,
    payload: { approvalId: ap.id, result: state, targetKind: ap.targetKind, documentId: ap.documentId, contractId: ap.contractId, round: ap.round, routeName: ap.routeName },
  });
  if (ap.authorId && state !== 'cancelled') {
    const label = (await loadTarget(db, ref)).label;
    await notify(db, ctx, ap.authorId, ap.id, state === 'approved' ? `Согласовано: ${label}` : `Отклонено: ${label}`, ap.routeName);
  }
  return done!;
}

/** Отзыв процесса: автор или admin и выше (system — снятие с проведения заявки, права не проверяются) */
export async function cancelApproval(db: Db, ctx: DocCtx, id: string, opts: { reason?: string; system?: boolean } = {}): Promise<ApprovalRow> {
  const ap = await loadLocked(db, id);
  if (!opts.system && ap.authorId !== ctx.memberId && ctx.role !== 'admin' && ctx.role !== 'owner') throw new DomainError(403, 'forbidden', 'Only the author or an admin can cancel the approval');
  if (ap.state !== 'in_progress') throw new DomainError(409, 'approval_not_in_progress', 'The approval is already finished');
  return finish(db, ctx, ap, 'cancelled', opts.reason ?? '');
}

/** Идущий процесс объекта (если есть) */
export async function activeApproval(db: Db, ref: ApprovalObjectRef): Promise<ApprovalRow | null> {
  const [ap] = await db.select().from(approvals).where(and(eq(approvals.state, 'in_progress'), ref.kind === 'document' ? eq(approvals.documentId, ref.id) : eq(approvals.contractId, ref.id))).limit(1);
  return ap ?? null;
}

/* ---------------- проверка «без согласования нельзя» ---------------- */

export type ApprovalGate = 'not_required' | 'required' | 'in_progress' | 'approved' | 'outdated';

/** Состояние ворот объекта: нужен ли маршрут и пройден ли он. Нужен — подходящий маршрут обязателен и модуль включён */
export async function approvalGate(db: Db, ref: ApprovalObjectRef): Promise<{ gate: ApprovalGate; route: ApprovalRouteRow | null; latest: ApprovalRow | null }> {
  if (!(await docflowOn(db))) return { gate: 'not_required', route: null, latest: null };
  const route = await matchRoute(db, ref);
  const [latest] = await db
    .select()
    .from(approvals)
    .where(ref.kind === 'document' ? eq(approvals.documentId, ref.id) : eq(approvals.contractId, ref.id))
    .orderBy(desc(approvals.round))
    .limit(1);
  if (!route || !route.required) return { gate: latest?.state === 'in_progress' ? 'in_progress' : 'not_required', route, latest: latest ?? null };
  if (!latest || latest.state === 'rejected' || latest.state === 'cancelled') return { gate: 'required', route, latest: latest ?? null };
  if (latest.state === 'in_progress') return { gate: 'in_progress', route, latest };
  return { gate: latest.approvedFingerprint === (await fingerprintOf(db, ref)) ? 'approved' : 'outdated', route, latest };
}

/** 422 approval_required / approval_in_progress / approval_outdated, если маршрут обязателен и не пройден. Модуль выключен — ничего не блокирует */
export async function assertApproved(db: Db, ref: ApprovalObjectRef): Promise<void> {
  const { gate, latest, route } = await approvalGate(db, ref);
  if (gate === 'required') throw new DomainError(422, 'approval_required', 'This object must be approved by the route before it can be posted or signed', { approvalId: latest?.id ?? null });
  if (gate === 'in_progress' && latest && route?.required) throw new DomainError(422, 'approval_in_progress', 'The approval is in progress', { approvalId: latest.id });
  if (gate === 'outdated') throw new DomainError(422, 'approval_outdated', 'The object was changed after it was approved: send it for approval again', { approvalId: latest?.id ?? null });
}

/** Запрет ручной смены состояния заявки на расход, пока идёт процесс (вызывается из провайдера состояний) */
export async function assertNoActiveApproval(db: Db, documentId: string): Promise<void> {
  if (!(await docflowOn(db))) return;
  if (await activeApproval(db, { kind: 'document', id: documentId })) throw new DomainError(422, 'approval_in_progress', 'The payment request is being approved by a route');
}

/** Хук проведения заявки на расход: подходящий маршрут запускает процесс. Нет маршрута или модуля — как раньше */
export async function startRequestApproval(db: Db, ctx: DocCtx, documentId: string): Promise<string | null> {
  if (!(await docflowOn(db))) return null;
  const ref: ApprovalObjectRef = { kind: 'document', id: documentId };
  if (!(await matchRoute(db, ref))) return null;
  return startApproval(db, ctx, ref, { afterPosting: true });
}

/** Хук снятия заявки с проведения: идущий процесс отзывается */
export async function cancelRequestApproval(db: Db, ctx: DocCtx, documentId: string): Promise<void> {
  const ap = await activeApproval(db, { kind: 'document', id: documentId });
  if (ap) await cancelApproval(db, ctx, ap.id, { reason: 'unposted', system: true });
}

/* ---------------- просрочка (проход воркера) ---------------- */

/** Просроченные задачи: уведомление согласующему и автору один раз (overdue_notified_at) и событие approval.step_overdue.
    Работает под app_worker (видит все воркспейсы) или под app_user одного арендатора. Возвращает число задач */
export async function scanOverdue(db: Db, now: Date = new Date()): Promise<number> {
  const claimed = await db
    .update(approvalTasks)
    .set({ overdueNotifiedAt: now })
    .where(
      and(
        eq(approvalTasks.state, 'pending'),
        isNull(approvalTasks.overdueNotifiedAt),
        lt(approvalTasks.dueAt, now),
        inArray(approvalTasks.approvalId, db.select({ id: approvals.id }).from(approvals).where(eq(approvals.state, 'in_progress'))),
      ),
    )
    .returning();
  for (const t of claimed) {
    const [ap] = await db.select().from(approvals).where(eq(approvals.id, t.approvalId)).limit(1);
    if (!ap) continue;
    const ctx: DocCtx = { workspaceId: t.workspaceId, memberId: null };
    const label = (await loadTarget(db, objectOf(ap))).label;
    const hours = overdueHours(t.dueAt, now);
    await notify(db, ctx, t.memberId, ap.id, `Согласование просрочено: ${label}`, `${hours} ч`);
    if (ap.authorId && ap.authorId !== t.memberId) await notify(db, ctx, ap.authorId, ap.id, `Согласование просрочено: ${label}`, `${hours} ч`);
    await recordEvent(db, { workspaceId: t.workspaceId, type: 'approval.step_overdue', entity: 'approval', recordId: ap.id, payload: { approvalId: ap.id, taskId: t.id, memberId: t.memberId, stepIndex: t.stepIndex, targetKind: ap.targetKind, documentId: ap.documentId, contractId: ap.contractId, overdueHours: hours } });
  }
  return claimed.length;
}

/* ---------------- маршруты: справочник ---------------- */

export interface RouteInput {
  name: string;
  targetKind: ApprovalTargetKind;
  documentType?: string | null;
  organizationId?: string | null;
  amountFrom?: string | null;
  amountTo?: string | null;
  required?: boolean;
  sortOrder?: number;
  steps: { name?: string; mode: 'sequential' | 'parallel'; dueHours?: number | null; participants: { memberId?: string | null; positionId?: string | null }[] }[];
}

export async function routeView(db: Db, route: ApprovalRouteRow) {
  const steps = await db.select().from(approvalRouteSteps).where(eq(approvalRouteSteps.routeId, route.id)).orderBy(asc(approvalRouteSteps.sortOrder), asc(approvalRouteSteps.id));
  const parts = steps.length ? await db.select().from(approvalRouteParticipants).where(inArray(approvalRouteParticipants.stepId, steps.map(s => s.id))).orderBy(asc(approvalRouteParticipants.sortOrder), asc(approvalRouteParticipants.id)) : [];
  return { ...route, steps: steps.map(s => ({ id: s.id, name: s.name, mode: s.mode, dueHours: s.dueHours, participants: parts.filter(p => p.stepId === s.id).map(p => ({ id: p.id, memberId: p.memberId, positionId: p.positionId })) })) };
}

export async function listRoutes(db: Db, opts: { archived?: boolean } = {}) {
  const rows = await db.select().from(approvalRoutes).where(opts.archived ? sql`${approvalRoutes.archivedAt} is not null` : isNull(approvalRoutes.archivedAt)).orderBy(asc(approvalRoutes.sortOrder), asc(approvalRoutes.createdAt), asc(approvalRoutes.id));
  return Promise.all(rows.map(r => routeView(db, r)));
}

export async function getRoute(db: Db, id: string) {
  const [r] = await db.select().from(approvalRoutes).where(eq(approvalRoutes.id, id)).limit(1);
  if (!r) throw new DomainError(404, 'not_found', 'route not found');
  return routeView(db, r);
}

async function replaceSteps(db: Db, ctx: DocCtx, routeId: string, steps: RouteInput['steps']): Promise<void> {
  await db.delete(approvalRouteSteps).where(eq(approvalRouteSteps.routeId, routeId));
  for (const [i, s] of steps.entries()) {
    const [st] = await db.insert(approvalRouteSteps).values({ workspaceId: ctx.workspaceId, routeId, sortOrder: i, name: s.name ?? '', mode: s.mode, dueHours: s.dueHours ?? null }).returning({ id: approvalRouteSteps.id });
    if (s.participants.length)
      await db.insert(approvalRouteParticipants).values(s.participants.map((p, j) => ({ workspaceId: ctx.workspaceId, stepId: st!.id, sortOrder: j, memberId: p.memberId ?? null, positionId: p.positionId ?? null })));
  }
}

const checkRoute = (input: Partial<RouteInput>) => {
  if (input.targetKind === 'contract' && input.documentType) throw new DomainError(422, 'validation_error', 'A contract route has no document type');
};

export async function createRoute(db: Db, ctx: DocCtx, input: RouteInput) {
  checkRoute(input);
  const [r] = await db
    .insert(approvalRoutes)
    .values({ workspaceId: ctx.workspaceId, name: input.name, targetKind: input.targetKind, documentType: input.documentType ?? null, organizationId: input.organizationId ?? null, amountFrom: input.amountFrom ?? null, amountTo: input.amountTo ?? null, required: input.required ?? true, sortOrder: input.sortOrder ?? 0 })
    .returning();
  await replaceSteps(db, ctx, r!.id, input.steps);
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'approval_route.created', entity: 'approval_route', recordId: r!.id, actorId: ctx.memberId, payload: {} });
  return getRoute(db, r!.id);
}

/** undefined — не трогать, null — очистить; шаги, если пришли, заменяются целиком (идущие процессы держат свой снимок) */
export async function updateRoute(db: Db, ctx: DocCtx, id: string, patch: Partial<RouteInput>) {
  const [cur] = await db.select().from(approvalRoutes).where(eq(approvalRoutes.id, id)).limit(1).for('update');
  if (!cur) throw new DomainError(404, 'not_found', 'route not found');
  checkRoute({ targetKind: patch.targetKind ?? cur.targetKind, documentType: patch.documentType === undefined ? cur.documentType : patch.documentType });
  const set: Partial<typeof approvalRoutes.$inferInsert> = { updatedAt: nowMs() };
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.targetKind !== undefined) set.targetKind = patch.targetKind;
  if (patch.documentType !== undefined) set.documentType = patch.documentType;
  if (patch.organizationId !== undefined) set.organizationId = patch.organizationId;
  if (patch.amountFrom !== undefined) set.amountFrom = patch.amountFrom;
  if (patch.amountTo !== undefined) set.amountTo = patch.amountTo;
  if (patch.required !== undefined) set.required = patch.required;
  if (patch.sortOrder !== undefined) set.sortOrder = patch.sortOrder;
  await db.update(approvalRoutes).set(set).where(eq(approvalRoutes.id, id));
  if (patch.steps) await replaceSteps(db, ctx, id, patch.steps);
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'approval_route.updated', entity: 'approval_route', recordId: id, actorId: ctx.memberId, payload: {} });
  return getRoute(db, id);
}

/** Маршрут не удаляется: его архивируют (процессы и листы согласования хранят название и снимок) */
export async function archiveRoute(db: Db, ctx: DocCtx, id: string, archived = true): Promise<void> {
  const rows = await db.update(approvalRoutes).set({ archivedAt: archived ? nowMs() : null, updatedAt: nowMs() }).where(eq(approvalRoutes.id, id)).returning({ id: approvalRoutes.id });
  if (!rows.length) throw new DomainError(404, 'not_found', 'route not found');
  await recordEvent(db, { workspaceId: ctx.workspaceId, type: 'approval_route.updated', entity: 'approval_route', recordId: id, actorId: ctx.memberId, payload: { archived } });
}

/* ---------------- представления процессов ---------------- */

export async function approvalDetail(db: Db, id: string) {
  const [ap] = await db.select().from(approvals).where(eq(approvals.id, id)).limit(1);
  if (!ap) throw new DomainError(404, 'not_found', 'approval not found');
  return viewOf(db, ap);
}

async function viewOf(db: Db, ap: ApprovalRow) {
  const ref = objectOf(ap);
  const tasks = await db.select({ t: approvalTasks, memberName: members.name }).from(approvalTasks).innerJoin(members, eq(members.id, approvalTasks.memberId)).where(eq(approvalTasks.approvalId, ap.id)).orderBy(asc(approvalTasks.stepIndex), asc(approvalTasks.seq), asc(approvalTasks.createdAt), asc(approvalTasks.id));
  const [author] = ap.authorId ? await db.select({ name: members.name }).from(members).where(eq(members.id, ap.authorId)).limit(1) : [];
  const now = new Date();
  const changed = ap.state === 'in_progress' ? (await fingerprintOf(db, ref)) !== ap.fingerprint : false;
  const target = await loadTarget(db, ref).catch(() => null);
  return {
    id: ap.id,
    targetKind: ap.targetKind,
    documentId: ap.documentId,
    contractId: ap.contractId,
    objectLabel: target?.label ?? '',
    /** Тип документа (payment_request открывается своей страницей); у договора null */
    documentType: target?.documentType ?? null,
    routeId: ap.routeId,
    routeName: ap.routeName,
    round: ap.round,
    state: ap.state,
    currentStep: ap.currentStep,
    currentStepName: ap.snapshot.steps[ap.currentStep]?.name ?? '',
    snapshot: ap.snapshot,
    authorId: ap.authorId,
    authorName: author?.name ?? null,
    startedAt: ap.startedAt,
    finishedAt: ap.finishedAt,
    cancelReason: ap.cancelReason,
    /** Объект изменён после отправки (идущий процесс) */
    changedSinceSubmit: changed,
    tasks: tasks.map(({ t, memberName }) => ({
      id: t.id,
      stepIndex: t.stepIndex,
      seq: t.seq,
      groupKey: t.groupKey,
      memberId: t.memberId,
      memberName,
      positionName: t.positionName,
      state: t.state,
      decision: t.decision,
      comment: t.comment,
      notes: t.notes,
      decidedAt: t.decidedAt,
      dueAt: t.dueAt,
      overdueHours: t.state === 'pending' ? overdueHours(t.dueAt, now) : 0,
    })),
  };
}

/** Всё о согласовании объекта: нужен ли маршрут, ворота, идущий процесс и история кругов (новые сверху) */
export async function approvalsOfObject(db: Db, ref: ApprovalObjectRef) {
  const enabled = await docflowOn(db);
  const { gate, route } = await approvalGate(db, ref);
  const rounds = await db
    .select()
    .from(approvals)
    .where(ref.kind === 'document' ? eq(approvals.documentId, ref.id) : eq(approvals.contractId, ref.id))
    .orderBy(desc(approvals.round));
  const views = await Promise.all(rounds.map(r => viewOf(db, r)));
  return {
    enabled,
    gate,
    route: route && enabled ? { id: route.id, name: route.name, required: route.required } : null,
    /** Можно отправить: маршрут подходит, процесса нет (заявка на расход подаётся проведением) */
    canStart: enabled && !!route && gate !== 'in_progress' && gate !== 'approved' && !(ref.kind === 'document' && (await loadTarget(db, ref)).documentType === 'payment_request'),
    current: views.find(v => v.state === 'in_progress') ?? null,
    rounds: views,
  };
}

export interface ListApprovalsParams {
  box: ApprovalBox;
  state?: ApprovalState;
  targetKind?: ApprovalTargetKind;
  limit: number;
  offset: number;
}

/** Списки согласований: «Мне на согласование» (мои открытые задачи), «Отправленные мной», «Все» (права проверяет API) */
export async function listApprovals(db: Db, ctx: DocCtx, p: ListApprovalsParams) {
  if (p.box !== 'all' && !ctx.memberId) return { total: 0, items: [] };
  const conds = [];
  if (p.state) conds.push(eq(approvals.state, p.state));
  if (p.targetKind) conds.push(eq(approvals.targetKind, p.targetKind));
  if (p.box === 'mine') {
    conds.push(eq(approvals.state, 'in_progress'));
    conds.push(inArray(approvals.id, db.select({ id: approvalTasks.approvalId }).from(approvalTasks).where(and(eq(approvalTasks.memberId, ctx.memberId!), eq(approvalTasks.state, 'pending')))));
  } else if (p.box === 'sent') {
    conds.push(eq(approvals.authorId, ctx.memberId!));
  }
  const where = conds.length ? and(...conds) : undefined;
  const [total] = await db.select({ n: sql<number>`count(*)::int` }).from(approvals).where(where);
  const rows = await db.select().from(approvals).where(where).orderBy(desc(approvals.startedAt), desc(approvals.id)).limit(p.limit).offset(p.offset);
  const ids = rows.map(r => r.id);
  const mine = ids.length && ctx.memberId ? await db.select().from(approvalTasks).where(and(inArray(approvalTasks.approvalId, ids), eq(approvalTasks.memberId, ctx.memberId), eq(approvalTasks.state, 'pending'))) : [];
  const docIds = rows.map(r => r.documentId).filter((x): x is string => !!x);
  const docs = new Map((docIds.length ? await db.select({ id: documents.id, type: documents.type, number: documents.number, date: documents.date, total: documents.total, counterpartyName: companies.name }).from(documents).leftJoin(companies, eq(companies.id, documents.counterpartyId)).where(inArray(documents.id, docIds)) : []).map(d => [d.id, d]));
  const conIds = rows.map(r => r.contractId).filter((x): x is string => !!x);
  const cons = new Map((conIds.length ? await db.select({ id: contracts.id, number: contracts.number, date: contracts.date, counterpartyName: companies.name }).from(contracts).leftJoin(companies, eq(companies.id, contracts.companyId)).where(inArray(contracts.id, conIds)) : []).map(c => [c.id, c]));
  const authorIds = [...new Set(rows.map(r => r.authorId).filter((x): x is string => !!x))];
  const authors = new Map((authorIds.length ? await db.select({ id: members.id, name: members.name }).from(members).where(inArray(members.id, authorIds)) : []).map(m => [m.id, m.name]));
  const now = new Date();
  const pendingDue = ids.length ? await db.select({ approvalId: approvalTasks.approvalId, dueAt: approvalTasks.dueAt }).from(approvalTasks).where(and(inArray(approvalTasks.approvalId, ids), eq(approvalTasks.state, 'pending'))) : [];
  return {
    total: total!.n,
    items: rows.map(r => {
      const d = r.documentId ? docs.get(r.documentId) : undefined;
      const c = r.contractId ? cons.get(r.contractId) : undefined;
      const myTask = mine.find(t => t.approvalId === r.id);
      return {
        id: r.id,
        targetKind: r.targetKind,
        documentId: r.documentId,
        contractId: r.contractId,
        documentType: d?.type ?? null,
        number: d?.number ?? c?.number ?? null,
        date: d?.date ?? c?.date ?? null,
        total: d?.total ?? null,
        counterpartyName: d?.counterpartyName ?? c?.counterpartyName ?? null,
        routeName: r.routeName,
        round: r.round,
        state: r.state,
        currentStep: r.currentStep,
        currentStepName: r.snapshot.steps[r.currentStep]?.name ?? '',
        stepCount: r.snapshot.steps.length,
        authorId: r.authorId,
        authorName: r.authorId ? (authors.get(r.authorId) ?? null) : null,
        startedAt: r.startedAt,
        finishedAt: r.finishedAt,
        myTaskId: myTask?.id ?? null,
        overdueHours: Math.max(0, ...pendingDue.filter(t => t.approvalId === r.id).map(t => overdueHours(t.dueAt, now))),
      };
    }),
  };
}
