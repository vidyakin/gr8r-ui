/* Данные раздела /weighings (модуль «Добыча»): журнал взвешиваний, сводка и мутации */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { WeighingCreateBody, WeighingDirection, WeighingPatchBody, WeighingSource } from '@erp/shared';
import { toast } from '@/components/ui';
import { errorMessage } from '../data/api';
import { call, useWsId } from '../meta/data';

export interface Weighing {
  id: string;
  number: string;
  weighedAt: string;
  direction: WeighingDirection;
  vehicleId: string | null;
  vehiclePlate: string | null;
  plateNumber: string;
  driverName: string;
  counterpartyId: string | null;
  counterpartyName: string | null;
  productId: string | null;
  productName: string | null;
  grossKg: string;
  tareKg: string;
  netKg: string;
  bulkDensity: string | null;
  volumeM3: string | null;
  waybillNumber: string;
  source: WeighingSource;
  notes: string;
  createdAt: string;
}

export interface WeighingSummary {
  count: number;
  totalNetKg: number;
  totalVolumeM3: number;
}

export const weighingsKey = (ws: string, ...rest: unknown[]) => ['ws', ws, 'weighings', ...rest] as const;

export function useWeighings(opts?: { direction?: WeighingDirection | 'all'; q?: string }) {
  const ws = useWsId();
  const dir = opts?.direction && opts.direction !== 'all' ? opts.direction : '';
  const q = opts?.q?.trim() ?? '';
  return useQuery({
    queryKey: weighingsKey(ws, 'list', dir, q),
    queryFn: () => {
      const sp = new URLSearchParams();
      if (dir) sp.set('direction', dir);
      if (q) sp.set('q', q);
      const qs = sp.toString();
      return call<{ items: Weighing[]; summary: WeighingSummary }>(ws, 'GET', `/weighings${qs ? `?${qs}` : ''}`);
    },
    staleTime: 15_000,
  });
}

export function useWeighingActions() {
  const ws = useWsId();
  const qc = useQueryClient();
  const run = async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    try {
      const res = await fn();
      await qc.invalidateQueries({ queryKey: weighingsKey(ws) });
      return res;
    } catch (e) {
      toast.error(errorMessage(e));
      return null;
    }
  };
  return {
    create: (body: WeighingCreateBody) => run(() => call<{ item: Weighing }>(ws, 'POST', '/weighings', body)),
    update: (id: string, body: WeighingPatchBody) => run(() => call<{ item: Weighing }>(ws, 'PATCH', `/weighings/${id}`, body)),
    remove: (id: string) => run(() => call<{ ok: true }>(ws, 'DELETE', `/weighings/${id}`)),
  };
}
