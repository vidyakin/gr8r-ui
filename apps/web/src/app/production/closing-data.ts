/* Закрытие периода и прочие затраты на клиенте: журнал закрытых месяцев, предварительный анализ, запуск и отмена
   закрытия, настройки даты запрета и документы «Прочие затраты». */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { COST_DISTRIBUTION_LABELS, type CostDistribution, type DocumentStatus } from '@gr8r/shared';
import { toast } from '@/components/ui';
import { errorMessage } from '../data/api';
import { call, useWsId } from '../meta/data';

/* ---------------- закрытие периода ---------------- */

export interface ClosingTotals {
  month: string;
  byCostItem: { costItemId: string; costItemName: string; workCenterId: string | null; workCenterName: string | null; method: CostDistribution; amount: string | null; distributed: string | null; scope: string }[];
  byRelease: { itemId: string; releaseId: string; name: string; workCenterId: string | null; workCenterName: string | null; qty: string; directCost: string | null; workHours: string; allocated: string | null }[];
  undistributed: string | null;
  warnings: string[];
  total: string | null;
  adjustedMoves: number;
  runAt: string;
}

export interface Closing {
  id: string;
  period: string;
  month: string;
  label: string;
  status: 'running' | 'done' | 'reopened' | 'failed';
  error: string | null;
  runAt: string;
  totals: ClosingTotals;
}

export interface PeriodLock {
  closedThrough: string | null;
  closeMovesLock: boolean;
}

export interface PeriodList {
  items: Closing[];
  closedThrough: string | null;
  closeMovesLock: boolean;
}

export interface PeriodIssue {
  kind: 'negative_stock' | 'unposted' | 'no_release';
  message: string;
  links: { documentId?: string; number?: string | null; date?: string; warehouseId?: string; productId?: string; name?: string; qty?: string }[];
}

export interface PeriodPreview {
  month: string;
  costs: { costItemId: string; name: string; method: CostDistribution; workCenterId: string | null; workCenterName: string | null; amount: string | null }[];
  targets: { itemId: string; releaseId: string; name: string; workCenterId: string | null; workCenterName: string | null; qty: string; directCost: string | null; workHours: string }[];
  issues: PeriodIssue[];
  total: string | null;
}

export const closingKey = (ws: string, ...rest: unknown[]) => ['ws', ws, 'periods', ...rest] as const;

/** Журнал закрытых месяцев и настройки даты запрета */
export function usePeriods() {
  const ws = useWsId();
  return useQuery({ queryKey: closingKey(ws), queryFn: () => call<PeriodList>(ws, 'GET', '/production/periods') });
}

/** Предварительный анализ месяца: косвенные затраты, выпуски и проблемы */
export function usePeriodPreview(month: string) {
  const ws = useWsId();
  return useQuery({ queryKey: closingKey(ws, 'preview', month), queryFn: () => call<PeriodPreview>(ws, 'GET', `/production/periods/${month}/preview`), enabled: !!month });
}

/** Закрыть месяц или период «за период» — месяцы выполняются последовательно */
export function useClosePeriod() {
  const ws = useWsId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ month, through, reopen }: { month: string; through?: string; reopen?: boolean }) => call<{ months: string[] }>(ws, 'POST', `/production/periods/${month}/${reopen ? 'reopen' : 'close'}`, through ? { through } : {}),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: closingKey(ws) });
    },
  });
}

/** Дата запрета и настройка её переноса при закрытии */
export function usePeriodSettings() {
  const ws = useWsId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { closedThrough?: string | null; closeMovesLock?: boolean }) => call<PeriodLock & { reopened: string[] }>(ws, 'PATCH', '/production/periods/settings', body),
    onSuccess: async r => {
      // сдвиг даты запрета назад снимает закрытия месяцев после неё — сообщаем, какие
      if (r.reopened.length) toast(`Closings reopened: ${r.reopened.join(', ')}`);
      await qc.invalidateQueries({ queryKey: closingKey(ws) });
    },
    onError: e => {
      throw new Error(errorMessage(e));
    },
  });
}

/* ---------------- прочие затраты ---------------- */

export interface OtherCostLine {
  id: string;
  sortOrder: number;
  costItemId: string;
  costItemName: string;
  workCenterId: string | null;
  workCenterName: string | null;
  amount: string | null;
  comment: string;
}

export interface OtherCostsDetail {
  id: string;
  number: string | null;
  date: string;
  status: DocumentStatus;
  organizationId: string;
  organizationName: string | null;
  investmentProjectId: string | null;
  investmentProject?: { id: string; name: string } | null;
  comment: string;
  total: string | null;
  lines: OtherCostLine[];
}

export interface OtherCostsListItem {
  id: string;
  number: string | null;
  date: string;
  status: DocumentStatus;
  comment: string;
  total: string;
  lineCount: number;
}

export const otherCostsKey = (ws: string, ...rest: unknown[]) => ['ws', ws, 'other-costs', ...rest] as const;

export function useOtherCosts(params: { q?: string } = {}) {
  const ws = useWsId();
  const sp = new URLSearchParams({ limit: '200' });
  if (params.q) sp.set('q', params.q);
  return useQuery({ queryKey: otherCostsKey(ws, params.q ?? ''), queryFn: () => call<{ items: OtherCostsListItem[]; total: number; amount: string | null }>(ws, 'GET', `/other-costs?${sp}`) });
}

export function useOtherCostsDocument(id: string | undefined) {
  const ws = useWsId();
  return useQuery({ queryKey: otherCostsKey(ws, 'doc', id ?? ''), queryFn: () => call<OtherCostsDetail>(ws, 'GET', `/other-costs/${id}`), enabled: !!id });
}

export interface OtherCostsLineInput {
  id: string;
  costItemId: string;
  workCenterId: string | null;
  amount: string;
  comment: string;
}

export function useOtherCostsApi() {
  const ws = useWsId();
  const qc = useQueryClient();
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: otherCostsKey(ws) });
  };
  return {
    save: async (body: { id?: string; date?: string; investmentProjectId?: string | null; comment?: string; lines: OtherCostsLineInput[] }) => {
      const r = await call<OtherCostsDetail>(ws, 'POST', '/other-costs', body);
      await refresh();
      return r;
    },
    update: async (id: string, body: { date?: string; investmentProjectId?: string | null; comment?: string; lines?: OtherCostsLineInput[] }) => {
      const r = await call<OtherCostsDetail>(ws, 'PATCH', `/other-costs/${id}`, body);
      await refresh();
      return r;
    },
    post: async (id: string) => {
      const r = await call<OtherCostsDetail>(ws, 'POST', `/other-costs/${id}/post`);
      await refresh();
      return r;
    },
    unpost: async (id: string) => {
      const r = await call<OtherCostsDetail>(ws, 'POST', `/other-costs/${id}/unpost`);
      await refresh();
      return r;
    },
    remove: async (id: string) => {
      await call(ws, 'DELETE', `/other-costs/${id}`);
      await refresh();
    },
  };
}

export const distributionLabel = (m: CostDistribution) => COST_DISTRIBUTION_LABELS[m] ?? m;