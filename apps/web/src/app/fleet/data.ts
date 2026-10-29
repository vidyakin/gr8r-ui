/* Автопарк на клиенте (задача 1210, docs/architecture/fleet.md): запросы и мутации. Ключи кэша под ['ws', id, 'fleet', …]:
   события fleet_* обновляют их (app/data/realtime.ts), документы «Списание» от ремонтов — через ключи документов. */
import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { DocTermState, FleetDocKind, FineStatus, RepairKind, RepairStatus, ServiceDue, VehicleKind, VehicleStatus, WaybillFuelResult, WaybillStatus, FuelType } from '@gr8r/shared';
import { API_BASE } from '../data/api';
import { errorMessage } from '../data/api';
import { toast } from '@/components/ui';
import { call, useWsId } from '../meta/data';

export const fleetKey = (ws: string, ...rest: unknown[]) => ['ws', ws, 'fleet', ...rest] as const;

export interface Vehicle {
  id: string;
  plate: string;
  name: string;
  kind: VehicleKind;
  make: string;
  model: string;
  vin: string;
  year: number | null;
  capacityKg: string | null;
  volumeM3: string | null;
  pallets: number | null;
  fuelType: FuelType;
  fuelNormSummer: string | null;
  fuelNormWinter: string | null;
  tankL: string | null;
  odometer: string;
  status: VehicleStatus;
  driverMemberId: string | null;
  driverName: string | null;
  comment: string;
  archivedAt: string | null;
  docsExpired: number;
  docsExpiring: number;
}

export interface FleetDoc {
  id: string;
  kind: FleetDocKind;
  ownerKind: 'vehicle' | 'driver';
  vehicleId: string | null;
  memberId: string | null;
  plate: string | null;
  memberName: string | null;
  number: string;
  issuedOn: string | null;
  validUntil: string | null;
  remindDays: number;
  comment: string;
  state: DocTermState;
  daysLeft: number | null;
}

export interface ServicePlan {
  id: string;
  vehicleId: string;
  plate: string;
  name: string;
  everyKm: number | null;
  everyMonths: number | null;
  lastKm: string | null;
  lastDate: string | null;
  odometer: string;
  due: ServiceDue;
}

export interface VehicleDetail extends Vehicle {
  documents: FleetDoc[];
  servicePlans: ServicePlan[];
}

export interface Driver {
  memberId: string;
  name: string;
  email: string;
  licenseNumber: string;
  categories: string[];
  phone: string;
  comment: string;
  vehicles: { id: string; plate: string }[];
  docsExpired: number;
  docsExpiring: number;
}

export interface Waybill {
  id: string;
  number: string;
  date: string;
  status: WaybillStatus;
  vehicleId: string;
  driverMemberId: string;
  tripId: string | null;
  plate: string;
  driverName: string;
  route: string;
  departureAt: string | null;
  returnAt: string | null;
  odometerOut: string;
  odometerBack: string | null;
  fuelOut: string;
  fuelBack: string | null;
  fuelFilled: string;
  normPer100: string;
  distanceKm: string | null;
  normLiters: string | null;
  actualLiters: string | null;
  medicalOk: boolean;
  medicalTime: string;
  medicalBy: string;
  techOk: boolean;
  techTime: string;
  techBy: string;
  comment: string;
  fuel: WaybillFuelResult | null;
  fuelEntries?: FuelEntry[];
}

export interface FuelEntry {
  id: string;
  vehicleId: string;
  plate: string;
  cardId: string | null;
  card: string | null;
  waybillId: string | null;
  waybillNumber: string | null;
  date: string;
  liters: string;
  amount: string;
  odometer: string | null;
  station: string;
  source: 'manual' | 'csv';
  comment: string;
}

export interface FuelCard {
  id: string;
  number: string;
  name: string;
  vehicleId: string | null;
  plate: string | null;
}

export interface RepairLine {
  id?: string;
  kind: 'part' | 'work';
  productId: string | null;
  name: string;
  qty: string;
  price: string;
}

export interface Repair {
  id: string;
  number: string;
  kind: RepairKind;
  status: RepairStatus;
  vehicleId: string;
  plate: string;
  date: string;
  odometer: string | null;
  planId: string | null;
  warehouseId: string | null;
  contractorId: string | null;
  description: string;
  writeOffDocumentId: string | null;
  partsCost: string;
  directCost: string;
  lines?: RepairLine[];
}

export interface Fine {
  id: string;
  vehicleId: string;
  plate: string;
  driverMemberId: string | null;
  driverName: string | null;
  waybillNumber: string | null;
  date: string;
  uin: string;
  article: string;
  amount: string;
  status: FineStatus;
  paidOn: string | null;
  chargeDriver: boolean;
  comment: string;
}

export interface FleetSummary {
  vehicles: number;
  docsExpired: number;
  docsExpiring: number;
  serviceOverdue: number;
  serviceSoon: number;
  today: string;
}

