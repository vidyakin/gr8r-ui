/* Заявки на перевозку, тарифы по направлениям и экспедирование рейса (задача 1223, docs/architecture/transport-orders.md):
   запросы и мутации. Кэш — под ['ws', id, 'transport-orders', …]; инвалидация вручную после мутаций (без realtime-событий). */
import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { TransportOrderStatus, TransportRateKind } from '@gr8r/shared';
import { toast } from '@/components/ui';
import { errorMessage } from '../data/api';
import { call, useWsId } from '../meta/data';

export const transportKey = (ws: string, ...rest: unknown[]) => ['ws', ws, 'transport-orders', ...rest] as const;

/* ---------------- тарифы по направлениям ---------------- */

export interface RateSchedule {
  id: string;
  name: string;
  fromPlace: string;
  toPlace: string;
  bodyType: string;
  rateKind: TransportRateKind;
  rate: string;
  distanceKm: string | null;
  comment: string;
  archivedAt: string | null;
}

export function useRateSchedules(q: { archived?: 'exclude' | 'include' | 'only'; q?: string } = {}) {
  const ws = useWsId();
  const sp = new URLSearchParams();
  if (q.archived) sp.set('archived', q.archived);
  if (q.q) sp.set('q', q.q);
  sp.set('limit', '200');
  return useQuery({ queryKey: transportKey(ws, 'rate-schedules', q), queryFn: () => call<{ items: RateSchedule[] }>(ws, 'GET', `/transport-orders/rate-schedules?${sp}`), staleTime: Infinity, placeholderData: prev => prev });
}

export function useSuggestRateSchedule(fromPlace: string, toPlace: string, bodyType: string) {
  const ws = useWsId();
  const enabled = fromPlace.trim().length > 0 && toPlace.trim().length > 0;
  return useQuery({
    queryKey: transportKey(ws, 'rate-suggest', fromPlace, toPlace, bodyType),
    queryFn: () => call<{ item: RateSchedule | null }>(ws, 'GET', `/transport-orders/rate-schedules/suggest?${new URLSearchParams({ fromPlace, toPlace, ...(bodyType ? { bodyType } : {}) })}`),
    enabled,
    staleTime: 10_000,
  });
}

/* ---------------- заявки на перевозку ---------------- */

export interface TransportOrderPoint {
  id: string;
  seq: number;
  kind: 'load' | 'unload';
  address: string;
  contactName: string;
  contactPhone: string;
}

export interface TransportOrder {
  id: string;
  number: string;
  date: string;
  status: TransportOrderStatus;
  organizationId: string;
  customerCompanyId: string;
  customerName: string | null;
  fromPlace: string;
  toPlace: string;
  readyDate: string | null;
  deliveryDate: string | null;
  cargoName: string;
  weightKg: string;
  volumeM3: string;
  places: number;
  bodyType: string;
  rateScheduleId: string | null;
  rateKind: TransportRateKind;
  rate: string;
  distanceKm: string | null;
  amount: string;
  comment: string;
  tripId: string | null;
  invoiceDocumentId: string | null;
  actDocumentId: string | null;
}

export interface TransportOrderDetail extends TransportOrder {
  points: TransportOrderPoint[];
}

export function useTransportOrders(q: { from?: string; to?: string; status?: string; customerCompanyId?: string; q?: string } = {}) {
  const ws = useWsId();
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v) sp.set(k, v);
  sp.set('limit', '200');
  return useQuery({ queryKey: transportKey(ws, 'orders', q), queryFn: () => call<{ items: TransportOrder[] }>(ws, 'GET', `/transport-orders?${sp}`), staleTime: Infinity, placeholderData: prev => prev });
}

export function useTransportOrder(id: string | null) {
  const ws = useWsId();
  return useQuery({ queryKey: transportKey(ws, 'order', id), queryFn: () => call<TransportOrderDetail>(ws, 'GET', `/transport-orders/${id}`), enabled: !!id, staleTime: Infinity, placeholderData: prev => prev });
}

/** Мутация модуля заявок/тарифов: ошибка — тостом, успех — сброс кэша заявок/тарифов и документов (счета и акты) */
export function useTransportApi() {
  const ws = useWsId();
  const qc = useQueryClient();
  return React.useCallback(
    async <T,>(method: string, path: string, json?: unknown): Promise<T | null> => {
      try {
        const r = await call<T>(ws, method, `/transport-orders${path}`, json);
        void qc.invalidateQueries({ queryKey: transportKey(ws) });
        void qc.invalidateQueries({ queryKey: ['ws', ws, 'docs'] });
        void qc.invalidateQueries({ queryKey: ['ws', ws, 'fleet'] });
        return r;
      } catch (e) {
        toast.error(errorMessage(e));
        return null;
      }
    },
    [ws, qc],
  );
}

/* ---------------- экспедирование: наёмный перевозчик и затраты рейса ---------------- */

export interface FleetTripCarrier {
  id: string;
  tripId: string;
  carrierCompanyId: string;
  rate: string;
  vehiclePlate: string;
  vehicleModel: string;
  driverName: string;
  driverPhone: string;
  driverLicense: string;
  contractNumber: string;
  contractDate: string | null;
  comment: string;
}

export interface FleetTripCost {
  id: string;
  tripId: string;
  costItemId: string;
  amount: string;
  comment: string;
}

export interface TripMargin {
  income: string;
  fuelAmount: string;
  carrierRate: string;
  otherCosts: string;
  totalCosts: string;
  margin: string;
  marginPct: string | null;
  forwarding: { margin: string; marginPct: string | null } | null;
}

export function useFleetTripCarrier(tripId: string | null) {
  const ws = useWsId();
  return useQuery({ queryKey: transportKey(ws, 'trip-carrier', tripId), queryFn: () => call<{ item: FleetTripCarrier | null }>(ws, 'GET', `/transport-orders/trips/${tripId}/carrier`), enabled: !!tripId, staleTime: Infinity });
}

export function useFleetTripCosts(tripId: string | null) {
  const ws = useWsId();
  return useQuery({ queryKey: transportKey(ws, 'trip-costs', tripId), queryFn: () => call<{ items: FleetTripCost[] }>(ws, 'GET', `/transport-orders/trips/${tripId}/costs`), enabled: !!tripId, staleTime: Infinity });
}

export function useTripMargin(tripId: string | null, enabled = true) {
  const ws = useWsId();
  return useQuery({ queryKey: transportKey(ws, 'trip-margin', tripId), queryFn: () => call<TripMargin>(ws, 'GET', `/transport-orders/trips/${tripId}/margin`), enabled: !!tripId && enabled, staleTime: Infinity });
}
