/* План производства на клиенте: журнал планов, карточка с периодами в колонках, потребности, заполнение,
   полуфабрикаты и рабочее место «Заказы по плану». Данные лежат в кэше TanStack Query под ключом ['ws', id, 'production-plans', …]. */
import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { NeedsMethod, PlanStatus, PlanStep, StockReplenishment } from '@gr8r/shared';
import { toast } from '@/components/ui';
import { errorMessage } from '../data/api';
import { call, useWsId } from '../meta/data';
import { uuidv7 } from '../lib/uuid';

export interface PlanListItem {
  id: string;
  name: string;
  periodFrom: string;
  periodTo: string;
  step: PlanStep;
  status: PlanStatus;
  warehouseId: string;
  warehouseName: string;
  workCenterId: string | null;
  semiDirty: boolean;
  comment: string;
  lineCount: number;
  totalQty: string;
}

export interface PlanLine {
  id: string;
  itemId: string;
  itemName: string;
  itemCode: string;
  productId: string | null;
  unitCode: string;
  periodStart: string;
  qty: string;
  isSemi: boolean;
  startDate: string;
  ordered: string;
  produced: string;
}

export interface PlanDetail extends PlanListItem {
  workCenterName: string | null;
  periods: string[];
  lines: PlanLine[];
}

export interface PlanNeeds {
  periods: string[];
  materials: { productId: string; name: string; qty: string }[];
  semis: { itemId: string; name: string; consumed: string; produced: string; balance: string; status: 'surplus' | 'deficit' }[];
  load: { period: string; workCenterId: string | null; workCenterName: string; hours: string; capacity: string; shortage: string }[];
  labor: { workCenterId: string | null; workCenterName: string; hours: string; amount: string | null }[];
}

export const planKey = (ws: string, ...rest: unknown[]) => ['ws', ws, 'production-plans', ...rest] as const;

export function useProductionPlans(params: { status?: string; q?: string } = {}) {
  const ws = useWsId();
  return useQuery({
    queryKey: planKey(ws, 'list', params),
    queryFn: () => {
      const sp = new URLSearchParams({ limit: '200' });
      if (params.status) sp.set('status', params.status);
      if (params.q) sp.set('q', params.q);
      return call<{ items: PlanListItem[]; total: number }>(ws, 'GET', `/production-plans?${sp}`);
    },
    staleTime: Infinity,
    placeholderData: prev => prev,
  });
}

export function useProductionPlan(id: string | undefined) {
  const ws = useWsId();
  return useQuery({ queryKey: planKey(ws, 'plan', id), queryFn: () => call<PlanDetail>(ws, 'GET', `/production-plans/${id}`), enabled: !!id, staleTime: Infinity });
}

export function useProductionPlanNeeds(id: string | undefined) {
  const ws = useWsId();
  return useQuery({ queryKey: planKey(ws, 'needs', id), queryFn: () => call<PlanNeeds>(ws, 'GET', `/production-plans/${id}/needs`), enabled: !!id, staleTime: Infinity });
}

/** Рабочее место «Заказы по плану»: утверждённые планы и остаток строк */
export function usePlanWorkbench(params: { periodStart?: string; workCenterId?: string } = {}) {
  const ws = useWsId();
  return useQuery({
    queryKey: planKey(ws, 'workbench', params),
    queryFn: () => {
      const sp = new URLSearchParams({ limit: '50' });
      if (params.periodStart) sp.set('periodStart', params.periodStart);
      if (params.workCenterId) sp.set('workCenterId', params.workCenterId);
      return call<{ items: { plan: PlanListItem; periods: string[]; lines: (PlanLine & { remainder: string })[] }[] }>(ws, 'GET', `/production-plans/workbench?${sp}`);
    },
    staleTime: Infinity,
    placeholderData: prev => prev,
  });
}

/** Действия над планом: создание, правка, заполнение, полуфабрикаты, заказы по плану */
export function useProductionPlanApi() {
  const ws = useWsId();
  const qc = useQueryClient();
  const settle = () => {
    void qc.invalidateQueries({ queryKey: planKey(ws) });
    void qc.invalidateQueries({ queryKey: ['ws', ws, 'production-orders'] });
    void qc.invalidateQueries({ queryKey: ['ws', ws, 'production-needs'] });
    void qc.invalidateQueries({ queryKey: ['ws', ws, 'docs'] });
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
  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => call<PlanDetail>(ws, 'POST', '/production-plans', { id: uuidv7(), ...body }),
    onError: e => toast.error(errorMessage(e)),
  });
  const update = useMutation({
    mutationFn: (v: { id: string; body: Record<string, unknown> }) => call<PlanDetail>(ws, 'PATCH', `/production-plans/${v.id}`, v.body),
    onError: e => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => call<{ id: string }>(ws, 'DELETE', `/production-plans/${id}`),
    onSuccess: () => {
      toast('The plan is archived');
      settle();
    },
    onError: e => toast.error(errorMessage(e)),
  });
  const fill = useMutation({
    mutationFn: (v: { id: string; source: 'output' | 'sales' | 'customer_orders'; mode: 'replace' | 'add'; periods: number }) => call<PlanDetail>(ws, 'POST', `/production-plans/${v.id}/fill`, { source: v.source, mode: v.mode, periods: v.periods }),
    onSuccess: d => {
      toast(`The plan is filled: ${d.lines.filter(l => !l.isSemi).length} lines`);
      settle();
    },
    onError: e => toast.error(errorMessage(e)),
  });
  const semi = useMutation({
    mutationFn: (id: string) => call<PlanDetail>(ws, 'POST', `/production-plans/${id}/semi`, { itemIds: [] }),
    onSuccess: d => {
      toast(`Semi-finished lines planned: ${d.lines.filter(l => l.isSemi).length}`);
      settle();
    },
    onError: e => toast.error(errorMessage(e)),
  });
  const removeSemi = useMutation({
    mutationFn: (id: string) => call<PlanDetail>(ws, 'POST', `/production-plans/${id}/semi/remove`, {}),
    onSuccess: () => {
      toast('Semi-finished lines are removed');
      settle();
    },
    onError: e => toast.error(errorMessage(e)),
  });
  const orders = useMutation({
    mutationFn: (v: { id: string; periodStart?: string; lineIds: string[]; date?: string; comment?: string }) =>
      call<{ created: { id: string; periodStart: string; qty: string }[]; skipped: { itemName: string; qty: string }[] }>(ws, 'POST', `/production-plans/${v.id}/orders`, { periodStart: v.periodStart ?? null, lineIds: v.lineIds, ...(v.date ? { date: v.date } : {}), comment: v.comment ?? '' }),
    onSuccess: r => {
      toast(`Orders created: ${r.created.length}${r.skipped.length ? ` · ${r.skipped.length} already ordered` : ''}`);
      settle();
    },
    onError: e => toast.error(errorMessage(e)),
  });
  return { run, create, update, remove, fill, semi, removeSemi, orders };
}

