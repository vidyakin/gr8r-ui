/* Доставка на клиенте (задача 1100): способы, доставка документа, список, «мои доставки», отчёт, курьеры.
   Ключи кэша под ['ws', id, 'docs', 'delivery', …]: события delivery / document обновляют их вместе с журналами. */
import { useQuery } from '@tanstack/react-query';
import type { DeliveryKind, DeliveryRateInput, DeliveryStatus } from '@gr8r/shared';
import { API_BASE } from '../data/api';
import { call, useWsId } from '../meta/data';
import { docsKey } from './data';

export interface DeliveryMethod {
  id: string;
  name: string;
  kind: DeliveryKind;
  productId: string | null;
  productName: string | null;
  carrierCompanyId: string | null;
  carrierName: string | null;
  clientRate: DeliveryRateInput;
  costRate: DeliveryRateInput;
  freeFrom: string | null;
  archivedAt: string | null;
}

export function useDeliveryMethods(archived: 'exclude' | 'include' = 'exclude') {
  const ws = useWsId();
  return useQuery({ queryKey: docsKey(ws, 'delivery', 'methods', archived), queryFn: async () => (await call<{ items: DeliveryMethod[] }>(ws, 'GET', `/delivery-methods?archived=${archived}`)).items, staleTime: Infinity });
}

export interface DeliveryItem {
  id: string;
  documentId: string;
  originDocumentId: string | null;
  methodId: string | null;
  methodName: string | null;
  address: string;
  contactName: string;
  contactPhone: string;
  deliveryDate: string | null;
  windowFrom: string | null;
  windowTo: string | null;
  distanceKm: string;
  /** Координаты адреса (задача 1213): геокодер в фоне или вручную */
  lat: string | null;
  lon: string | null;
  geoSource: 'manual' | 'geocoder' | null;
  geoStatus: 'pending' | 'ok' | 'approx' | 'not_found' | 'error' | null;
  weightKg: string;
  price: string;
  /** Себестоимость и расход — только admin и owner */
  ourCost: string | null;
  expenseAmount: string | null;
  expensedAt: string | null;
  courierMemberId: string | null;
  courierName: string | null;
  carrierCompanyId: string | null;
  carrierName: string | null;
  status: DeliveryStatus;
  comment: string;
  lineId: string | null;
  documentType: string;
  documentNumber: string | null;
  documentDate: string;
  documentTotal: string;
  counterpartyName: string | null;
}

export interface DocumentDelivery {
  delivery: DeliveryItem | null;
  movedTo: { id: string; documentId: string; type: string; number: string | null; status: string } | null;
}

export function useDocumentDelivery(documentId: string | undefined, enabled = true) {
  const ws = useWsId();
  return useQuery({ queryKey: docsKey(ws, 'delivery', 'doc', documentId), queryFn: () => call<DocumentDelivery>(ws, 'GET', `/deliveries/by-document/${documentId}`), enabled: !!documentId && enabled, staleTime: Infinity });
}

export interface DeliveryFilter {
  from?: string | undefined;
  to?: string | undefined;
  courierId?: string | undefined;
  methodId?: string | undefined;
  status?: string | undefined;
  q?: string | undefined;
}

export function useDeliveries(filter: DeliveryFilter) {
  const ws = useWsId();
  return useQuery({
    queryKey: docsKey(ws, 'delivery', 'list', filter),
    queryFn: () => {
      const sp = new URLSearchParams({ limit: '200' });
      for (const [k, v] of Object.entries(filter)) if (v) sp.set(k, v);
      return call<{ items: DeliveryItem[]; total: number }>(ws, 'GET', `/deliveries?${sp}`);
    },
    staleTime: Infinity,
    placeholderData: prev => prev,
  });
}

export function useMyDeliveries(date: string) {
  const ws = useWsId();
  return useQuery({ queryKey: docsKey(ws, 'delivery', 'mine', date), queryFn: () => call<{ items: DeliveryItem[]; total: number }>(ws, 'GET', `/deliveries/mine?date=${date}`), staleTime: Infinity });
}

export interface Courier {
  id: string;
  name: string;
}

export function useCouriers() {
  const ws = useWsId();
  return useQuery({ queryKey: docsKey(ws, 'delivery', 'couriers'), queryFn: async () => (await call<{ items: Courier[] }>(ws, 'GET', '/deliveries/couriers')).items, staleTime: Infinity });
}

export interface DeliveryReportRow {
  key: string;
  label: string;
  count: number;
  delivered: number;
  failed: number;
  revenue: string;
  cost: string | null;
  margin: string | null;
  failedPct: string | null;
}

export interface DeliveryReportData {
  from: string;
  to: string;
  by: string;
  rows: DeliveryReportRow[];
  totals: Omit<DeliveryReportRow, 'key' | 'label'>;
}

export function useDeliveryReport(q: { from: string; to: string; by: string }) {
  const ws = useWsId();
  return useQuery({ queryKey: docsKey(ws, 'delivery', 'report', q), queryFn: () => call<DeliveryReportData>(ws, 'GET', `/deliveries/report?from=${q.from}&to=${q.to}&by=${q.by}`), staleTime: Infinity, placeholderData: prev => prev });
}

/** Маршрутный лист: страница с сервера открывается в новой вкладке и сразу печатается */
export async function openRouteSheet(ws: string, courierId: string | null, date: string): Promise<void> {
  const sp = new URLSearchParams({ date });
  if (courierId) sp.set('courierId', courierId);
  const r = await fetch(`${API_BASE()}/deliveries/route-sheet?${sp}`, { credentials: 'include', headers: { 'X-Workspace-Id': ws } });
  if (!r.ok) {
    const body = await r.json().catch(() => null);
    throw new Error(body?.error?.message ?? `Request failed (${r.status})`);
  }
  const url = URL.createObjectURL(new Blob([await r.text()], { type: 'text/html;charset=utf-8' }));
  const w = window.open(url, '_blank');
  if (w) w.addEventListener('load', () => w.print());
}
