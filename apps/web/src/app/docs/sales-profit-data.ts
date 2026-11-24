/* Запросы и экспорт XLSX для отчёта P&L «Валовая прибыль продаж» и ABC-анализа. */
import { useQuery } from '@tanstack/react-query';
import type { SalesProfitGroupBy } from '@erp/shared';
import { API_BASE, ok } from '../data/api';
import { call, useWsId } from '../meta/data';
import { docsKey } from './data';

export interface SalesProfitItem {
  groupId: string;
  groupName: string;
  revenue: string;
  discount: string;
  cogs: string | null;
  grossProfit: string | null;
  grossMarginPct: string | null;
}

export interface SalesProfitTotalsData {
  revenue: string;
  discount: string;
  cogs: string | null;
  grossProfit: string | null;
  grossMarginPct: string | null;
}

export interface SalesProfitData {
  dateFrom: string | null;
  dateTo: string | null;
  groupBy: SalesProfitGroupBy;
  items: SalesProfitItem[];
  totals: SalesProfitTotalsData;
  costVisible: boolean;
}

export interface SalesAbcItem extends SalesProfitItem {
  abcClass: 'A' | 'B' | 'C';
  contributionPct: string;
  cumulativePct: string;
}

export interface SalesAbcData {
  dateFrom: string | null;
  dateTo: string | null;
  groupBy: SalesProfitGroupBy;
  metric: 'revenue' | 'profit';
  thresholds: { a: number; b: number; c: number };
  items: SalesAbcItem[];
  totals: SalesProfitTotalsData;
  summary: Record<'A' | 'B' | 'C', { count: number; revenue: string; grossProfit: string | null }>;
  costVisible: boolean;
}

export interface SalesProfitParams {
  dateFrom?: string;
  dateTo?: string;
  groupBy: SalesProfitGroupBy;
  warehouseId?: string;
  organizationId?: string;
}

export interface SalesAbcParams extends SalesProfitParams {
  metric: 'revenue' | 'profit';
  thresholdA: number;
  thresholdB: number;
}

function buildProfitQs(p: SalesProfitParams): URLSearchParams {
  const sp = new URLSearchParams({ groupBy: p.groupBy });
  if (p.dateFrom) sp.set('dateFrom', p.dateFrom);
  if (p.dateTo) sp.set('dateTo', p.dateTo);
  if (p.warehouseId) sp.set('warehouseId', p.warehouseId);
  if (p.organizationId) sp.set('organizationId', p.organizationId);
  return sp;
}

function buildAbcQs(p: SalesAbcParams): URLSearchParams {
  const sp = buildProfitQs(p);
  sp.set('metric', p.metric);
  sp.set('thresholdA', String(p.thresholdA));
  sp.set('thresholdB', String(p.thresholdB));
  return sp;
}

export function useSalesProfit(params: SalesProfitParams, enabled = true) {
  const ws = useWsId();
  return useQuery({
    queryKey: docsKey(ws, 'sales-profit', params),
    queryFn: () => call<SalesProfitData>(ws, 'GET', `/documents/reports/sales-profit?${buildProfitQs(params)}`),
    enabled,
    staleTime: Infinity,
    placeholderData: prev => prev,
  });
}

export function useSalesAbc(params: SalesAbcParams, enabled = true) {
  const ws = useWsId();
  return useQuery({
    queryKey: docsKey(ws, 'sales-abc', params),
    queryFn: () => call<SalesAbcData>(ws, 'GET', `/documents/reports/sales-abc?${buildAbcQs(params)}`),
    enabled,
    staleTime: Infinity,
    placeholderData: prev => prev,
  });
}

export async function downloadSalesReportXlsx(ws: string, tab: 'profit' | 'abc', profitParams: SalesProfitParams, abcParams: SalesAbcParams) {
  const path =
    tab === 'profit'
      ? `/documents/reports/sales-profit/export?${buildProfitQs(profitParams)}`
      : `/documents/reports/sales-abc/export?${buildAbcQs(abcParams)}`;
  const stamp = profitParams.dateTo || new Date().toISOString().slice(0, 10);
  const res = await fetch(`${API_BASE()}${path}`, { credentials: 'include', headers: { 'X-Workspace-Id': ws } });
  if (!res.ok) await ok(res);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = `${tab === 'profit' ? 'sales-profit' : 'sales-abc'}-${stamp}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
