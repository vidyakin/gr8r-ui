/* Воронки продаж на клиенте (задача 1176, docs/architecture/pipelines.md): воронки, этапы, причины проигрыша, история этапов сделки,
   отчёт-воронка. Ключи кэша ['ws', id, 'pipelines', …]: события deal / deal_pipeline / deal_stage / deal_lost_reason обновляют их (data/realtime.ts). */
import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { missingRequiredFields, type DealStageCategory } from '@gr8r/shared';
import { toast } from '@/components/ui';
import { errorMessage } from '../data/api';
import { call, useWsId } from '../meta/data';
import { colorVar, type StageDef } from './stages';
import type { Deal } from './types';

export interface DealPipeline {
  id: string;
  name: string;
  sortOrder: number;
  isDefault: boolean;
}

export interface DealStageRow {
  id: string;
  pipelineId: string;
  name: string;
  color: string;
  sortOrder: number;
  category: DealStageCategory;
  probability: number;
  requiredFields: string[];
  slaDays: number | null;
}

export interface DealLostReason {
  id: string;
  name: string;
  sortOrder: number;
}

export interface PipelinesData {
  pipelines: DealPipeline[];
  stages: DealStageRow[];
  reasons: DealLostReason[];
}

export interface StageHistoryRow {
  id: string;
  dealId: string;
  fromPipelineId: string | null;
  fromStageId: string | null;
  toPipelineId: string;
  toStageId: string;
  memberId: string | null;
  createdAt: string;
}

export interface FunnelRow {
  stageId: string;
  name: string;
  color: string;
  category: DealStageCategory;
  probability: number;
  count: number;
  amount: string;
  reached: number;
  conversion: number | null;
  avgDays: number | null;
  weighted: string;
}
export interface FunnelReport {
  pipelineId: string;
  from: string;
  to: string;
  rows: FunnelRow[];
  totals: { deals: number; open: number; won: number; lost: number; amount: string; weighted: string };
}

export const pipelinesKey = (ws: string, ...rest: unknown[]) => ['ws', ws, 'pipelines', ...rest] as const;

async function loadPipelines(ws: string): Promise<PipelinesData> {
  const [p, s, r] = await Promise.all([
    call<{ items: DealPipeline[] }>(ws, 'GET', '/deal-pipelines?limit=200'),
    call<{ items: DealStageRow[] }>(ws, 'GET', '/deal-stages?limit=200&sort=sortOrder'),
    call<{ items: DealLostReason[] }>(ws, 'GET', '/deal-lost-reasons?limit=200&sort=sortOrder'),
  ]);
  return { pipelines: p.items, stages: s.items, reasons: r.items };
}

export function usePipelines() {
  const ws = useWsId();
  return useQuery({ queryKey: pipelinesKey(ws, 'all'), queryFn: () => loadPipelines(ws), staleTime: Infinity });
}

export function useStageHistory(dealId: string | null) {
  const ws = useWsId();
  return useQuery({
    queryKey: pipelinesKey(ws, 'history', dealId),
    enabled: !!dealId,
    queryFn: async () => (await call<{ items: StageHistoryRow[] }>(ws, 'GET', `/deals/${dealId}/stage-history`)).items,
    staleTime: Infinity,
  });
}

export function useFunnel(pipelineId: string | null, from: string, to: string) {
  const ws = useWsId();
  return useQuery({
    queryKey: pipelinesKey(ws, 'funnel', pipelineId, from, to),
    enabled: !!pipelineId,
    queryFn: () => call<FunnelReport>(ws, 'GET', `/deal-funnel?pipelineId=${pipelineId}&from=${from}&to=${to}`),
    staleTime: Infinity,
  });
}

/** Вызов API воронок: тост при ошибке, null при ошибке; кэш обновляется и по событиям realtime */
export function usePipelinesApi() {
  const ws = useWsId();
  const qc = useQueryClient();
  return React.useCallback(
    async <T,>(method: string, path: string, json?: unknown): Promise<T | null> => {
      try {
        const r = await call<T>(ws, method, path, json);
        void qc.invalidateQueries({ queryKey: pipelinesKey(ws) });
        return r;
      } catch (e) {
        toast.error(errorMessage(e));
        return null;
      }
    },
    [ws, qc],
  );
}

/** Строки сервера → этапы интерфейса */
export function stageDefs(stages: DealStageRow[]): StageDef[] {
  return stages.map(s => ({ id: s.id, pipelineId: s.pipelineId, name: s.name, p: s.probability / 100, c: colorVar(s.color), category: s.category, sort: s.sortOrder, slaDays: s.slaDays, required: s.requiredFields }));
}

/** Какие обязательные поля этапа у сделки не заполнены (та же функция, что на сервере) */
export function missingFor(deal: Deal, required: string[]): string[] {
  return missingRequiredFields(required, { amount: String(deal.amount), closeDate: deal.closeDate || null, contactCount: deal.contacts.length, sourceId: deal.sourceId ?? null, custom: deal.custom ?? {} });
}

/** Норматив этапа превышен (по времени входа в этап и нормативу этапа, дней) */
export function dealOverdue(deal: Deal, slaDays: number | null, category: DealStageCategory): boolean {
  if (slaDays == null || category !== 'in_progress' || !deal.stageEnteredAt) return false;
  return Date.now() - deal.stageEnteredAt > slaDays * 86_400_000;
}