/* ---------------- общий расчёт потребностей ---------------- */

export interface NeedsCalcRow {
  productId: string;
  productName: string;
  unitCode: string;
  warehouseId: string | null;
  warehouseName: string | null;
  replenishment: StockReplenishment;
  sourceWarehouseId: string | null;
  balance: string;
  reserved: string;
  minQty: string;
  maxQty: string;
  forecast: { period: string; opening: string; incoming: string; consumption: string; closing: string; order: string }[];
  recommendation: string;
  overdue: string;
  dueDate: string | null;
  avgPerDay: string;
  leadDays: number;
  supplierId: string | null;
  supplierName: string | null;
  price: string | null;
  priceDate: string | null;
  suppliers: { supplierId: string; name: string; price: string | null; date: string | null }[];
  incoming: { date: string; qty: string; source: string; documentId: string | null; label: string | null }[];
  demand: { date: string; qty: string; source: string; documentId: string | null; label: string | null }[];
  customerOrderId: string | null;
  itemId: string | null;
  amount: string | null;
}

export interface NeedsCalculation {
  rows: NeedsCalcRow[];
  periods: string[];
  today: string;
  from: string;
  method: NeedsMethod;
  step: 'day' | 'week' | 'month';
  byWarehouse: boolean;
  safety: { leadDays: number; safetyDays: number; safetyPct: string; historyPeriods: number };
}

export interface NeedsCalcParams {
  replenishment: StockReplenishment | 'all';
  method: NeedsMethod;
  step: 'day' | 'week' | 'month';
  periods: number;
  from?: string;
  byWarehouse: boolean;
  warehouseId?: string;
  source: 'all' | 'orders' | 'plan';
  safetyDays: number;
  safetyPct?: string;
  historyPeriods: number;
}

export const calcKey = (ws: string, ...rest: unknown[]) => ['ws', ws, 'needs-calc', ...rest] as const;

export function useNeedsCalculation(params: NeedsCalcParams, enabled: boolean) {
  const ws = useWsId();
  return useQuery({
    queryKey: calcKey(ws, params),
    queryFn: () => {
      const sp = new URLSearchParams({
        replenishment: params.replenishment,
        method: params.method,
        step: params.step,
        periods: String(params.periods),
        byWarehouse: String(params.byWarehouse),
        source: params.source,
        safetyDays: String(params.safetyDays),
        historyPeriods: String(params.historyPeriods),
      });
      if (params.from) sp.set('from', params.from);
      if (params.warehouseId) sp.set('warehouseId', params.warehouseId);
      if (params.safetyPct !== undefined) sp.set('safetyPct', params.safetyPct);
      return call<NeedsCalculation>(ws, 'GET', `/production/needs/calculate?${sp}`);
    },
    enabled,
    staleTime: Infinity,
    placeholderData: prev => prev,
  });
}

/** Черновики по потребности и массовое проведение */
export function useNeedsDraftsApi() {
  const ws = useWsId();
  const qc = useQueryClient();
  const settle = () => {
    void qc.invalidateQueries({ queryKey: calcKey(ws) });
    void qc.invalidateQueries({ queryKey: ['ws', ws, 'docs'] });
    void qc.invalidateQueries({ queryKey: ['ws', ws, 'production-orders'] });
  };
  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      call<{ orders: { id: string; type: string; number: string | null; supplierId: string | null; date: string; lines: { productId: string; productName: string; qty: string }[] }[]; skipped: { productName: string; qty: string; reason: string }[] }>(ws, 'POST', '/production/needs/orders', body),
    onSuccess: r => {
      toast(`Drafts created: ${r.orders.length}${r.skipped.length ? ` · skipped ${r.skipped.length}` : ''}`);
      settle();
      return r;
    },
    onError: e => toast.error(errorMessage(e)),
  });
  const post = useMutation({
    mutationFn: (documentIds: string[]) => call<{ posted: string[]; failed: { id: string; error: string }[] }>(ws, 'POST', '/production/needs/post', { documentIds }),
    onSuccess: r => {
      toast(`Posted: ${r.posted.length}${r.failed.length ? ` · failed ${r.failed.length}` : ''}`);
      settle();
      return r;
    },
    onError: e => toast.error(errorMessage(e)),
  });
  return { create, post };
}