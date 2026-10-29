/* Источники привлечения и рекламные кампании на клиенте (задача 1177, docs/architecture/ad-campaigns.md): запросы
   /lead-sources, /ad-campaigns, /ad-expenses, /ad-report. Ключи кэша ['ws', id, 'ad', …]: события lead_source / ad_campaign /
   ad_expense / lead / company / deal обновляют их (data/realtime.ts). */
import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/components/ui';
import { errorMessage } from '../data/api';
import { call, useWsId } from '../meta/data';

export interface LeadSource {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
  archivedAt: string | null;
}

export interface AdCampaign {
  id: string;
  name: string;
  sourceId: string;
  utmCampaign: string;
  startDate: string | null;
  endDate: string | null;
  budget: string;
  comment: string;
  ownerId: string | null;
  archivedAt: string | null;
  /** Потрачено за всё время */
  spent: string;
}

export interface AdExpense {
  id: string;
  campaignId: string;
  date: string;
  amount: string;
  comment: string;
}

export interface AdReportRow {
  key: string | null;
  name: string | null;
  color: string | null;
  sourceName: string | null;
  leads: number;
  converted: number;
  newClients: number;
  wonDeals: number;
  revenue: string;
  expense: string;
  conversion: string | null;
  cpl: string | null;
  cac: string | null;
  romi: string | null;
}

export interface AdReport {
  from: string;
  to: string;
  groupBy: 'source' | 'campaign';
  rows: AdReportRow[];
  total: AdReportRow;
  currencies: string[];
}

/** Источник и кампания записи (лид, форма, контрагент, сделка) */
export interface Attribution {
  sourceId: string | null;
  campaignId: string | null;
}

export const adKey = (ws: string, ...rest: unknown[]) => ['ws', ws, 'ad', ...rest] as const;

/** Источники вместе с архивными: в выборе архивный показывается только как текущее значение */
export function useLeadSources() {
  const ws = useWsId();
  return useQuery({ queryKey: adKey(ws, 'sources'), queryFn: async () => (await call<{ items: LeadSource[] }>(ws, 'GET', '/lead-sources?limit=200&sort=sortOrder&archived=include')).items, staleTime: Infinity });
}

/** Кампании; archived=include — и архивные (для подписи у старых записей) */
export function useAdCampaigns(archived: 'exclude' | 'include' = 'exclude') {
  const ws = useWsId();
  return useQuery({ queryKey: adKey(ws, 'campaigns', archived), queryFn: async () => (await call<{ items: AdCampaign[] }>(ws, 'GET', `/ad-campaigns?limit=200&archived=${archived}`)).items, staleTime: Infinity });
}

export function useAdExpenses(campaignId: string | null) {
  const ws = useWsId();
  return useQuery({
    queryKey: adKey(ws, 'expenses', campaignId),
    enabled: !!campaignId,
    queryFn: async () => (await call<{ items: AdExpense[] }>(ws, 'GET', `/ad-expenses?campaignId=${campaignId}&limit=200`)).items,
    staleTime: Infinity,
  });
}

export function useAdReport(from: string, to: string, groupBy: 'source' | 'campaign') {
  const ws = useWsId();
  return useQuery({ queryKey: adKey(ws, 'report', from, to, groupBy), enabled: !!from && !!to && from <= to, queryFn: () => call<AdReport>(ws, 'GET', `/ad-report?from=${from}&to=${to}&groupBy=${groupBy}`), staleTime: Infinity });
}

/** Вызов API рекламы: тост при ошибке, null при ошибке; кэш рекламы и лидов помечается сразу */
export function useAdApi() {
  const ws = useWsId();
  const qc = useQueryClient();
  return React.useCallback(
    async <T,>(method: string, path: string, json?: unknown): Promise<T | null> => {
      try {
        const r = await call<T>(ws, method, path, json);
        void qc.invalidateQueries({ queryKey: adKey(ws) });
        void qc.invalidateQueries({ queryKey: ['ws', ws, 'leads'] });
        return r;
      } catch (e) {
        toast.error(errorMessage(e));
        return null;
      }
    },
    [ws, qc],
  );
}
