/* Рейсы на клиенте (задача 1211, docs/architecture/trips.md): запросы и мутации. Ключи кэша — под ['ws', id, 'fleet', 'trips', …]:
   события fleet_trip, delivery и fleet_* сбрасывают их (app/data/realtime.ts). */
import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Overload, RoutingSettings, TileConfig, StopKind, StopSource, StopStatus, TripCapacityMode, TripKind, TripLoad, TripStatus, VehicleLimits } from '@gr8r/shared';
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
  hired: boolean;
  carrierName: string | null;
  vehicleId: string | null;
  driverMemberId: string | null;
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
  /** Расчёт маршрута (задача 1213): длина и время в пути; пусто — не считали или порядок менялся после расчёта */
  routeKm: string | null;
  routeMin: number | null;
  routeSource: 'provider' | 'straight' | null;
  routedAt: string | null;
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
  legMin: number | null;
  /** Ожидаемое прибытие: минуты от полуночи первого дня рейса */
  etaMin: number | null;
  etaLate: boolean;
  geoStatus: 'pending' | 'ok' | 'approx' | 'not_found' | 'error' | null;
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
  stops: { id: string; seq: number; kind: StopKind; title: string; address: string; day: string; windowFrom: string | null; windowTo: string | null; status: StopStatus; weightKg: string; lat: string | null; lon: string | null; legKm: string | null; legMin: number | null; etaMin: number | null; etaLate: boolean }[];
}

export interface DispatchDelivery {
  id: string;
  documentNumber: string | null;
  counterpartyName: string | null;
  address: string;
  lat: string | null;
  lon: string | null;
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

export interface RoutingView {
  settings: RoutingSettings;
  tile: TileConfig;
  secrets: { yandexGeocoder: boolean; yandexRouter: boolean };
  capabilities: { geocode: boolean; matrix: boolean; solve: boolean };
  server: { osrm: boolean; vroom: boolean; nominatim: boolean };
}

export interface RoutingRun {
  id: string;
  kind: 'distribute' | 'optimize';
  status: 'queued' | 'running' | 'done' | 'failed';
  date: string;
  tripId: string | null;
  source: 'provider' | 'straight' | null;
  warning: string | null;
  error: string | null;
  createdAt: string;
  summary: { tripIds: string[]; stops: number; unassigned: { deliveryId: string; reason: string }[]; skippedVehicles: { vehicleId: string; reason: string }[]; routeKm?: number; routeMin?: number; reordered?: boolean } | null;
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
export const useRouting = () => useTripQuery<RoutingView>(['routing'], '/routing');
export const useRoutingRuns = (o: { date?: string; tripId?: string }) => useTripQuery<{ items: RoutingRun[] }>(['runs', o], `/routing/runs${qs(o)}`, !!(o.date || o.tripId));
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

/** Транспортная накладная (1214): выдать номер (повторно — тот же) и открыть печатную форму; область — рейс, точка или доставка */
export interface TnScope {
  tripId?: string;
  stopId?: string;
  deliveryId?: string;
}

export async function openTransportWaybill(ws: string, scope: TnScope): Promise<void> {
  const w = await call<{ id: string }>(ws, 'POST', '/trips/tn', scope);
  const r = await fetch(`${API_BASE()}/trips/tn/${w.id}/print`, { credentials: 'include', headers: { 'X-Workspace-Id': ws } });
  if (!r.ok) throw new Error(`Request failed (${r.status})`);
  const url = URL.createObjectURL(new Blob([await r.text()], { type: 'text/html;charset=utf-8' }));
  const win = window.open(url, '_blank');
  if (win) win.addEventListener('load', () => win.print());
}

/** ТН в PDF: задача воркеру, опрос статуса, скачивание */
export async function downloadTransportWaybillPdf(ws: string, scope: TnScope, msg: { failed: string; timeout: string }): Promise<void> {
  const w = await call<{ id: string }>(ws, 'POST', '/trips/tn', scope);
  const file = await call<{ id: string; name: string }>(ws, 'POST', `/trips/tn/${w.id}/pdf`, {});
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 1000));
    const st = await call<{ status: string; error?: string }>(ws, 'GET', `/trips/tn-files/${file.id}`);
    if (st.status === 'failed') throw new Error(st.error || msg.failed);
    if (st.status === 'ready') {
      const res = await fetch(`${API_BASE()}/trips/tn-files/${file.id}?download=1`, { credentials: 'include', headers: { 'X-Workspace-Id': ws } });
      if (!res.ok) throw new Error(msg.failed);
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      return;
    }
  }
  throw new Error(msg.timeout);
}
