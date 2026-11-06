/* Смета объекта на клиенте (задача 1269): основная смета и допработы, редактор позиций, импорт строк, заказы.
   Запросы живут под ['ws', id, 'objects', 'estimates', …]: событие object_estimate.* сбрасывает их через realtime.
   Себестоимость и маржа приходят с сервера как null для участников без права видеть стоимость. */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { EstimateItemKind } from '@gr8r/shared';
import { call, useWsId } from '../meta/data';

export type EstimateKind = 'main' | 'change';
export type EstimateStatus = 'draft' | 'approved';
export type EstimateChangeStatus = 'draft' | 'approved' | 'rejected';

export interface EstimateTotals {
  revenue: string;
  /** null — нет права видеть себестоимость */
  cost: string | null;
  hours: string;
  margin: string | null;
  marginPct: string | null;
}

export interface EstimateSummary {
  id: string;
  objectId: string;
  number: string;
  name: string;
  status: EstimateStatus;
  approvedAt: string | null;
  approvedByName: string | null;
  parentId: string | null;
  kind: EstimateKind;
  changeStatus: EstimateChangeStatus | null;
  note: string;
  createdAt: string;
  updatedAt: string;
  totals: EstimateTotals;
  itemCount: number;
  sectionCount: number;
}

export interface EstimateSection {
  id: string;
  estimateId: string;
  name: string;
  sortOrder: number;
}

export interface EstimateItem {
  id: string;
  estimateId: string;
  sectionId: string | null;
  sortOrder: number;
  kind: EstimateItemKind;
  name: string;
  productId: string | null;
  productName: string | null;
  unitCode: string;
  qty: string;
  price: string;
  vatRate: string;
  /** null — нет права видеть себестоимость */
  costPrice: string | null;
  laborHours: string;
  /** Выполненный объём (задача 1272): факт, правится и у согласованной сметы */
  doneQty: string;
  manufacturedItemId: string | null;
  manufacturedItemName: string | null;
  note: string;
  totals: { revenue: string; cost: string | null; hours: string };
}

export interface EstimatPlanFactRow {
  id: string | null;
  plan: { revenue: string; cost: string | null; hours: string };
  fact: { revenue: string; cost: string | null; hours: string };
  remaining: { revenue: string; cost: string | null; hours: string };
}

export interface EstimateDetail extends EstimateSummary {
  sections: EstimateSection[];
  items: EstimateItem[];
  planFact: EstimatPlanFactRow[];
  parent: { id: string; number: string; name: string; status: EstimateStatus } | null;
  canSeeCost: boolean;
}

export interface EstimateItemInput {
  id?: string;
  sectionId?: string | null;
  kind: EstimateItemKind;
  name: string;
  productId?: string | null;
  unitCode: string;
  qty: string;
  price: string;
  vatRate?: string;
  costPrice?: string;
  laborHours?: string;
  /** Выполненный объём: не больше qty (422 done_qty_exceeds) */
  doneQty?: string;
  manufacturedItemId?: string | null;
  note?: string;
}

export interface EstimateContentBody {
  sections: { id?: string; name: string }[];
  items: EstimateItemInput[];
}

/** Строка импорта: колонки уже сопоставлены в диалоге */
export interface EstimateImportRow {
  section?: string;
  kind?: EstimateItemKind;
  name: string;
  unit?: string;
  qty: string;
  price: string;
  costPrice?: string;
  laborHours?: string;
}

export const estimatesKey = (ws: string, ...rest: unknown[]) => ['ws', ws, 'objects', 'estimates', ...rest] as const;

/** Сметы объекта: основная первой, затем допработы */
export function useObjectEstimates(objectId: string | undefined) {
  const ws = useWsId();
  return useQuery({
    queryKey: estimatesKey(ws, 'list', objectId),
    queryFn: async () => (await call<{ items: EstimateSummary[] }>(ws, 'GET', `/objects/${objectId}/estimates`)).items,
    enabled: !!objectId,
  });
}

/** Карточка сметы с разделами, позициями и план-фактом */
export function useEstimate(id: string | undefined) {
  const ws = useWsId();
  return useQuery({
    queryKey: estimatesKey(ws, 'detail', id),
    queryFn: () => call<EstimateDetail>(ws, 'GET', `/estimates/${id}`),
    enabled: !!id,
  });
}

const toBase64 = async (file: File): Promise<string> => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

export function useEstimateApi() {
  const ws = useWsId();
  const qc = useQueryClient();
  const refresh = async () => {
    await qc.invalidateQueries({ queryKey: ['ws', ws, 'objects'] });
    await qc.invalidateQueries({ queryKey: ['ws', ws, 'docs'] });
  };
  const wrap = async <T>(p: Promise<T>): Promise<T> => {
    const r = await p;
    await refresh();
    return r;
  };
  return {
    create: (objectId: string, body: { name: string; number?: string; note?: string }) => wrap(call<EstimateDetail>(ws, 'POST', `/objects/${objectId}/estimates`, body)),
    save: (id: string, body: Partial<{ name: string; number: string; note: string }>) => wrap(call<EstimateDetail>(ws, 'PATCH', `/estimates/${id}`, body)),
    remove: (id: string) => wrap(call(ws, 'DELETE', `/estimates/${id}`)),
    saveItems: (id: string, body: EstimateContentBody) => wrap(call<EstimateDetail>(ws, 'PUT', `/estimates/${id}/items`, body)),
    // выполненные объёмы — отдельным запросом: это факт, а не состав, и правится у согласованной сметы
    saveDoneQty: (id: string, items: { id: string; doneQty: string }[]) => wrap(call<EstimateDetail>(ws, 'PATCH', `/estimates/${id}/done-qty`, { items })),
    approve: (id: string) => wrap(call<EstimateDetail>(ws, 'POST', `/estimates/${id}/approve`)),
    unapprove: (id: string) => wrap(call<EstimateDetail>(ws, 'POST', `/estimates/${id}/unapprove`)),
    addChange: (id: string, body: { name: string; note?: string }) => wrap(call<EstimateDetail>(ws, 'POST', `/estimates/${id}/changes`, body)),
    importRows: (id: string, rows: EstimateImportRow[]) => wrap(call<EstimateDetail>(ws, 'POST', `/estimates/${id}/import`, { rows })),
    importPreview: async (file: File) => call<{ header: string[]; rows: string[][] }>(ws, 'POST', '/estimates/import/preview', { fileName: file.name, data: await toBase64(file) }),
    supplierOrder: (id: string, body: { supplierId: string; comment?: string }) => wrap(call<{ id: string; lines: number }>(ws, 'POST', `/estimates/${id}/supplier-order`, body)),
    productionOrder: (id: string, body: { comment?: string }) => wrap(call<{ id: string; lines: number }>(ws, 'POST', `/estimates/${id}/production-order`, body)),
    copyFrom: (objectId: string, body: { estimateId: string; name?: string }) => wrap(call<EstimateDetail>(ws, 'POST', `/objects/${objectId}/estimates/copy`, body)),
  };
}
