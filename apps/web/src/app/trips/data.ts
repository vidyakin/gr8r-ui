/* Рейсы на клиенте (задача 1211, docs/architecture/trips.md): запросы и мутации. Ключи кэша — под ['ws', id, 'fleet', 'trips', …]:
   события fleet_trip, delivery и fleet_* сбрасывают их (app/data/realtime.ts). */
import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Overload, StopKind, StopSource, StopStatus, TripCapacityMode, TripKind, TripLoad, TripStatus, VehicleLimits } from '@gr8r/shared';
import { API_BASE, errorMessage } from '../data/api';
import { toast } from '@/components/ui';
import { call, useWsId } from '../meta/data';
import { fleetKey } from '../fleet/data';

export interface Trip {
  id: string;
  number: string;
  kind: TripKind;
  status: TripStatus;
  name: string;
  dateFrom: string;
  dateTo: string;
  startTime: string | null;
  endTime: string | null;
  vehicleId: string;
  driverMemberId: string;
  coDriverMemberId: string | null;
  comment: string;
  plate: string;
  vehicleName: string;
  driverName: string;
  coDriverName: string | null;
  limits: VehicleLimits;
  load: TripLoad;
  overloads: Overload[];
  stopsTotal: number;
  stopsDone: number;
  straightKm: string | null;
}

export interface TripStop {
  id: string;
  seq: number;
  kind: StopKind;
  sourceKind: StopSource;
  sourceId: string | null;
  deliveryId: string | null;
  title: string;
  address: string;
  lat: string | null;
  lon: string | null;
  contactName: string;
  contactPhone: string;
  day: string;
  windowFrom: string | null;
  windowTo: string | null;
  weightKg: string;
  volumeM3: string;
  pallets: number;
  status: StopStatus;
  comment: string;
  legKm: string | null;
  deliveryStatus: string | null;
  documentNumber: string | null;
  documentTotal: string | null;
}

export interface TripWarning {
  code: 'window_order' | 'overload';
  seq?: number;
  overloads?: Overload[];
}

export interface TripDetail extends Trip {
  stops: TripStop[];
  warnings: TripWarning[];
  waybills: { id: string; number: string; status: string; date: string }[];
  capacityMode: TripCapacityMode;
}

export interface DispatchTrip extends Trip {
  stops: { id: string; seq: number; kind: StopKind; title: string; address: string; day: string; windowFrom: string | null; windowTo: string | null; status: StopStatus; weightKg: string }[];
}

export interface DispatchDelivery {
  id: string;
  documentNumber: string | null;
  counterpartyName: string | null;
  address: string;
  windowFrom: string | null;
  windowTo: string | null;
  weightKg: string;
  deliveryDate: string | null;
  status: string;
  documentTotal: string;
}

export interface Dispatch {
  date: string;
  capacityMode: TripCapacityMode;
  unassigned: DispatchDelivery[];
  vehicles: { id: string; plate: string; name: string; capacityKg: string | null; volumeM3: string | null; pallets: number | null; driverMemberId: string | null }[];
  drivers: { id: string; name: string }[];
  trips: DispatchTrip[];
}

const qs = (o: Record<string, string | number | undefined | null>) => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : '';
};

function useTripQuery<T>(key: unknown[], path: string, enabled = true) {
  const ws = useWsId();
  return useQuery({ queryKey: fleetKey(ws, 'trips', ...key), queryFn: () => call<T>(ws, 'GET', `/trips${path}`), staleTime: Infinity, enabled, placeholderData: prev => prev });
}

export const useTrips = (o: { from?: string; to?: string; vehicleId?: string; status?: string; kind?: string; q?: string }) => useTripQuery<{ items: Trip[]; total: number }>(['list', o], qs({ ...o, limit: 200 }));
export const useTrip = (id: string | null) => useTripQuery<TripDetail>(['one', id], `/${id}`, !!id);
export const useDispatch = (date: string) => useTripQuery<Dispatch>(['dispatch', date], `/dispatch${qs({ date })}`);
export const useTripSettings = () => useTripQuery<{ capacityMode: TripCapacityMode }>(['settings'], '/settings');

/** Мутация: ошибка — тостом по коду, успех — обновление кэша автопарка (рейсы, доставки) */
export function useTripApi() {
  const ws = useWsId();
  const qc = useQueryClient();
  return React.useCallback(
    async <T,>(method: string, path: string, json?: unknown): Promise<T | null> => {
      try {
        const r = await call<T>(ws, method, `/trips${path}`, json);
        void qc.invalidateQueries({ queryKey: fleetKey(ws) });
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

/** Маршрутный лист рейса: страница с сервера открывается в новой вкладке и сразу печатается */
export async function openTripPrint(ws: string, id: string): Promise<void> {
  const r = await fetch(`${API_BASE()}/trips/${id}/print`, { credentials: 'include', headers: { 'X-Workspace-Id': ws } });
  if (!r.ok) {
    const body = await r.json().catch(() => null);
    throw new Error(body?.error?.message ?? `Request failed (${r.status})`);
  }
  const url = URL.createObjectURL(new Blob([await r.text()], { type: 'text/html;charset=utf-8' }));
  const w = window.open(url, '_blank');
  if (w) w.addEventListener('load', () => w.print());
}
