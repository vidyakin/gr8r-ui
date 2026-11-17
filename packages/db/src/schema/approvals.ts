/* Согласование по маршрутам (задача 1199, docs/plans/2026-11-16-approvals.md): маршруты, процессы и задачи согласующих.
   Таблицы арендатора: workspace_id + RLS, ссылки составные (миграция 0123). */
import { sql } from 'drizzle-orm';
import { boolean, check, foreignKey, index, integer, jsonb, pgTable, text, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { archivedAt, createdAt, money, pk, ts, updatedAt } from './columns';
import { contracts } from './billing';
import { documents, organizations } from './documents';
import { members, wsCol } from './people';
import { positions } from './positions';

/** Маршрут согласования: условие (вид, тип документа, организация, сумма), обязательность и порядок выбора */
export const approvalRoutes = pgTable(
  'approval_routes',
  {
    id: pk(),
    workspaceId: wsCol(),
    name: text('name').notNull(),
    targetKind: text('target_kind', { enum: ['document', 'contract'] }).notNull().default('document'),
    documentType: text('document_type'),
    organizationId: uuid('organization_id'),
    amountFrom: money('amount_from'),
    amountTo: money('amount_to'),
    /** Обязательный маршрут: без согласования документ не провести, договор не отметить подписанным */
    required: boolean('required').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    archivedAt: archivedAt(),
  },
  t => [
    unique('approval_routes_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.organizationId], foreignColumns: [organizations.workspaceId, organizations.id], name: 'approval_routes_org_fk' }),
    check('approval_routes_kind_chk', sql`${t.targetKind} in ('document','contract')`),
    check('approval_routes_type_chk', sql`${t.targetKind} = 'document' or ${t.documentType} is null`),
    check('approval_routes_amount_chk', sql`${t.amountFrom} is null or ${t.amountTo} is null or ${t.amountTo} >= ${t.amountFrom}`),
    index('approval_routes_ws_idx').on(t.workspaceId, t.sortOrder),
  ],
);

/** Этап маршрута: последовательный (участники по очереди) или параллельный (всем сразу) */
export const approvalRouteSteps = pgTable(
  'approval_route_steps',
  {
    id: pk(),
    workspaceId: wsCol(),
    routeId: uuid('route_id').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    name: text('name').notNull().default(''),
    mode: text('mode', { enum: ['sequential', 'parallel'] }).notNull().default('sequential'),
    dueHours: integer('due_hours'),
  },
  t => [
    unique('approval_route_steps_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.routeId], foreignColumns: [approvalRoutes.workspaceId, approvalRoutes.id], name: 'approval_route_steps_route_fk' }).onDelete('cascade'),
    check('approval_route_steps_mode_chk', sql`${t.mode} in ('sequential','parallel')`),
    check('approval_route_steps_due_chk', sql`${t.dueHours} is null or ${t.dueHours} > 0`),
    index('approval_route_steps_route_idx').on(t.workspaceId, t.routeId),
  ],
);

/** Участник этапа: сотрудник или должность (решает первый из держателей должности) */
export const approvalRouteParticipants = pgTable(
  'approval_route_participants',
  {
    id: pk(),
    workspaceId: wsCol(),
    stepId: uuid('step_id').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    memberId: uuid('member_id'),
    positionId: uuid('position_id'),
  },
  t => [
    foreignKey({ columns: [t.workspaceId, t.stepId], foreignColumns: [approvalRouteSteps.workspaceId, approvalRouteSteps.id], name: 'approval_route_participants_step_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.memberId], foreignColumns: [members.workspaceId, members.id], name: 'approval_route_participants_member_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.positionId], foreignColumns: [positions.workspaceId, positions.id], name: 'approval_route_participants_position_fk' }).onDelete('cascade'),
    check('approval_route_participants_one_chk', sql`(${t.memberId} is not null) <> (${t.positionId} is not null)`),
    index('approval_route_participants_step_idx').on(t.workspaceId, t.stepId),
  ],
);

/** Снимок этапов процесса: правка маршрута идущие процессы не меняет */
export interface ApprovalSnapshotParticipant {
  memberId: string | null;
  positionId: string | null;
  positionName: string | null;
  /** Кто решает: сам участник или держатели должности на момент отправки */
  holders: string[];
}
export interface ApprovalSnapshotStep {
  name: string;
  mode: 'sequential' | 'parallel';
  dueHours: number | null;
  participants: ApprovalSnapshotParticipant[];
}
export interface ApprovalSnapshot {
  steps: ApprovalSnapshotStep[];
}

/** Процесс согласования объекта (документа или договора): один круг — одна строка */
export const approvals = pgTable(
  'approvals',
  {
    id: pk(),
    workspaceId: wsCol(),
    targetKind: text('target_kind', { enum: ['document', 'contract'] }).notNull(),
    documentId: uuid('document_id'),
    contractId: uuid('contract_id'),
    routeId: uuid('route_id'),
    routeName: text('route_name').notNull().default(''),
    round: integer('round').notNull().default(1),
    state: text('state', { enum: ['in_progress', 'approved', 'rejected', 'cancelled'] }).notNull().default('in_progress'),
    snapshot: jsonb('snapshot').$type<ApprovalSnapshot>().notNull(),
    currentStep: integer('current_step').notNull().default(0),
    /** Отпечаток объекта при отправке и при итоговом «согласовано» */
    fingerprint: text('fingerprint').notNull().default(''),
    approvedFingerprint: text('approved_fingerprint'),
    authorId: uuid('author_id'),
    startedAt: ts('started_at').notNull().defaultNow(),
    finishedAt: ts('finished_at'),
    cancelReason: text('cancel_reason'),
    createdAt: createdAt(),
  },
  t => [
    unique('approvals_ws_id_uq').on(t.workspaceId, t.id),
    foreignKey({ columns: [t.workspaceId, t.documentId], foreignColumns: [documents.workspaceId, documents.id], name: 'approvals_document_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.contractId], foreignColumns: [contracts.workspaceId, contracts.id], name: 'approvals_contract_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.routeId], foreignColumns: [approvalRoutes.workspaceId, approvalRoutes.id], name: 'approvals_route_fk' }).onDelete('set null'),
    foreignKey({ columns: [t.workspaceId, t.authorId], foreignColumns: [members.workspaceId, members.id], name: 'approvals_author_fk' }).onDelete('set null'),
    check('approvals_kind_chk', sql`${t.targetKind} in ('document','contract')`),
    check('approvals_object_chk', sql`(${t.documentId} is not null) <> (${t.contractId} is not null)`),
    check('approvals_state_chk', sql`${t.state} in ('in_progress','approved','rejected','cancelled')`),
    uniqueIndex('approvals_doc_active_uq').on(t.workspaceId, t.documentId).where(sql`${t.state} = 'in_progress' and ${t.documentId} is not null`),
    uniqueIndex('approvals_contract_active_uq').on(t.workspaceId, t.contractId).where(sql`${t.state} = 'in_progress' and ${t.contractId} is not null`),
    uniqueIndex('approvals_round_uq').on(t.workspaceId, sql`coalesce(${t.documentId}, ${t.contractId})`, t.round),
    index('approvals_state_idx').on(t.workspaceId, t.state),
  ],
);

/** Задача согласующего: по одной на сотрудника; держатели одной должности делят group_key, решает первый, остальные — skipped */
export const approvalTasks = pgTable(
  'approval_tasks',
  {
    id: pk(),
    workspaceId: wsCol(),
    approvalId: uuid('approval_id').notNull(),
    stepIndex: integer('step_index').notNull(),
    /** Очередь участника внутри этапа (последовательный этап идёт по возрастанию) */
    seq: integer('seq').notNull().default(0),
    groupKey: text('group_key').notNull(),
    memberId: uuid('member_id').notNull(),
    positionName: text('position_name'),
    state: text('state', { enum: ['waiting', 'pending', 'done', 'skipped'] }).notNull().default('waiting'),
    decision: text('decision', { enum: ['approve', 'reject', 'comment'] }),
    comment: text('comment').notNull().default(''),
    /** Комментарии без решения («comment»): [{ text, at }] */
    notes: jsonb('notes').$type<{ text: string; at: string }[]>().notNull().default(sql`'[]'::jsonb`),
    decidedAt: ts('decided_at'),
    dueAt: ts('due_at'),
    overdueNotifiedAt: ts('overdue_notified_at'),
    createdAt: createdAt(),
  },
  t => [
    foreignKey({ columns: [t.workspaceId, t.approvalId], foreignColumns: [approvals.workspaceId, approvals.id], name: 'approval_tasks_approval_fk' }).onDelete('cascade'),
    foreignKey({ columns: [t.workspaceId, t.memberId], foreignColumns: [members.workspaceId, members.id], name: 'approval_tasks_member_fk' }).onDelete('cascade'),
    check('approval_tasks_state_chk', sql`${t.state} in ('waiting','pending','done','skipped')`),
    check('approval_tasks_decision_chk', sql`${t.decision} is null or ${t.decision} in ('approve','reject','comment')`),
    index('approval_tasks_approval_idx').on(t.workspaceId, t.approvalId),
    index('approval_tasks_member_idx').on(t.workspaceId, t.memberId, t.state),
    index('approval_tasks_due_idx').on(t.dueAt).where(sql`${t.state} = 'pending' and ${t.overdueNotifiedAt} is null`),
  ],
);
