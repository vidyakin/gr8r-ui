/* Виды цен и прайс-листы на клиенте (задача 1178). Ключи — под ['ws', id, 'docs', 'pricing', …]:
   события документов, товаров и видов цен инвалидируют их вместе с остальными документами. */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { DocumentStatus } from '@gr8r/shared';
import { API_BASE, ok } from '../data/api';
import { call, useWsId } from '../meta/data';

export const pricingKey = (ws: string, ...rest: unknown[]) => ['ws', ws, 'docs', 'pricing', ...rest] as const;

export type PriceMethod = 'manual' | 'derived' | 'cost_based';
export interface PriceKind {
  id: string;
  name: string;
  method: PriceMethod;
  systemKey: string | null;
  baseKindId: string | null;
  baseKindName: string | null;
  markupPct: string;
  costBasis: 'avg_cost' | 'last_purchase' | null;
  roundingStep: string;
  roundingMode: 'math' | 'up';
  roundToNine: boolean;
  includesVat: boolean;
  supplierId: string | null;
  supplierName: string | null;
  updateFromReceipts: boolean;
  archivedAt: string | null;
}
export interface PriceKindBody {
  name: string;
  method?: PriceMethod;
  baseKindId?: string | null;
  markupPct?: string | number;
  costBasis?: 'avg_cost' | 'last_purchase' | null;
  roundingStep?: string;
  roundingMode?: 'math' | 'up';
  roundToNine?: boolean;
  includesVat?: boolean;
  supplierId?: string | null;
  updateFromReceipts?: boolean;
}

export interface ResolveBody {
  productIds: string[];
  date?: string;
  party?: 'customer' | 'supplier';
  priceKindId?: string | null;
  contractId?: string | null;
  counterpartyId?: string | null;
  workOrderKindId?: string | null;
}
export interface ResolveResult {
  priceKindId: string;
  priceKindName: string;
  source: string;
  prices: Record<string, string | null>;
}

export interface ProductPriceRow {
  priceKindId: string;
  name: string;
  method: PriceMethod;
  systemKey: string | null;
  price: string | null;
  source: 'manual' | 'rule' | 'parent' | 'cache' | null;
}
export interface PriceHistoryRow {
  id: string;
  priceKindId: string;
  priceKindName: string;
  date: string;
  price: string;
  documentId: string | null;
  number: string | null;
}

export interface SettingListItem {
  id: string;
  number: string | null;
  date: string;
  status: DocumentStatus;
  comment: string;
  lineCount: number;
}
export interface SettingLine {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  unitCode: string;
  priceKindId: string;
  priceKindName: string;
  price: string;
  oldPrice: string | null;
}
export interface SettingDetail {
  id: string;
  number: string | null;
  date: string;
  status: DocumentStatus;
  organizationId: string;
  comment: string;
  lines: SettingLine[];
}
export interface SettingBody {
  date?: string;
  organizationId?: string | null;
  comment?: string;
  lines?: { id?: string; productId: string; priceKindId: string; price: string }[];
}

export interface PriceListRow {
  productId: string;
  sku: string;
  name: string;
  unit: string;
  categoryId: string | null;
  categoryName: string | null;
  prices: Record<string, string | null>;
  stockQty: string;
}
export interface PriceListData {
  date: string;
  kinds: { id: string; name: string }[];
  total: number;
  items: PriceListRow[];
}
export interface PriceListParams {
  kindIds: string[];
  categoryId?: string;
  date?: string;
  inStock?: boolean;
  q?: string;
}

export interface ImportPreview {
  header: string[];
  columns: { skuColumn: number | null; nameColumn: number | null; priceColumns: { column: number; priceKindId: string }[] };
  summary: { rows: number; matched: number; unmatched: number };
  rows: { rowNo: number; sku: string; name: string; productId: string | null; productName: string | null; matchedBy: 'sku' | 'name' | null; lines: { priceKindId: string; priceKindName: string; price: string; current: string | null }[] }[];
}

export interface PriceLink {
  id: string;
  name: string;
  priceKindIds: string[];
  categoryIds: string[];
  inStockOnly: boolean;
  expiresAt: string | null;
  revokedAt: string | null;
  viewCount: number;
  lastViewedAt: string | null;
  createdAt: string;
}

export interface PublicPriceList {
  title: string;
  company: string;
  date: string;
  kinds: { id: string; name: string }[];
  total: number;
  items: { sku: string; name: string; unit: string; category: string | null; prices: Record<string, string | null>; inStock: boolean }[];
}

const qs = (p: PriceListParams) => {
  const u = new URLSearchParams();
  if (p.kindIds.length) u.set('kindIds', p.kindIds.join(','));
  if (p.categoryId) u.set('categoryId', p.categoryId);
  if (p.date) u.set('date', p.date);
  if (p.inStock) u.set('inStock', 'true');
  if (p.q) u.set('q', p.q);
  return u;
};

