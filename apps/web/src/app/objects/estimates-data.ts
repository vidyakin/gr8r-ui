/* Смета объекта на клиенте (задача 1269): основная смета и допработы, редактор позиций, импорт строк, заказы.
   Запросы живут под ['ws', id, 'objects', 'estimates', …]: событие object_estimate.* сбрасывает их через realtime.
   Себестоимость и маржа приходят с сервера как null для участников без права видеть стоимость. */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { EstimateAiResult, EstimateImportExtract, EstimateItemKind } from '@gr8r/shared';
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
  /** Единая наценка, %: null — не задана или нет права видеть себестоимость */
  markupPct: string | null;
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
  /** Поставщик и замок строки: null — нет права видеть себестоимость */
  supplierId: string | null;
  locked: boolean | null;
  laborHours: string;
  /** Выполненный объём (задача 1272): факт, правится и у согласованной сметы */
  doneQty: string;
  manufacturedItemId: string | null;
  manufacturedItemName: string | null;
  /** Заказы на производство, созданные из строки */
  productionOrders: { id: string; number: string | null }[];
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
  supplierId?: string | null;
  locked?: boolean;
  laborHours?: string;
  /** Выполненный объём: не больше qty (422 done_qty_exceeds) */
  doneQty?: string;
  manufacturedItemId?: string | null;
  note?: string;
}

export interface EstimateContentBody {
  sections: { id?: string; name: string }[];
  items: EstimateItemInput[];
  /** Единая наценка: null — снять, не указана — не менять (только owner/admin) */
  markupPct?: string | null;
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

/** Ответ POST /estimates/import/document: pdf — ready (разобран, ждёт выбора страниц), docx — pending (задача ИИ) */
export interface EstimateImportDocCreated {
  id: string;
  status: 'ready' | 'pending' | 'done' | 'failed';
  pageCount?: number;
  pdfType?: string;
  hasText?: boolean;
}

/** Ответ GET /estimates/import/:id: таблица документа (у pdf строки помечены страницами) и разметка ИИ (null — fallback на сопоставление колонок) */
export interface EstimateImportDocStatus {
  id: string;
  status: 'ready' | 'pending' | 'done' | 'failed';
  fileName: string;
  table: { header: string[]; rows: string[][]; rowPages?: number[] };
  aiResult: EstimateAiResult | null;
  aiError: string | null;
  job?: {
    status: 'queued' | 'running' | 'done' | 'failed';
    attempt: number;
    maxAttempts: number;
    retryAt: string;
    error: string | null;
  } | null;
  error: string | null;
  hint: string | null;
  meta: Record<string, unknown> | null;
}

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
    // себестоимость из цен поставщика (только owner/admin): товаров без цены в ответе нет
    supplierPrices: (supplierId: string, productIds: string[]) => call<{ items: { productId: string; price: string }[] }>(ws, 'POST', '/estimates/supplier-prices', { supplierId, productIds }),
    approve: (id: string) => wrap(call<EstimateDetail>(ws, 'POST', `/estimates/${id}/approve`)),
    unapprove: (id: string) => wrap(call<EstimateDetail>(ws, 'POST', `/estimates/${id}/unapprove`)),
    addChange: (id: string, body: { name: string; note?: string }) => wrap(call<EstimateDetail>(ws, 'POST', `/estimates/${id}/changes`, body)),
    importRows: (id: string, rows: EstimateImportRow[]) => wrap(call<EstimateDetail>(ws, 'POST', `/estimates/${id}/import`, { rows })),
    importPreview: async (file: File) => call<{ header: string[]; rows: string[][] }>(ws, 'POST', '/estimates/import/preview', { fileName: file.name, data: await toBase64(file) }),
    // docx/pdf: docx размечается сразу, pdf — после выбора страниц и подсказки (extractDocument)
    importDocument: async (file: File, estimateId: string) => call<EstimateImportDocCreated>(ws, 'POST', '/estimates/import/document', { fileName: file.name, data: await toBase64(file), estimateId }),
    importDocStatus: (id: string) => call<EstimateImportDocStatus>(ws, 'GET', `/estimates/import/${id}`),
    // исходный markdown (pdf): «документ как его видит разбор» — грузится лениво, отдельно от статуса
    importDocSource: (id: string) => call<{ pages: { page: number; markdown: string }[] }>(ws, 'GET', `/estimates/import/${id}/source`),
    // запуск разметки pdf: фильтр строк по страницам + подсказка для ИИ → задача estimate.ai_extract
    extractDocument: (id: string, input: EstimateImportExtract) =>
      call<{ id: string; status: string }>(ws, 'POST', `/estimates/import/${id}/extract`, input),
    supplierOrder: (id: string, body: { supplierId: string; comment?: string }) => wrap(call<{ id: string; lines: number }>(ws, 'POST', `/estimates/${id}/supplier-order`, body)),
    productionOrder: (id: string, body: { comment?: string; itemIds?: string[]; lines?: { estimateItemId: string; manufacturedItemId: string; qty: string; params?: Record<string, unknown> }[] }) => wrap(call<{ id: string; lines: number }>(ws, 'POST', `/estimates/${id}/production-order`, body)),
    copyFrom: (objectId: string, body: { estimateId: string; name?: string }) => wrap(call<EstimateDetail>(ws, 'POST', `/objects/${objectId}/estimates/copy`, body)),
  };
}
