/* Серийные номера, изделия в ремонте и материалы заказчика на клиенте (задача 1099). Запросы лежат под ключом docs:
   realtime помечает его устаревшим по событиям document / product / company. */
import { useQuery } from '@tanstack/react-query';
import type { SerialStatus } from '@gr8r/shared';
import { call, useWsId } from '../meta/data';
import { docsKey } from './data';

export interface SerialItem {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  serial: string;
  status: SerialStatus;
  warehouseId: string | null;
  warehouseName: string | null;
  soldAt: string | null;
  soldDocumentId: string | null;
  ownerCompanyId: string | null;
  ownerName: string | null;
  warrantyUntil: string | null;
  note: string;
}

export function useSerials(params: { q?: string; status?: string; productId?: string; warehouseId?: string; limit?: number }, enabled = true) {
  const ws = useWsId();
  return useQuery({
    queryKey: docsKey(ws, 'serials', params),
    queryFn: () => {
      const sp = new URLSearchParams({ limit: String(params.limit ?? 200) });
      for (const k of ['q', 'status', 'productId', 'warehouseId'] as const) if (params[k]) sp.set(k, params[k]!);
      return call<{ items: SerialItem[]; total: number }>(ws, 'GET', `/serials?${sp}`);
    },
    enabled,
    staleTime: Infinity,
    placeholderData: prev => prev,
  });
}

export interface SerialCard extends SerialItem {
  warrantyActive: boolean;
  soldDocumentNumber: string | null;
  events: { id: string; documentId: string; documentNumber: string | null; documentType: string; direction: 'in' | 'out'; movedAt: string; warehouseName: string | null; counterpartyName: string | null; statusAfter: SerialStatus; warrantyUntil: string | null }[];
  repairs: { id: string; documentId: string; documentNumber: string | null; date: string; state: string | null; defect: string; receivedAt: string | null; returnedAt: string | null }[];
}

export function useSerialCard(id: string | null) {
  const ws = useWsId();
  return useQuery({ queryKey: docsKey(ws, 'serial', id), queryFn: () => call<SerialCard>(ws, 'GET', `/serials/${id}`), enabled: !!id, staleTime: Infinity });
}

export interface SerialLookupHit {
  serialId: string;
  productId: string;
  productName: string;
  serial: string;
  status: SerialStatus;
  soldAt: string | null;
  ownerName: string | null;
  soldDocumentNumber: string | null;
  warrantyUntil: string | null;
  warrantyActive: boolean;
}

/** Проверка гарантии по номеру (пустой номер не запрашивается) */
export function useSerialLookup(serial: string) {
  const ws = useWsId();
  const s = serial.trim();
  return useQuery({ queryKey: docsKey(ws, 'serial-lookup', s), queryFn: async () => (await call<{ items: SerialLookupHit[] }>(ws, 'GET', `/serials/lookup?serial=${encodeURIComponent(s)}`)).items, enabled: s.length > 0, staleTime: Infinity });
}

export interface LineSerial {
  lineId: string | null;
  materialId: string | null;
  serial: string;
  serialId: string | null;
  status: SerialStatus | null;
  warrantyUntil: string | null;
}

export interface RepairItem {
  id: string;
  documentId: string;
  productId: string | null;
  productName: string | null;
  name: string;
  serialId: string | null;
  serialText: string;
  registrySerial: string | null;
  defect: string;
  completeness: string;
  appearance: string;
  receivedAt: string | null;
  returnedAt: string | null;
  outsourceCompanyId: string | null;
  outsourceName: string | null;
  outsourcedAt: string | null;
  outsourceReturnedAt: string | null;
}

export function useRepairItem(documentId: string, enabled: boolean) {
  const ws = useWsId();
  return useQuery({ queryKey: docsKey(ws, 'repair-item', documentId), queryFn: async () => (await call<{ item: RepairItem | null }>(ws, 'GET', `/work-orders/${documentId}/repair`)).item, enabled, staleTime: Infinity });
}

export interface CustomerMaterial {
  id: string;
  productId: string | null;
  productName: string | null;
  name: string;
  qty: string;
  comment: string;
}

export function useCustomerMaterials(documentId: string) {
  const ws = useWsId();
  return useQuery({ queryKey: docsKey(ws, 'customer-materials', documentId), queryFn: async () => (await call<{ items: CustomerMaterial[] }>(ws, 'GET', `/work-orders/${documentId}/customer-materials`)).items, staleTime: Infinity });
}

export interface RepairListItem extends RepairItem {
  documentNumber: string | null;
  documentDate: string;
  documentStatus: string;
  stateLabel: string | null;
  kindName: string | null;
  kindType: 'repair' | 'warranty' | 'regular';
  counterpartyId: string | null;
  counterpartyName: string | null;
  atPartner: boolean;
}

export function useRepairItems(params: { q?: string; open?: '1' | '0' }) {
  const ws = useWsId();
  return useQuery({
    queryKey: docsKey(ws, 'repair-items', params),
    queryFn: () => {
      const sp = new URLSearchParams({ limit: '200' });
      if (params.q) sp.set('q', params.q);
      if (params.open) sp.set('open', params.open);
      return call<{ items: RepairListItem[]; total: number }>(ws, 'GET', `/repair-items?${sp}`);
    },
    staleTime: Infinity,
    placeholderData: prev => prev,
  });
}
