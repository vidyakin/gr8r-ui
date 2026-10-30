/* Автоматизации на клиенте: flow и журнал запусков живут в кэше TanStack Query под ['ws', id, 'automations', …].
   Realtime (data/realtime.ts) сбрасывает кэш по событиям flow / flow_run, поэтому журнал обновляется без перезагрузки. */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { FlowGraph, FlowRunStatus, FlowStepStatus } from '@gr8r/shared';
import { toast } from '@/components/ui';
import { errorMessage } from '../data/api';
import { call, useWsId } from '../meta/data';

export interface RunSummary {
  id: string;
  flowId: string;
  status: FlowRunStatus;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface FlowSummary {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  publishedVersion: number | null;
  publishedAt: string | null;
  hasDraftChanges: boolean;
  nodeCount: number;
  trigger: { type: string; params: Record<string, unknown> } | null;
  lastRun: RunSummary | null;
  failedRuns7d: number;
  createdAt: string;
  updatedAt: string;
}

export interface FlowDetail {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  graph: FlowGraph;
  publishedGraph: FlowGraph | null;
  publishedVersion: number | null;
  hasDraftChanges: boolean;
  updatedAt: string;
}

export interface RunRow {
  id: string;
  flowId: string;
  flowName: string;
  version: number;
  status: FlowRunStatus;
  triggerKind: 'event' | 'schedule' | 'manual';
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  stepCount: number;
}

export interface StepRow {
  id: string;
  seq: number;
  nodeId: string;
  nodeType: string;
  status: FlowStepStatus;
  attempt: number;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface RunDetail extends Omit<RunRow, 'stepCount'> {
  trigger: Record<string, unknown>;
  steps: StepRow[];
}

const base = (ws: string) => ['ws', ws, 'automations'] as const;
const LIVE: FlowRunStatus[] = ['queued', 'running', 'waiting'];

export function useFlows() {
  const ws = useWsId();
  return useQuery({
    queryKey: [...base(ws), 'flows'],
    queryFn: async () => (await call<{ items: FlowSummary[] }>(ws, 'GET', '/flows?limit=200')).items,
    staleTime: Infinity,
  });
}

export function useFlow(id: string | undefined) {
  const ws = useWsId();
  return useQuery({
    queryKey: [...base(ws), 'flow', id],
    queryFn: () => call<FlowDetail>(ws, 'GET', `/flows/${id}`),
    enabled: !!id,
    staleTime: Infinity,
  });
}

export function useRuns(opts: { flowId?: string; failed?: boolean } = {}) {
  const ws = useWsId();
  return useQuery({
    queryKey: [...base(ws), 'runs', opts],
    queryFn: async () => {
      const sp = new URLSearchParams({ limit: '100' });
      if (opts.flowId) sp.set('flowId', opts.flowId);
      if (opts.failed) sp.set('failed', 'true');
      return call<{ items: RunRow[]; total: number }>(ws, 'GET', `/flow-runs?${sp}`);
    },
    staleTime: Infinity,
    // Пока есть незавершённые запуски — подстраховка к realtime
    refetchInterval: q => (q.state.data?.items.some(r => LIVE.includes(r.status)) ? 4000 : false),
  });
}

export function useRun(id: string | undefined, enabled = true) {
  const ws = useWsId();
  return useQuery({
    queryKey: [...base(ws), 'run', id],
    queryFn: () => call<RunDetail>(ws, 'GET', `/flow-runs/${id}`),
    enabled: !!id && enabled,
    staleTime: Infinity,
    refetchInterval: q => (q.state.data && LIVE.includes(q.state.data.status) ? 3000 : false),
  });
}

/** Мутации flow: после успеха кэш автоматизаций сбрасывается, ошибка сервера показывается тостом и пробрасывается дальше */
export function useFlowApi() {
  const ws = useWsId();
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: base(ws) });
  const run = <T>(fn: () => Promise<T>, quiet = false) =>
    fn().then(
      async r => {
        await done();
        return r;
      },
      (e: unknown) => {
        if (!quiet) toast.error(errorMessage(e));
        throw e;
      },
    );
  return {
    create: (body: { name: string; description?: string; graph?: FlowGraph }) => run(() => call<FlowDetail>(ws, 'POST', '/flows', body)),
    save: (id: string, body: { name?: string; description?: string; graph?: FlowGraph; enabled?: boolean }) => run(() => call<FlowDetail>(ws, 'PATCH', `/flows/${id}`, body)),
    publish: (id: string, enable?: boolean) => run(() => call<FlowDetail>(ws, 'POST', `/flows/${id}/publish`, enable === undefined ? {} : { enable }), true),
    remove: (id: string) => run(() => call<{ id: string }>(ws, 'DELETE', `/flows/${id}`)),
    runNow: (id: string, body: { entity?: string; recordId?: string } = {}) => run(() => call<{ runId: string }>(ws, 'POST', `/flows/${id}/run`, body)),
  };
}
