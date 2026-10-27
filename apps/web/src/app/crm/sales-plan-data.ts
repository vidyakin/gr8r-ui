/* Планирование продаж (задача 1133): типы ответов и запросы /sales-plan/*. Ключи кэша под ['ws', id, 'docs', 'sales-plan', …]:
   события документов, сделок и планов обновляют их вместе с остальными журналами. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PlanFactCell, PlanFactReport, PlanFactRow, SalesPlanDimension } from '@gr8r/shared';
import { call, useWsId } from '../meta/data';
import { docsKey } from '../docs/data';

export type { PlanFactCell, PlanFactReport, PlanFactRow, SalesPlanDimension };
export type Periodicity = 'month' | 'quarter' | 'year';

export interface Scenario {
  id: string;
  name: string;
  periodicity: Periodicity;
  dimension: SalesPlanDimension;
  archivedAt: string | null;
}

export interface PlanLine {
  id?: string;
  periodStart: string;
  memberId: string | null;
  categoryId: string | null;
  productId: string | null;
  amount: string;
  qty: string;
  keyName?: string | null;
}

export interface PlanListItem {
  id: string;
  number: string | null;
  date: string;
  status: 'draft' | 'posted' | 'cancelled';
  comment: string;
  total: string;
  periodStart: string;
  scenarioId: string;
  scenarioName: string;
  periodicity: Periodicity;
  dimension: SalesPlanDimension;
}

export interface PlanDetail {
  id: string;
  number: string | null;
  date: string;
  status: 'draft' | 'posted' | 'cancelled';
  comment: string;
  total: string;
  organizationId: string;
  warehouseId: string | null;
  scenario: { id: string; name: string; periodicity: Periodicity; dimension: SalesPlanDimension };
  periodStart: string;
  periods: string[];
  lines: PlanLine[];
}

export interface PlanInput {
  scenarioId?: string;
  periodStart?: string;
  organizationId?: string | null;
  warehouseId?: string | null;
  comment?: string;
  lines?: { periodStart: string; memberId: string | null; categoryId: string | null; productId: string | null; amount: string; qty: string }[];
}

export interface AnalysisFilter {
  scenarioId: string;
  from: string;
  to: string;
  warehouseId?: string | undefined;
  organizationId?: string | undefined;
}

const key = (ws: string, ...rest: unknown[]) => docsKey(ws, 'sales-plan', ...rest);

export const useScenarios = () => {
  const ws = useWsId();
  return useQuery({ queryKey: key(ws, 'scenarios'), queryFn: async () => (await call<{ items: Scenario[] }>(ws, 'GET', '/sales-plan/scenarios?limit=200')).items });
};

export const usePlans = () => {
  const ws = useWsId();
  return useQuery({ queryKey: key(ws, 'plans'), queryFn: () => call<{ items: PlanListItem[]; total: number }>(ws, 'GET', '/sales-plan/plans?limit=200') });
};

export const usePlan = (id: string | undefined) => {
  const ws = useWsId();
  return useQuery({ queryKey: key(ws, 'plan', id), queryFn: () => call<PlanDetail>(ws, 'GET', `/sales-plan/plans/${id}`), enabled: !!id });
};

export const useAnalysis = (f: AnalysisFilter | null) => {
  const ws = useWsId();
  const qs = f ? new URLSearchParams(Object.entries(f).filter((e): e is [string, string] => !!e[1])).toString() : '';
  return useQuery({ queryKey: key(ws, 'analysis', qs), queryFn: () => call<PlanFactReport>(ws, 'GET', `/sales-plan/analysis?${qs}`), enabled: !!f && !!f.scenarioId && !!f.from && !!f.to });
};

/** Мутации плана и сценариев: путь, метод и тело; после успеха обновляется всё под sales-plan */
export const useSalesPlanMutation = <T,>(method: 'POST' | 'PATCH' | 'DELETE') => {
  const ws = useWsId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: { path: string; body?: unknown }) => call<T>(ws, method, `/sales-plan${a.path}`, a.body),
    onSuccess: () => qc.invalidateQueries({ queryKey: key(ws) }),
  });
};
