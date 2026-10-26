/* Документ «Распределение материалов» на клиенте (задача 1135): журнал, карточка и действия.
   Ключи лежат под `production`, поэтому событие документа обновляет их вместе с остальным производством. */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { DocumentStatus } from '@gr8r/shared';
import { call, useWsId } from '../meta/data';

export interface AllocationListItem {
  id: string;
  number: string | null;
  date: string;
  status: DocumentStatus;
  comment: string;
  periodFrom: string | null;
  periodTo: string | null;
  workCenterName: string | null;
}

export interface AllocationLine {
  id: string;
  productId: string;
  name: string;
  unitCode: string;
  qty: string;
}

export interface AllocationDetail {
  id: string;
  number: string | null;
  date: string;
  status: DocumentStatus;
  comment: string;
  workCenterId: string | null;
  warehouseId: string | null;
  workCenter: { id: string; name: string } | null;
  warehouse: { id: string; name: string } | null;
  periodFrom: string;
  periodTo: string;
  lines: AllocationLine[];
  /** Вкладка «Продукция»: позиции выпусков */
  items: { itemId: string; releaseId: string; number: string | null; date: string; name: string; qty: string }[];
  /** Таблица «Распределение»: стоимость — после проведения, видят admin и owner */
  rows: { id: string; releaseId: string; releaseItemId: string; productId: string; productName: string; releaseNumber: string | null; itemName: string; qty: string; cost: string | null }[];
}

export interface AllocationBody {
  workCenterId?: string;
  warehouseId?: string | null;
  date?: string;
  /** Начало периода; конец — всегда дата документа */
  periodFrom?: string;
  comment?: string;
  lines?: { id?: string; productId: string; qty: string }[];
  items?: { releaseItemId: string }[];
  rows?: { releaseItemId: string; productId: string; qty: string }[];
}

const key = (ws: string, ...rest: unknown[]) => ['ws', ws, 'production', 'material-allocations', ...rest] as const;

export function useAllocations(params: { q?: string } = {}) {
  const ws = useWsId();
  const sp = new URLSearchParams({ limit: '200' });
  if (params.q) sp.set('q', params.q);
  return useQuery({ queryKey: key(ws, 'list', params.q ?? ''), queryFn: () => call<{ items: AllocationListItem[]; total: number }>(ws, 'GET', `/material-allocations?${sp}`) });
}

export function useAllocation(id: string | undefined) {
  const ws = useWsId();
  return useQuery({ queryKey: key(ws, 'doc', id ?? ''), queryFn: () => call<AllocationDetail>(ws, 'GET', `/material-allocations/${id}`), enabled: !!id });
}

export function useAllocationApi() {
  const ws = useWsId();
  const qc = useQueryClient();
  const run = async (method: 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown) => {
    const r = await call<AllocationDetail>(ws, method, `/material-allocations${path}`, body);
    await qc.invalidateQueries({ queryKey: key(ws) });
    // остатки и себестоимость выпусков меняются проведением
    await qc.invalidateQueries({ queryKey: ['ws', ws, 'docs'] });
    return r;
  };
  return {
    create: (body: AllocationBody & { workCenterId: string }) => run('POST', '', body),
    update: (id: string, body: AllocationBody) => run('PATCH', `/${id}`, body),
    fillByNorms: (id: string) => run('POST', `/${id}/fill-by-norms`),
    fillItems: (id: string) => run('POST', `/${id}/fill-items`),
    distribute: (id: string, method: 'norms' | 'qty') => run('POST', `/${id}/distribute`, { method }),
    fillByStock: (id: string) => run('POST', `/${id}/fill-by-stock`),
    post: (id: string) => run('POST', `/${id}/post`),
    unpost: (id: string) => run('POST', `/${id}/unpost`),
    remove: async (id: string) => {
      await call(ws, 'DELETE', `/material-allocations/${id}`);
      await qc.invalidateQueries({ queryKey: key(ws) });
    },
  };
}
