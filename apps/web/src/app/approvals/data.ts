/* Согласование по маршрутам на клиенте (задача 1199, docs/architecture/approvals.md). Ключи кэша ['ws', id, 'approvals', …]:
   события approval и approval_route обновляют их (realtime.ts). Решения и отправка заодно перечитывают документы и договоры. */
import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import type { ApprovalBox, ApprovalDecision, ApprovalState, ApprovalStepMode, ApprovalTargetKind, ApprovalTaskState } from '@erp/shared';
import { toast } from '@/components/ui';
import { errorMessage } from '../data/api';
import { call, useWsId } from '../meta/data';

export interface RouteParticipant {
  id: string;
  memberId: string | null;
  positionId: string | null;
}
export interface RouteStep {
  id: string;
  name: string;
  mode: ApprovalStepMode;
  dueHours: number | null;
  participants: RouteParticipant[];
}
export interface ApprovalRoute {
  id: string;
  name: string;
  targetKind: ApprovalTargetKind;
  documentType: string | null;
  organizationId: string | null;
  amountFrom: string | null;
  amountTo: string | null;
  required: boolean;
  sortOrder: number;
  archivedAt: string | null;
  steps: RouteStep[];
}

export interface ApprovalTaskView {
  id: string;
  stepIndex: number;
  seq: number;
  groupKey: string;
  memberId: string;
  memberName: string;
  positionName: string | null;
  state: ApprovalTaskState;
  decision: ApprovalDecision | null;
  comment: string;
  notes: { text: string; at: string }[];
  decidedAt: string | null;
  dueAt: string | null;
  overdueHours: number;
}
export interface ApprovalSnapshotStepView {
  name: string;
  mode: ApprovalStepMode;
  dueHours: number | null;
}
export interface ApprovalView {
  id: string;
  targetKind: ApprovalTargetKind;
  documentId: string | null;
  contractId: string | null;
  objectLabel: string;
  documentType: string | null;
  routeName: string;
  round: number;
  state: ApprovalState;
  currentStep: number;
  currentStepName: string;
  snapshot: { steps: ApprovalSnapshotStepView[] };
  authorId: string | null;
  authorName: string | null;
  startedAt: string;
  finishedAt: string | null;
  cancelReason: string | null;
  changedSinceSubmit: boolean;
  tasks: ApprovalTaskView[];
}
export type ApprovalGate = 'not_required' | 'required' | 'in_progress' | 'approved' | 'outdated';
export interface ApprovalOfObject {
  enabled: boolean;
  gate: ApprovalGate;
  route: { id: string; name: string; required: boolean } | null;
  canStart: boolean;
  current: ApprovalView | null;
  rounds: ApprovalView[];
}
export interface ApprovalListItem {
  id: string;
  targetKind: ApprovalTargetKind;
  documentId: string | null;
  contractId: string | null;
  documentType: string | null;
  number: string | null;
  date: string | null;
  total: string | null;
  counterpartyName: string | null;
  routeName: string;
  round: number;
  state: ApprovalState;
  currentStep: number;
  currentStepName: string;
  stepCount: number;
  authorName: string | null;
  startedAt: string;
  finishedAt: string | null;
  myTaskId: string | null;
  overdueHours: number;
}

export const approvalsKey = (ws: string, ...rest: unknown[]) => ['ws', ws, 'approvals', ...rest] as const;

export function useApprovalRoutes(archived: boolean) {
  const ws = useWsId();
  return useQuery({ queryKey: approvalsKey(ws, 'routes', archived), queryFn: async () => (await call<{ items: ApprovalRoute[] }>(ws, 'GET', `/approval-routes?archived=${archived}`)).items });
}

export function useApprovalList(box: ApprovalBox) {
  const ws = useWsId();
  return useQuery({ queryKey: approvalsKey(ws, 'list', box), queryFn: () => call<{ total: number; items: ApprovalListItem[] }>(ws, 'GET', `/approvals?box=${box}&limit=200`) });
}

/** Открыть объект согласования по id процесса (уведомление типа approval) */
export function useOpenApproval() {
  const ws = useWsId();
  const navigate = useNavigate();
  return React.useCallback(
    async (id: string) => {
      try {
        navigate(approvalObjectPath(await call<ApprovalView>(ws, 'GET', `/approvals/${id}`)));
      } catch (e) {
        toast.error(errorMessage(e));
      }
    },
    [ws, navigate],
  );
}

export function useApprovalOfObject(kind: ApprovalTargetKind, id: string | undefined) {
  const ws = useWsId();
  return useQuery({
    queryKey: approvalsKey(ws, 'object', kind, id),
    enabled: !!id,
    queryFn: () => call<ApprovalOfObject>(ws, 'GET', `/approvals/by-object?targetKind=${kind}&${kind === 'document' ? 'documentId' : 'contractId'}=${id}`),
  });
}

/** Адрес объекта согласования: документ, заявка на расход или договор (открывается из уведомления и списка) */
export function approvalObjectPath(a: { targetKind: ApprovalTargetKind; documentId: string | null; contractId: string | null; documentType?: string | null }): string {
  if (a.targetKind === 'contract') return `/contracts?open=${a.contractId}`;
  return a.documentType === 'payment_request' ? `/money/requests/${a.documentId}` : `/documents/${a.documentId}`;
}

/** Вызов API согласований с обновлением кэша и тостом об ошибке; null при ошибке */
export function useApprovalsApi() {
  const ws = useWsId();
  const qc = useQueryClient();
  return React.useCallback(
    async <T,>(method: string, path: string, json?: unknown): Promise<T | null> => {
      try {
        const r = await call<T>(ws, method, path, json);
        // решение меняет состояние заявки на расход, документа и договора, а также список уведомлений
        for (const k of ['approvals', 'docs', 'money', 'billing']) void qc.invalidateQueries({ queryKey: ['ws', ws, k] });
        return r;
      } catch (e) {
        toast.error(errorMessage(e));
        return null;
      }
    },
    [ws, qc],
  );
}