export function usePriceKinds(archived = false) {
  const ws = useWsId();
  return useQuery({ queryKey: pricingKey(ws, 'kinds', archived), queryFn: async () => (await call<{ items: PriceKind[] }>(ws, 'GET', `/pricing/kinds${archived ? '?archived=true' : ''}`)).items });
}
export function useProductPrices(productId: string | undefined) {
  const ws = useWsId();
  return useQuery({ queryKey: pricingKey(ws, 'product', productId ?? ''), queryFn: async () => (await call<{ items: ProductPriceRow[] }>(ws, 'GET', `/pricing/products/${productId}/prices`)).items, enabled: !!productId });
}
export function usePriceHistory(productId: string | undefined, enabled: boolean) {
  const ws = useWsId();
  return useQuery({ queryKey: pricingKey(ws, 'history', productId ?? ''), queryFn: async () => (await call<{ items: PriceHistoryRow[] }>(ws, 'GET', `/pricing/products/${productId}/history`)).items, enabled: !!productId && enabled });
}
export function useSettings() {
  const ws = useWsId();
  return useQuery({ queryKey: pricingKey(ws, 'settings'), queryFn: () => call<{ items: SettingListItem[]; total: number }>(ws, 'GET', '/pricing/settings?limit=100') });
}
export function useSetting(id: string | undefined) {
  const ws = useWsId();
  return useQuery({ queryKey: pricingKey(ws, 'setting', id ?? ''), queryFn: () => call<SettingDetail>(ws, 'GET', `/pricing/settings/${id}`), enabled: !!id });
}
export function usePriceList(p: PriceListParams, enabled = true) {
  const ws = useWsId();
  return useQuery({ queryKey: pricingKey(ws, 'list', p), queryFn: () => call<PriceListData>(ws, 'GET', `/pricing/price-list?${qs(p)}&limit=500`), enabled });
}
export function usePriceLinks(enabled: boolean) {
  const ws = useWsId();
  return useQuery({ queryKey: pricingKey(ws, 'links'), queryFn: async () => (await call<{ items: PriceLink[] }>(ws, 'GET', '/pricing/links')).items, enabled });
}

/** Цены для документа по приоритету вида цен на сервере; без ответа интерфейс берёт цену из карточки товара */
export function useResolvePrices() {
  const ws = useWsId();
  return (body: ResolveBody) => call<ResolveResult>(ws, 'POST', '/pricing/resolve', body);
}

/** Публичная страница: без сессии и воркспейса */
export async function fetchPublicPriceList(token: string, q: string): Promise<PublicPriceList> {
  const res = await fetch(`${API_BASE()}/hooks/prices/${encodeURIComponent(token)}?limit=500${q ? `&q=${encodeURIComponent(q)}` : ''}`);
  return ok<PublicPriceList>(res);
}

const toBase64 = async (file: File): Promise<string> => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

export function usePricingApi() {
  const ws = useWsId();
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ['ws', ws, 'docs'] });
  const wrap = async <T>(p: Promise<T>): Promise<T> => {
    const r = await p;
    await refresh();
    return r;
  };
  const download = async (path: string, name: string) => {
    const res = await fetch(`${API_BASE()}${path}`, { credentials: 'include', headers: { 'X-Workspace-Id': ws } });
    if (!res.ok) await ok(res);
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };
  return {
    receipts: async () => (await call<{ items: { id: string; number: string | null; date: string }[] }>(ws, 'GET', '/documents?type=receipt&status=posted&limit=50')).items,
    saveKind: (body: PriceKindBody) => wrap(call<PriceKind>(ws, 'POST', '/pricing/kinds', body)),
    updateKind: (id: string, body: Partial<PriceKindBody>) => wrap(call<PriceKind>(ws, 'PATCH', `/pricing/kinds/${id}`, body)),
    archiveKind: (id: string) => wrap(call(ws, 'DELETE', `/pricing/kinds/${id}`)),
    saveSetting: (body: SettingBody) => wrap(call<SettingDetail>(ws, 'POST', '/pricing/settings', body)),
    updateSetting: (id: string, body: SettingBody) => wrap(call<SettingDetail>(ws, 'PATCH', `/pricing/settings/${id}`, body)),
    fillSetting: (id: string, body: { mode: 'all' | 'category' | 'receipt'; priceKindIds: string[]; categoryId?: string | null; receiptId?: string | null }) => wrap(call<SettingDetail>(ws, 'POST', `/pricing/settings/${id}/fill`, body)),
    massSetting: (id: string, body: Record<string, unknown>) => wrap(call<SettingDetail & { changed: number }>(ws, 'POST', `/pricing/settings/${id}/mass`, body)),
    action: (id: string, action: 'post' | 'unpost') => wrap(call(ws, 'POST', `/documents/${id}/${action}`)),
    remove: (id: string) => wrap(call(ws, 'DELETE', `/documents/${id}`)),
    createLink: (body: { name: string; priceKindIds: string[]; categoryIds: string[]; inStockOnly: boolean; expiresAt?: string | null }) => wrap(call<{ id: string; token: string; path: string }>(ws, 'POST', '/pricing/links', body)),
    revokeLink: (id: string) => wrap(call(ws, 'DELETE', `/pricing/links/${id}`)),
    importPreview: async (file: File) => call<ImportPreview>(ws, 'POST', '/pricing/import/preview', { fileName: file.name, data: await toBase64(file) }),
    importApply: async (file: File) => wrap(call<{ id: string; lines: number; skipped: number }>(ws, 'POST', '/pricing/import/apply', { fileName: file.name, data: await toBase64(file) })),
    exportFile: (p: PriceListParams, format: 'xlsx' | 'csv') => download(`/pricing/price-list/export?${qs(p)}&format=${format}`, `price-list.${format}`),
    /** Печатная форма (HTML) открывается в новой вкладке, PDF — печатью из браузера */
    openPrint: async (p: PriceListParams) => {
      const res = await fetch(`${API_BASE()}/pricing/price-list/print?${qs(p)}`, { credentials: 'include', headers: { 'X-Workspace-Id': ws } });
      if (!res.ok) await ok(res);
      window.open(URL.createObjectURL(new Blob([await res.text()], { type: 'text/html;charset=utf-8' })), '_blank');
    },
  };
}
