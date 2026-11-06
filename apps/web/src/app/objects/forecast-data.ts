/* Прогноз прибыли объекта на клиенте (задача 1275): отчёт по объекту, исполнители и портфель объектов.
   Запросы живут под ['ws', id, 'objects', …] — событие object_forecast.* (и любые события объекта, смет,
   документов и смен) сбрасывает их через realtime. Суммы приходят с сервера только owner/admin: остальным — 403. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ObjectCostCategory } from '@gr8r/shared';
import { call, useWsId } from '../meta/data';
import { objectsKey } from './data';

/** Как посчитан остаток строки прогноза */
export type ForecastBasis = 'tempo' | 'plan' | 'accepted' | 'category' | 'override' | 'zero';
export type ForecastGapCode = 'no_estimate' | 'no_cost_price' | 'no_labor_fact' | 'no_rate_hours';

export interface ForecastGap {
  code: ForecastGapCode;
  itemId?: string;
  name?: string;
  /** Часы без ставки */
  hours?: string;
  /** Сколько позиций затронуто */
  count?: number;
}

export interface ForecastItem {
  id: string;
  kind: string;
  category: ObjectCostCategory;
  name: string;
  unitCode: string;
  qty: string;
  doneQty: string;
  donePct: string | null;
  planCost: string;
  factCost: string | null;
  planHours: string;
  factHours: string;
  remainingHours: string;
  forecastHours: string;
  remaining: string | null;
  forecast: string | null;
  deviation: string | null;
  basis: ForecastBasis;
  overridden: boolean;
  overrideReason: string | null;
  noCostPrice: boolean;
}

export interface ForecastCategory {
  category: ObjectCostCategory;
  planCost: string;
  factCost: string;
  remaining: string | null;
  forecast: string | null;
  deviation: string | null;
  overridden: boolean;
  overrideReason: string | null;
  items: ForecastItem[];
}

export interface ForecastTotals {
  planCost: string;
  factCost: string;
  remaining: string | null;
  overhead: string | null;
  forecastCost: string | null;
  contractValue: string;
  profit: string | null;
  marginPct: string | null;
}

export interface ForecastOverride {
  id: string;
  objectId: string;
  estimateItemId: string | null;
  itemName: string | null;
  category: ObjectCostCategory | null;
  remaining: string;
  reason: string;
  authorId: string | null;
  authorName: string | null;
  createdAt: string;
}

/** Справка выручки: выполнено / принято / выставлено / оплачено (не смешивается с прогнозом) */
export interface ForecastRevenue {
  done: string | null;
  accepted: string;
  invoiced: string;
  paid: string;
}

export interface ObjectForecast {
  objectId: string;
  number: string;
  name: string;
  hasEstimate: boolean;
  overheadPct: string;
  categories: ForecastCategory[];
  totals: ForecastTotals;
  gaps: ForecastGap[];
  /** Дата и источник расчёта */
  computedAt: string;
  source: { estimate: boolean; shifts: number; subActs: number };
  overrides: ForecastOverride[];
  revenue: ForecastRevenue;
}

export interface ForecastExecutorPosition {
  estimateItemId: string | null;
  name: string | null;
  hours: string;
  costAmount: string | null;
}

export interface ForecastExecutor {
  memberId: string;
  memberName: string;
  personnelNumber: string | null;
  hours: string;
  costAmount: string | null;
  hoursWithoutCost: string;
  positions: ForecastExecutorPosition[];
}

export interface ForecastExecutors {
  objectId: string;
  from: string | null;
  to: string | null;
  items: ForecastExecutor[];
  totals: { hours: string; costAmount: string | null; hoursWithoutCost: string };
}

export interface PortfolioRow {
  objectId: string;
  number: string;
  name: string;
  status: string;
  customerName: string | null;
  progressPercent: string | null;
  contractValue: string;
  planCost: string;
  factCost: string;
  remaining: string | null;
  forecastCost: string | null;
  profit: string | null;
  marginPct: string | null;
  hasEstimate: boolean;
}

export interface ObjectPortfolio {
  items: PortfolioRow[];
  totals: { contractValue: string; factCost: string; forecastCost: string | null; profit: string | null; objects: number };
}

/** Отчёт прогноза объекта: суммы видит только owner/admin */
export function useObjectForecast(objectId: string | undefined) {
  const ws = useWsId();
  return useQuery({
    queryKey: objectsKey(ws, 'forecast', objectId),
    queryFn: () => call<ObjectForecast>(ws, 'GET', `/objects/${objectId}/forecast`),
    enabled: !!objectId,
  });
}

/** Исполнители объекта по подтверждённым сменам; период необязателен */
export function useForecastExecutors(objectId: string | undefined) {
  const ws = useWsId();
  return useQuery({
    queryKey: objectsKey(ws, 'forecast-executors', objectId),
    queryFn: () => call<ForecastExecutors>(ws, 'GET', `/objects/${objectId}/forecast/executors`),
    enabled: !!objectId,
  });
}

/** Портфель: прогноз по всем активным объектам */
export function useObjectsPortfolio() {
  const ws = useWsId();
  return useQuery({
    queryKey: objectsKey(ws, 'portfolio'),
    queryFn: () => call<ObjectPortfolio>(ws, 'GET', '/objects-forecast'),
  });
}

export interface ForecastOverrideInput {
  estimateItemId?: string | null;
  category?: ObjectCostCategory | null;
  remaining: string;
  reason: string;
}

/** Правки остатка: после сохранения и снятия перечитываются прогноз, исполнители и портфель */
export function useForecastApi(objectId: string) {
  const ws = useWsId();
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: objectsKey(ws) });
  };
  const save = useMutation({
    mutationFn: (input: ForecastOverrideInput) => call<ForecastOverride>(ws, 'PUT', `/objects/${objectId}/forecast/overrides`, input),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (target: { id?: string; estimateItemId?: string | null; category?: ObjectCostCategory | null }) => {
      const sp = new URLSearchParams();
      if (target.id) sp.set('id', target.id);
      if (target.estimateItemId) sp.set('estimateItemId', target.estimateItemId);
      if (target.category) sp.set('category', target.category);
      return call<{ id: string; deleted: true }>(ws, 'DELETE', `/objects/${objectId}/forecast/overrides?${sp}`);
    },
    onSuccess: refresh,
  });
  return { save, remove };
}
