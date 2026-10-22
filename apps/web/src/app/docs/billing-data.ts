/* Договоры, тарифные планы и биллинг на клиенте. Данные лежат в кэше TanStack Query; после изменений кэш сбрасывается.
   Тексты интерфейса — английские, подпись периода в строке счёта — русская (печатные формы русские). */
import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { BillingPeriodicity, ContractKind, ExtraProductPolicy } from '@gr8r/shared';
import { toast } from '@/components/ui';
import { errorMessage } from '../data/api';
import { call, useWsId } from '../meta/data';

export const billingKey = (ws: string, ...rest: unknown[]) => ['ws', ws, 'billing', ...rest] as const;

export interface Contract {
  id: string;
  companyId: string;
  companyName: string;
  organizationId: string;
  organizationName: string;
  number: string;
  date: string;
  kind: ContractKind;
  category: string;
  isSigned: boolean;
  isDefault: boolean;
  validFrom: string;
  validTo: string | null;
  paymentDays: number;
  priceType: string;
  isService: boolean;
  tariffPlanId: string | null;
  tariffPlanName: string | null;
  extraProductPolicy: ExtraProductPolicy;
  periodicity: BillingPeriodicity | null;
  billingDay: number;
  documentPackage: 'invoice' | 'invoice_act';
  note: string;
  /** Совпадающий номер договора — предупреждение, не ошибка */
  warnings: string[];
}

export interface TariffPlanLine {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  unitCode: string;
  vatRate: string;
  qty: string;
  price: string;
  isSubscription: boolean;
  invoiceAsProductId: string | null;
  invoiceAsProductName: string | null;
}

export interface TariffPlan {
  id: string;
  name: string;
  extraProductPolicy: ExtraProductPolicy;
  note: string;
  lines: TariffPlanLine[];
}

export interface BillingPreviewLine {
  productId: string;
  name: string;
  qty: string;
  price: string;
  vatRate: string;
  breakdown: { source: string; sourceId: string | null; name: string; qty: string; price: string; amount: string }[];
}

export interface BillingPreviewItem {
  contractId: string;
  contractNumber: string;
  companyName: string;
  period: string;
  factPeriod: string;
  existingDocumentId: string | null;
  warnings: string[];
  lines: BillingPreviewLine[];
}

export interface BillingRunItem {
  contractId: string;
  contractNumber: string;
  documentId: string | null;
  number: string | null;
  skipped: boolean;
  reason?: string;
}

export function useContracts(params: { companyId?: string; kind?: string; isService?: boolean; q?: string } = {}) {
  const ws = useWsId();
  return useQuery({
    queryKey: billingKey(ws, 'contracts', params),
    queryFn: () => {
      const sp = new URLSearchParams({ limit: '200' });
      if (params.companyId) sp.set('companyId', params.companyId);
      if (params.kind) sp.set('kind', params.kind);
      if (params.isService !== undefined) sp.set('isService', String(params.isService));
      if (params.q) sp.set('q', params.q);
      return call<{ items: Contract[] }>(ws, 'GET', `/contracts?${sp}`);
    },
    staleTime: Infinity,
    placeholderData: prev => prev,
  });
}

export function useTariffPlans() {
  const ws = useWsId();
  return useQuery({
    queryKey: billingKey(ws, 'tariff-plans'),
    queryFn: async () => (await call<{ items: TariffPlan[] }>(ws, 'GET', '/tariff-plans?limit=100')).items,
    staleTime: Infinity,
  });
}

export function useBillingPreview(period: string | undefined, contractIds?: string[]) {
  const ws = useWsId();
  return useQuery({
    queryKey: billingKey(ws, 'preview', period ?? '', contractIds ?? []),
    queryFn: () => {
      const sp = new URLSearchParams();
      if (period) sp.set('period', period);
      if (contractIds?.length) sp.set('contractIds', contractIds.join(','));
      return call<{ items: BillingPreviewItem[] }>(ws, 'GET', `/billing/preview?${sp}`);
    },
    enabled: !!period,
    staleTime: 0,
  });
}

export interface ContractReportRow {
  contractId: string;
  contractNumber: string;
  companyName: string;
  income: string;
  expense: string;
}

export function useContractReport(params: { from?: string; to?: string } = {}) {
  const ws = useWsId();
  return useQuery({
    queryKey: billingKey(ws, 'report', params.from ?? '', params.to ?? ''),
    queryFn: () => {
      const sp = new URLSearchParams();
      if (params.from) sp.set('from', params.from);
      if (params.to) sp.set('to', params.to);
      return call<{ items: ContractReportRow[] }>(ws, 'GET', `/billing/report?${sp}`);
    },
    staleTime: Infinity,
  });
}

/** Часовой пояс арендатора */
export function useWorkspaceTimezone() {
  const ws = useWsId();
  return useQuery({
    queryKey: billingKey(ws, 'timezone'),
    queryFn: () => call<{ timezone: string; options: string[] }>(ws, 'GET', '/billing/timezone'),
    staleTime: Infinity,
  });
}

/** Расшифровка биллинга счёта */
export function useBillingBreakdown(documentId: string | undefined) {
  const ws = useWsId();
  return useQuery({
    queryKey: billingKey(ws, 'breakdown', documentId),
    queryFn: () =>
      call<{ period: string; subscriptionPeriod: string; factPeriod: string; lines: { productId: string; name: string; qty: string; price: string; vatRate: string; invoiceAsProductId: string | null; rows: { source: string; sourceId: string | null; name: string; qty: string; price: string; amount: string }[] }[]; warnings: string[] }>(
        ws,
        'GET',
        `/billing/breakdown/${documentId}`,
      ),
    enabled: !!documentId,
    staleTime: Infinity,
    retry: false,
  });
}

/** Вызовы API договоров и биллинга: после изменения сбрасывается кэш договоров и документов */
export function useBillingApi() {
  const ws = useWsId();
  const qc = useQueryClient();
  return React.useCallback(
    async <T,>(method: string, path: string, json?: unknown): Promise<T | null> => {
      try {
        const r = await call<T>(ws, method, path, json);
        void qc.invalidateQueries({ queryKey: billingKey(ws) });
        void qc.invalidateQueries({ queryKey: ['ws', ws, 'docs'] });
        return r;
      } catch (e) {
        toast.error(errorMessage(e));
        return null;
      }
    },
    [ws, qc],
  );
}
