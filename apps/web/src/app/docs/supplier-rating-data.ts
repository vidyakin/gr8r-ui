/* Рейтинг поставщиков на клиенте (задача 1276): список за период, карточка поставщика и настройки весов.
   Расчёт сервер делает на лету по проведённым документам, поэтому кэш помечается устаревшим событиями
   document / company / workspace (app/data/realtime.ts). */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SupplierRatingLevel, SupplierRatingWeights } from '@gr8r/shared';
import { errorMessage } from '../data/api';
import { iso } from '../lib/dates';
import { call, useWsId } from '../meta/data';

export const supplierRatingKey = (ws: string, ...rest: unknown[]) => ['ws', ws, 'supplier-ratings', ...rest] as const;

export type SupplierRatingDPolicy = 'none' | 'warn' | 'block';

export interface SupplierRatingRow {
  companyId: string;
  companyName: string;
  ordersCount: number;
  onTimeRate: number | null;
  completenessRate: number | null;
  qualityRate: number | null;
  rating: number | null;
  level: SupplierRatingLevel | null;
}

export interface SupplierRatingDetail extends SupplierRatingRow {
  from: string;
  to: string;
  onTimeOrders: number;
  dueDateOrders: number;
  orderedQty: string;
  receivedQty: string;
  rejectedQty: string;
  returnedQty: string;
}

export interface SupplierRatingSettings {
  weights: SupplierRatingWeights;
  dPolicy: SupplierRatingDPolicy;
}

/** Период рейтинга; без границ сервер берёт свои 12 месяцев */
export interface SupplierRatingPeriod {
  from?: string;
  to?: string;
}

/**
 * Последние 12 месяцев — период по умолчанию на экране (то же правило, что в расчёте на сервере)
 */
export function defaultSupplierRatingPeriod(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
  return { from: iso(from), to: iso(now) };
}

const periodQuery = (p?: SupplierRatingPeriod) => {
  const sp = new URLSearchParams();
  if (p?.from) sp.set('from', p.from);
  if (p?.to) sp.set('to', p.to);
  const q = sp.toString();
  return q ? `?${q}` : '';
};

export function useSupplierRatings(period: SupplierRatingPeriod, enabled = true) {
  const ws = useWsId();
  return useQuery({
    queryKey: supplierRatingKey(ws, 'list', period.from ?? '', period.to ?? ''),
    queryFn: async () => (await call<{ items: SupplierRatingRow[]; total: number }>(ws, 'GET', `/supplier-ratings${periodQuery(period)}`)).items,
    enabled,
    staleTime: Infinity,
    placeholderData: prev => prev,
  });
}

/** Карточка поставщика: без companyId запрос не уходит */
export function useSupplierRating(companyId: string | null | undefined, period?: SupplierRatingPeriod, enabled = true) {
  const ws = useWsId();
  return useQuery({
    queryKey: supplierRatingKey(ws, 'item', companyId ?? '', period?.from ?? '', period?.to ?? ''),
    queryFn: () => call<SupplierRatingDetail>(ws, 'GET', `/supplier-ratings/${companyId}${periodQuery(period)}`),
    enabled: !!companyId && enabled,
    staleTime: Infinity,
  });
}

export function useSupplierRatingSettings(enabled = true) {
  const ws = useWsId();
  return useQuery({ queryKey: supplierRatingKey(ws, 'settings'), queryFn: () => call<SupplierRatingSettings>(ws, 'GET', '/supplier-ratings/settings'), enabled, staleTime: Infinity });
}

/** Сохранение весов и политики при уровне D (PATCH /supplier-ratings/settings, только owner/admin) */
export function useSaveSupplierRatingSettings() {
  const ws = useWsId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { weights?: Partial<SupplierRatingWeights>; dPolicy?: SupplierRatingDPolicy }) => call<SupplierRatingSettings>(ws, 'PATCH', '/supplier-ratings/settings', body),
    onSuccess: async () => {
      // веса меняют итог у всех поставщиков — перечитываем список и карточки
      await qc.invalidateQueries({ queryKey: supplierRatingKey(ws) });
    },
    onError: e => {
      throw new Error(errorMessage(e));
    },
  });
}
