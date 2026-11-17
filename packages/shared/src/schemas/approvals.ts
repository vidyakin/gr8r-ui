/* zod-схемы согласования по маршрутам (задача 1199, docs/architecture/approvals.md). */
import { z } from 'zod';
import { APPROVAL_BOXES, APPROVAL_DECISIONS, APPROVAL_STATES, APPROVAL_STEP_MODES, APPROVAL_TARGET_KINDS } from '../approvals';
import { decimal, toPatch, uuid } from './common';

const participant = z
  .object({ memberId: uuid.nullish(), positionId: uuid.nullish() })
  .refine(p => !!p.memberId !== !!p.positionId, 'A participant is either a member or a position');

const step = z.object({
  name: z.string().trim().max(120).default(''),
  mode: z.enum(APPROVAL_STEP_MODES).default('sequential'),
  /** Срок решения в часах от активации задачи; пусто — без срока */
  dueHours: z.number().int().min(1).max(8760).nullish(),
  participants: z.array(participant).min(1).max(50),
});

/** Маршрут: условие (вид объекта, тип документа, организация, сумма от/до), обязательность и этапы */
export const approvalRouteCreate = z
  .object({
    name: z.string().trim().min(1).max(200),
    targetKind: z.enum(APPROVAL_TARGET_KINDS).default('document'),
    /** Только для документов; пусто — любой тип */
    documentType: z.string().trim().min(1).max(60).nullish(),
    organizationId: uuid.nullish(),
    amountFrom: decimal.nullish(),
    amountTo: decimal.nullish(),
    required: z.boolean().default(true),
    sortOrder: z.number().int().min(0).max(1_000_000).default(0),
    steps: z.array(step).min(1).max(20),
  })
  .refine(r => r.amountFrom == null || r.amountTo == null || Number(r.amountTo) >= Number(r.amountFrom), { message: 'amountTo must not be less than amountFrom', path: ['amountTo'] });
// PATCH: непришедшее поле не меняется, null очищает; этапы, если пришли, заменяются целиком
export const approvalRouteUpdate = toPatch(approvalRouteCreate);

export const approvalRouteQuery = z.object({ archived: z.enum(['true', 'false']).default('false') });

/** Отправка на согласование: ровно один из documentId / contractId */
export const approvalStart = z
  .object({ targetKind: z.enum(APPROVAL_TARGET_KINDS), documentId: uuid.optional(), contractId: uuid.optional() })
  .refine(b => (b.targetKind === 'document' ? !!b.documentId && !b.contractId : !!b.contractId && !b.documentId), 'Pass documentId for a document or contractId for a contract');

export const approvalQuery = z.object({
  box: z.enum(APPROVAL_BOXES).default('mine'),
  state: z.enum(APPROVAL_STATES).optional(),
  targetKind: z.enum(APPROVAL_TARGET_KINDS).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const approvalByObjectQuery = z
  .object({ targetKind: z.enum(APPROVAL_TARGET_KINDS), documentId: uuid.optional(), contractId: uuid.optional() })
  .refine(b => (b.targetKind === 'document' ? !!b.documentId : !!b.contractId), 'Pass documentId for a document or contractId for a contract');

export const approvalDecide = z.object({ decision: z.enum(APPROVAL_DECISIONS), comment: z.string().trim().max(4000).default('') });

export const approvalCancel = z.object({ reason: z.string().trim().max(500).default('') });

export type ApprovalRouteCreate = z.infer<typeof approvalRouteCreate>;
export type ApprovalStartBody = z.infer<typeof approvalStart>;
export type ApprovalDecideBody = z.infer<typeof approvalDecide>;
