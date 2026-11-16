/* Согласование по маршрутам (задача 1199, docs/plans/2026-11-16-approvals.md): константы, подбор маршрута и просрочка.
   Чистые функции — их вызывают и сервис (packages/db/src/approvals.ts), и интерфейс. */
import { dec } from './decimal';

export const APPROVAL_TARGET_KINDS = ['document', 'contract'] as const;
export type ApprovalTargetKind = (typeof APPROVAL_TARGET_KINDS)[number];

export const APPROVAL_STATES = ['in_progress', 'approved', 'rejected', 'cancelled'] as const;
export type ApprovalState = (typeof APPROVAL_STATES)[number];

export const APPROVAL_TASK_STATES = ['waiting', 'pending', 'done', 'skipped'] as const;
export type ApprovalTaskState = (typeof APPROVAL_TASK_STATES)[number];

export const APPROVAL_DECISIONS = ['approve', 'reject', 'comment'] as const;
export type ApprovalDecision = (typeof APPROVAL_DECISIONS)[number];

export const APPROVAL_STEP_MODES = ['sequential', 'parallel'] as const;
export type ApprovalStepMode = (typeof APPROVAL_STEP_MODES)[number];

/** Ящики списка согласований: «Мне на согласование», «Отправленные мной», «Все» (admin и выше) */
export const APPROVAL_BOXES = ['mine', 'sent', 'all'] as const;
export type ApprovalBox = (typeof APPROVAL_BOXES)[number];

/** Коды ошибок согласования (422, кроме отмеченных) */
export const APPROVAL_ERROR_CODES = [
  'approval_required', // обязательный маршрут не пройден
  'approval_outdated', // объект изменён после согласования
  'approval_in_progress', // процесс идёт: проводить нельзя / заявку вручную не согласовать
  'route_step_empty', // на этапе нет согласующих (должность без держателей)
  'route_not_found', // нет подходящего маршрута
  'approval_not_applicable', // объект не отправляют на согласование напрямую
  'approval_not_in_progress', // 409: процесс уже завершён
  'task_not_pending', // 409: задача уже закрыта (решил другой держатель должности)
] as const;

/** Условие маршрута и объект, к которому его применяют */
export interface RouteCondition {
  targetKind: ApprovalTargetKind;
  documentType: string | null;
  organizationId: string | null;
  amountFrom: string | null;
  amountTo: string | null;
}
export interface ApprovalTarget {
  kind: ApprovalTargetKind;
  documentType?: string | null;
  organizationId?: string | null;
  /** Сумма документа; у договора не учитывается */
  total?: string | null;
}

/** Подходит ли маршрут объекту: вид, тип документа, организация и сумма «от — до» (границы включены) */
export function routeMatches(route: RouteCondition, t: ApprovalTarget): boolean {
  if (route.targetKind !== t.kind) return false;
  if (t.kind === 'document') {
    if (route.documentType && route.documentType !== t.documentType) return false;
    const total = dec(t.total ?? '0');
    if (route.amountFrom != null && total < dec(route.amountFrom)) return false;
    if (route.amountTo != null && total > dec(route.amountTo)) return false;
  }
  if (route.organizationId && route.organizationId !== t.organizationId) return false;
  return true;
}

/** Первый подходящий маршрут из списка, уже упорядоченного по sort_order */
export function pickRoute<R extends RouteCondition>(routes: readonly R[], t: ApprovalTarget): R | null {
  return routes.find(r => routeMatches(r, t)) ?? null;
}

/** На сколько часов просрочена задача (0 — не просрочена или срока нет) */
export function overdueHours(dueAt: string | Date | null | undefined, now: Date = new Date()): number {
  if (!dueAt) return 0;
  const ms = now.getTime() - new Date(dueAt).getTime();
  return ms > 0 ? Math.max(1, Math.floor(ms / 3_600_000)) : 0;
}

export const APPROVAL_STATE_LABELS: Record<ApprovalState, string> = { in_progress: 'In progress', approved: 'Approved', rejected: 'Rejected', cancelled: 'Cancelled' };
export const APPROVAL_TASK_STATE_LABELS: Record<ApprovalTaskState, string> = { waiting: 'Waiting', pending: 'Pending', done: 'Done', skipped: 'Skipped' };
export const APPROVAL_DECISION_LABELS: Record<ApprovalDecision, string> = { approve: 'Approve', reject: 'Reject', comment: 'Comment' };
