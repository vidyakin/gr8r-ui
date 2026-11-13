/* Прайсы поставщиков на клиенте (docs/superpowers/specs/2026-11-11-supplier-price-upload-design.md).
   Ключи — ['ws', id, 'supplier-prices', …]: событие supplier_price* (data/realtime.ts) обновляет их все. */
import { useQuery } from '@tanstack/react-query';
import { API_BASE, ok } from '../data/api';
import { call, useWsId } from '../meta/data';

export const supplierPricesKey = (ws: string, ...rest: unknown[]) => ['ws', ws, 'supplier-prices', ...rest] as const;

export interface SupplierProfile {
  id: string;
  companyId: string;
  name: string;
  firstRow: number;
  articleCol: number;
  nameCol: number | null;
  priceCol: number;
  unitCol: number | null;
}
export type SupplierProfileBody = Omit<SupplierProfile, 'id'> & { id?: string };

export type SupplierLineStatus = 'matched' | 'unmatched' | 'conflict' | 'skipped';

export interface SupplierPrice {
  id: string;
  companyId: string;
  profileId: string;
  name: string;
  kindId: string;
  date: string;
  status: 'draft' | 'applied';
  pricesIncludeVat: boolean;
  attachmentId: string | null;
  fileName: string;
  fileSize: number;
  linesTotal: number;
  linesMatched: number;
  linesUnmatched: number;
  linesConflict: number;
  createdAt: string;
  appliedAt: string | null;
}
export interface SupplierPriceLine {
  id: string;
  priceId: string;
  rowNo: number;
  article: string;
  name: string;
  unitCode: string | null;
  price: string | null;
  productId: string | null;
  status: SupplierLineStatus;
  note: string;
  candidates: string[];
}
export interface SupplierProductRef {
  id: string;
  name: string;
  sku: string;
}
export interface SupplierPriceDetail {
  price: SupplierPrice;
  lines: SupplierPriceLine[];
  products: SupplierProductRef[];
}
export interface ProfilePreview {
  fileName: string;
  totalRows: number;
  columns: number;
  rows: string[][];
}
export interface SupplierApplyItem {
  lineId: string;
  rowNo: number;
  productId: string;
  productName: string;
  article: string;
  current: string | null;
  next: string | null;
  warning: 'vat_rate_none' | null;
}
export interface SupplierApplyPreview {
  priceId: string;
  kindId: string;
  kindName: string;
  date: string;
  items: SupplierApplyItem[];
}
export interface SupplierApplyResult {
  price: SupplierPrice;
  applied: number;
  skipped: SupplierApplyItem[];
}

export function useSupplierProfiles(companyId: string) {
  const ws = useWsId();
  return useQuery({ queryKey: supplierPricesKey(ws, 'profiles', companyId), queryFn: async () => (await call<{ items: SupplierProfile[] }>(ws, 'GET', `/pricing/supplier-profiles?companyId=${companyId}`)).items });
}
export function useSupplierPrices(companyId: string) {
  const ws = useWsId();
  return useQuery({ queryKey: supplierPricesKey(ws, 'list', companyId), queryFn: async () => (await call<{ items: SupplierPrice[] }>(ws, 'GET', `/pricing/supplier-prices?companyId=${companyId}`)).items });
}
/** Прайс со всеми строками: фильтр по статусу и счётчики считаются на клиенте */
export function useSupplierPriceDetail(id: string | undefined) {
  const ws = useWsId();
  return useQuery({ queryKey: supplierPricesKey(ws, 'detail', id ?? ''), enabled: !!id, queryFn: () => call<SupplierPriceDetail>(ws, 'GET', `/pricing/supplier-prices/${id}`) });
}
export function useSupplierApplyPreview(id: string, enabled: boolean) {
  const ws = useWsId();
  return useQuery({ queryKey: supplierPricesKey(ws, 'apply-preview', id), enabled, gcTime: 0, queryFn: () => call<SupplierApplyPreview>(ws, 'GET', `/pricing/supplier-prices/${id}/preview-apply`) });
}

/** Мутации: multipart без JSON-заголовка, остальное — обычный call */
export function useSupplierPricesApi() {
  const ws = useWsId();
  const form = <T,>(path: string, f: FormData) => ok<T>(fetch(`${API_BASE()}${path}`, { method: 'POST', credentials: 'include', headers: { 'X-Workspace-Id': ws }, body: f }));
  return {
    previewFile: (file: File) => {
      const f = new FormData();
      f.set('file', file);
      return form<ProfilePreview>('/pricing/supplier-profiles/preview', f);
    },
    saveProfile: (b: SupplierProfileBody) => call<SupplierProfile>(ws, 'POST', '/pricing/supplier-profiles', b),
    deleteProfile: (id: string) => call(ws, 'DELETE', `/pricing/supplier-profiles/${id}`),
    upload: (b: { companyId: string; profileId: string; date: string; pricesIncludeVat: boolean; name: string; file: File }) => {
      const f = new FormData();
      f.set('companyId', b.companyId);
      f.set('profileId', b.profileId);
      f.set('date', b.date);
      f.set('pricesIncludeVat', b.pricesIncludeVat ? 'true' : 'false');
      if (b.name.trim()) f.set('name', b.name.trim());
      f.set('file', b.file);
      return form<{ price: SupplierPrice; lines: SupplierPriceLine[] }>('/pricing/supplier-prices/upload', f);
    },
    deletePrice: (id: string) => call(ws, 'DELETE', `/pricing/supplier-prices/${id}`),
    patchLine: (id: string, lineId: string, body: { productId?: string; skip?: boolean }) => call(ws, 'PATCH', `/pricing/supplier-prices/${id}/lines/${lineId}`, body),
    matchByName: (id: string, lineIds?: string[]) => call<{ matched: number; ambiguous: number; notFound: number }>(ws, 'POST', `/pricing/supplier-prices/${id}/match-by-name`, { lineIds }),
    createProducts: (id: string, lineIds?: string[]) => call<{ created: number; skipped: number }>(ws, 'POST', `/pricing/supplier-prices/${id}/create-products`, { lineIds }),
    apply: (id: string, date?: string) => call<SupplierApplyResult>(ws, 'POST', `/pricing/supplier-prices/${id}/apply`, { date }),
    /** Скачивание исходного файла прайса (вложение) */
    download: async (attachmentId: string, name: string) => {
      const res = await fetch(`${API_BASE()}/attachments/${attachmentId}/content`, { credentials: 'include', headers: { 'X-Workspace-Id': ws } });
      if (!res.ok) throw new Error(String(res.status));
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
  };
}
