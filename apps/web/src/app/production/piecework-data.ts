/* Операции, исполнители и сдельные наряды на клиенте: журнал нарядов, отчёт выработки, справочник операций
   с историей расценок и назначения операций исполнителям в заказе на производство. */
import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DocumentStatus } from '@gr8r/shared';
import { toast } from '@/components/ui';
import { errorMessage } from '../data/api';
import { call, useWsId } from '../meta/data';

export interface PieceworkOrderItem {
  id: string;
  number: string | null;
  date: string;
  status: DocumentStatus;
  comment: string;
  /** Исполнитель */
  memberId: string;
  memberName: string;
  /** Сумма наряда (скрыта от участника без права видеть стоимость) */
  amount: string | null;
  total: string | null;
  qty: string;
  lineCount: number;
}

export interface PieceworkLine {
  id: string;
  operationId: string;
  operationName: string;
  operationSku: string;
  qty: string;
  planQty: string;
  hours: string;
  rate: string | null;
  amount: string | null;
  orderNumber: string | null;
  releaseNumber: string | null;
  releaseDocumentId: string | null;
  assignmentId: string | null;
}

export interface PieceworkOrder extends PieceworkOrderItem {
  member: { id: string; name: string } | null;
  workCenter: { id: string; name: string } | null;
  lines: PieceworkLine[];
}

export interface OperationRate {
  id: string;
  productId: string;
  validFrom: string;
  rate: string;
  unit: 'per_unit' | 'per_hour';
  name?: string;
}

export interface OperationRow {
  productId: string;
  name: string;
  sku: string;
  unitCode: string;
  archived: boolean;
  /** Норма времени на единицу */
  normHours: string;
  workCenterId: string | null;
  rates: { id: string; validFrom: string; rate: string; unit: 'per_unit' | 'per_hour' }[];
}

export interface AssignmentRow {
  id: string;
  componentId: string;
  itemId: string;
  operationId: string | null;
  operationName: string;
  memberId: string;
  memberName: string;
  taskId: string | null;
  taskKey: string | null;
  taskStatus: string | null;
  plannedQty: string;
  plannedHours: string;
  doneQty: string;
  /** В черновиках нарядов (ещё не проведено) */
  draftQty: string;
  leftQty: string;
}

export const pieceworkKey = (ws: string, ...rest: unknown[]) => ['ws', ws, 'piecework', ...rest] as const;

export function usePieceworkOrders(params: { from?: string; to?: string; memberId?: string } = {}) {
  const ws = useWsId();
  return useQuery({
    queryKey: pieceworkKey(ws, 'orders', params),
    queryFn: () => {
      const sp = new URLSearchParams({ limit: '200' });
      if (params.from) sp.set('from', params.from);
      if (params.to) sp.set('to', params.to);
      if (params.memberId) sp.set('memberId', params.memberId);
      return call<{ items: PieceworkOrderItem[]; total: number }>(ws, 'GET', `/production/piecework?${sp}`);
    },
    staleTime: 30_000,
    placeholderData: prev => prev,
  });
}

export function usePieceworkOrder(id: string | undefined) {
  const ws = useWsId();
  return useQuery({ queryKey: pieceworkKey(ws, 'order', id), queryFn: () => call<PieceworkOrder>(ws, 'GET', `/production/piecework/${id}`), enabled: !!id, staleTime: 30_000 });
}

/** Выработка исполнителей за период */
export function usePieceworkReport(params: { from?: string; to?: string } = {}) {
  const ws = useWsId();
  return useQuery({
    queryKey: pieceworkKey(ws, 'report', params),
    queryFn: () => {
      const sp = new URLSearchParams();
      if (params.from) sp.set('from', params.from);
      if (params.to) sp.set('to', params.to);
      return call<{ items: { memberId: string; memberName: string; operationId: string; operationName: string; qty: string; hours: string; amount: string | null }[] }>(ws, 'GET', `/production/piecework/report?${sp}`);
    },
    staleTime: 30_000,
  });
}

/** Справочник операций: норма времени, участок по умолчанию и история расценок */
export function useOperations() {
  const ws = useWsId();
  return useQuery({ queryKey: pieceworkKey(ws, 'operations'), queryFn: () => call<{ items: OperationRow[] }>(ws, 'GET', '/production/operations'), staleTime: 60_000 });
}

/** История расценок операций */
export function useOperationRates(productId?: string) {
  const ws = useWsId();
  return useQuery({
    queryKey: pieceworkKey(ws, 'rates', productId ?? 'all'),
    queryFn: () => call<{ items: OperationRate[] }>(ws, 'GET', `/production/operation-rates${productId ? `?productId=${productId}` : ''}`),
    staleTime: 60_000,
  });
}

/** Назначения операций заказа на производство */
export function useOrderOperations(orderId: string | undefined) {
  const ws = useWsId();
  return useQuery({ queryKey: pieceworkKey(ws, 'order-operations', orderId), queryFn: () => call<{ items: AssignmentRow[] }>(ws, 'GET', `/production-orders/${orderId}/operations`), enabled: !!orderId, staleTime: 30_000 });
}

/** Одно назначение операции (для карточки задачи) */
export function useOperation(id: string | undefined) {
  const ws = useWsId();
  return useQuery({ queryKey: pieceworkKey(ws, 'operation', id), queryFn: () => call<AssignmentRow>(ws, 'GET', `/production/operations/${id}`), enabled: !!id, staleTime: 30_000 });
}

/** Действия: назначения, отметка выполнения, расценки */
export function usePieceworkApi() {
  const ws = useWsId();
  const qc = useQueryClient();
  const settle = () => {
    void qc.invalidateQueries({ queryKey: pieceworkKey(ws) });
    void qc.invalidateQueries({ queryKey: ['ws', ws, 'production-orders'] });
    void qc.invalidateQueries({ queryKey: ['ws', ws, 'docs'] });
    void qc.invalidateQueries({ queryKey: ['ws', ws, 'tasks'] });
  };
  const run = React.useCallback(
    async <T,>(method: string, path: string, json?: unknown): Promise<T | null> => {
      try {
        const r = await call<T>(ws, method, path, json);
        settle();
        return r;
      } catch (e) {
        toast.error(errorMessage(e));
        return null;
      }
    },
    [ws, settle],
  );
  const assign = useMutation({
    mutationFn: (v: { orderId: string; assignments: { componentId: string; memberId: string; qty: string }[] }) => call(ws, 'POST', `/production-orders/${v.orderId}/operations`, { assignments: v.assignments }),
    onSuccess: () => {
      toast('Executors saved');
      settle();
    },
    onError: e => toast.error(errorMessage(e)),
  });
  const markDone = useMutation({
    mutationFn: (v: { assignmentId: string; qty: string }) => call(ws, 'POST', `/production/operations/${v.assignmentId}/done`, { qty: v.qty }),
    onSuccess: () => {
      toast('The work is marked as done');
      settle();
    },
    onError: e => toast.error(errorMessage(e)),
  });
  const addRate = useMutation({
    mutationFn: (v: { productId: string; validFrom: string; rate: string; unit: 'per_unit' | 'per_hour' }) => call(ws, 'POST', '/production/operation-rates', v),
    onSuccess: () => {
      toast('The rate is added');
      settle();
    },
    onError: e => toast.error(errorMessage(e)),
  });
  const setSpec = useMutation({
    mutationFn: (v: { productId: string; normHours: string; workCenterId: string | null }) => call(ws, 'PUT', `/production/operations/${v.productId}`, v),
    onSuccess: settle,
    onError: e => toast.error(errorMessage(e)),
  });
  return { run, assign, markDone, addRate, setSpec };
}