export interface VehicleCost {
  vehicleId: string;
  plate: string;
  distanceKm: string;
  fuelLiters: string;
  fuelAmount: string;
  fuelDeltaLiters: string;
  repairAmount: string;
  finesAmount: string;
  total: string;
  perKm: string | null;
}

export interface FuelImportResult {
  rows: { line: number; date: string; card: string; plate: string; liters: string; amount: string; station: string; status: 'created' | 'duplicate' | 'error'; error?: string }[];
  created: number;
  duplicates: number;
  errors: number;
}

const qs = (o: Record<string, string | number | undefined | null>) => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : '';
};

function useFleetQuery<T>(key: unknown[], path: string, enabled = true) {
  const ws = useWsId();
  return useQuery({ queryKey: fleetKey(ws, ...key), queryFn: () => call<T>(ws, 'GET', `/fleet/${path}`), staleTime: Infinity, enabled, placeholderData: prev => prev });
}

export const useFleetSummary = () => useFleetQuery<FleetSummary>(['summary'], 'summary');
export const useVehicles = (o: { status?: string; archived?: 'include' | 'only' } = {}) => useFleetQuery<{ items: Vehicle[] }>(['vehicles', o], `vehicles${qs(o)}`);
export const useVehicle = (id: string | null) => useFleetQuery<VehicleDetail>(['vehicle', id], `vehicles/${id}`, !!id);
export const useDrivers = () => useFleetQuery<{ items: Driver[] }>(['drivers'], 'drivers');
export const useFleetDocs = (o: { vehicleId?: string; memberId?: string; kind?: string; term?: string } = {}) => useFleetQuery<{ items: FleetDoc[] }>(['docs', o], `documents${qs(o)}`);
export const useWaybills = (o: { from?: string; to?: string; vehicleId?: string; driverId?: string; status?: string; q?: string }) => useFleetQuery<{ items: Waybill[]; total: number }>(['waybills', o], `waybills${qs({ ...o, limit: 200 })}`);
export const useWaybill = (id: string | null) => useFleetQuery<Waybill>(['waybill', id], `waybills/${id}`, !!id);
export const useFuel = (o: { from?: string; to?: string; vehicleId?: string }) => useFleetQuery<{ items: FuelEntry[]; total: number; totals: { liters: string; amount: string } }>(['fuel', o], `fuel${qs({ ...o, limit: 200 })}`);
export const useFuelCards = () => useFleetQuery<{ items: FuelCard[] }>(['fuel-cards'], 'fuel-cards');
export const useServicePlans = () => useFleetQuery<{ items: ServicePlan[] }>(['plans'], 'service-plans');
export const useRepairs = (o: { from?: string; to?: string; vehicleId?: string; kind?: string; status?: string }) => useFleetQuery<{ items: Repair[]; total: number }>(['repairs', o], `repairs${qs({ ...o, limit: 200 })}`);
export const useRepair = (id: string | null) => useFleetQuery<Repair>(['repair', id], `repairs/${id}`, !!id);
export const useFines = (o: { from?: string; to?: string; vehicleId?: string; driverId?: string; status?: string }) => useFleetQuery<{ items: Fine[]; total: number; totals: { amount: string } }>(['fines', o], `fines${qs({ ...o, limit: 200 })}`);
export const useFleetCosts = (from: string, to: string, enabled: boolean) => useFleetQuery<{ items: VehicleCost[]; totals: Omit<VehicleCost, 'vehicleId' | 'plate'> }>(['costs', from, to], `costs${qs({ from, to })}`, enabled);

/** Мутация: ошибка — тостом по коду, успех — обновление кэша автопарка (и документов: списание запчастей) */
export function useFleetApi() {
  const ws = useWsId();
  const qc = useQueryClient();
  return React.useCallback(
    async <T,>(method: string, path: string, json?: unknown): Promise<T | null> => {
      try {
        const r = await call<T>(ws, method, `/fleet/${path}`, json);
        void qc.invalidateQueries({ queryKey: fleetKey(ws) });
        if (path.startsWith('repairs')) void qc.invalidateQueries({ queryKey: ['ws', ws, 'docs'] });
        return r;
      } catch (e) {
        toast.error(errorMessage(e));
        return null;
      }
    },
    [ws, qc],
  );
}

/** Печатная форма путевого листа: страница с сервера открывается в новой вкладке и сразу печатается */
export async function openWaybillPrint(ws: string, id: string): Promise<void> {
  const r = await fetch(`${API_BASE()}/fleet/waybills/${id}/print`, { credentials: 'include', headers: { 'X-Workspace-Id': ws } });
  if (!r.ok) {
    const body = await r.json().catch(() => null);
    throw new Error(body?.error?.message ?? `Request failed (${r.status})`);
  }
  const url = URL.createObjectURL(new Blob([await r.text()], { type: 'text/html;charset=utf-8' }));
  const w = window.open(url, '_blank');
  if (w) w.addEventListener('load', () => w.print());
}
