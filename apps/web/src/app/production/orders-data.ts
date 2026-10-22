/* Заказы на производство и выпуск на клиенте: список заказов, карточка заказа и действия над ними.
   Данные лежат в кэше TanStack Query под ключом ['ws', id, 'production-orders', …]. */
import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PRODUCTION_ORDER_STATES, type DocumentStatus } from '@gr8r/shared';
import { toast } from '@/components/ui';
import { errorMessage } from '../data/api';
import { call, useWsId } from '../meta/data';
import { uuidv7 } from '../lib/uuid';

export interface ProductionOrderItem {
  id: string;
  itemId: string;
  qty: string;
  unitCode: string;
  customerOrderLineId: string | null;
  sourceItemId: string | null;
  documentLineId: string | null;
  name: string;
  productId: string | null;
  /** Сколько уже выпущено по позиции */
  produced: string;
  plannedUnitCost: string | null;
}

export interface ProductionComponent {
  id: string;
  documentId: string;
  itemId: string | null;
  kind: 'material' | 'semi' | 'work';
  productId: string | null;
  workCenterId: string | null;
  operation: string;
  qty: string;
  hours: string;
  rate: string | null;
  fixedCost: string | null;
  plannedCost: string | null;
  actualQty: string | null;
  actualCost: string | null;
  documentLineId: string | null;
}

export interface ProductionOrderListItem {
  id: string;
  number: string | null;
  date: string;
  status: DocumentStatus;
  state: string | null;
  comment: string;
  workCenterName: string | null;
  plannedStart: string | null;
  plannedEnd: string | null;
  itemCount: number;
  total: string;
}

export interface ProductionOrderDetail extends ProductionOrderListItem {
  workCenter: { id: string; name: string } | null;
  items: ProductionOrderItem[];
  components: ProductionComponent[];
  outputs: { id: string; number: string | null; status: DocumentStatus; date: string }[];
  warehouseId: string | null;
  targetWarehouseId: string | null;
}

export const STATE_LABEL: Record<string, string> = Object.fromEntries(PRODUCTION_ORDER_STATES.map(s => [s.key, s.label]));
export const STATE_TONE: Record<string, 'gray' | 'accent' | 'green' | 'neutral'> = { planned: 'gray', in_progress: 'accent', done: 'green', closed: 'neutral' };

export const ordersKey = (ws: string, ...rest: unknown[]) => ['ws', ws, 'production-orders', ...rest] as const;

/** Строка обеспечения материала заказа на производство */
export interface MaterialCoverageRow {
  componentId: string;
  productId: string;
  productName: string;
  unitCode: string;
  kind: 'material' | 'semi';
  /** Нужно по заказу */
  need: string;
  /** Списано выпусками */
  written: string;
  /** Осталось обеспечить */
  required: string;
  /** Зарезервировано под заказ */
  reserved: string;
  /** Размещено: заказано поставщикам и дочерним заказам */
  placed: string;
  /** К поступлению */
  incoming: string;
  /** Не обеспечено */
  notEnsured: string;
  /** Свободно (всего) */
  free: string;
  /** Статус обеспечения */
  status: 'full' | 'partial' | 'none';
  /** Склад резерва */
  reserveWarehouseId: string | null;
  /** Свободно для резерва на складе резерва */
  freeAtReserve: string;
  /** Резервы по складам */
  reserves: { warehouseId: string; warehouseName: string; qty: string; orderNumber: string | null }[];
  /** Размещение по документам */
  placements: { documentId: string; documentType: string; number: string | null; date: string; qty: string }[];
  /** К поступлению по документам */
  incomingDocs: { documentId: string; documentType: string; number: string | null; date: string; qty: string }[];
}

/** Обеспечение материалов заказа: покрытие по строкам состава и расшифровки */
export function useOrderMaterials(id: string | undefined) {
  const ws = useWsId();
  return useQuery({ queryKey: ordersKey(ws, 'materials', id), queryFn: () => call<{ items: MaterialCoverageRow[] }>(ws, 'GET', `/production-orders/${id}/materials`), enabled: !!id, staleTime: Infinity });
}

/** Строка сводной потребности (экран Needs) */
export interface NeedsRow {
  productId: string;
  productName: string;
  unitCode: string;
  need: string;
  reserved: string;
  placed: string;
  free: string;
  incoming: string;
  deficit: string;
  supplierId: string | null;
  supplierName: string | null;
  orders: { orderId: string; number: string | null; need: string }[];
}

export const needsKey = (ws: string, ...rest: unknown[]) => ['ws', ws, 'production-needs', ...rest] as const;

export function useProductionNeeds() {
  const ws = useWsId();
  return useQuery({ queryKey: needsKey(ws, 'list'), queryFn: () => call<{ items: NeedsRow[] }>(ws, 'GET', '/production/needs'), staleTime: Infinity, placeholderData: prev => prev });
}

/** Заказы поставщикам по потребности: черновики по поставщику, строки без поставщика — отдельно */
export interface SupplierOrdersResult {
  orders: { id: string; supplierId: string; supplierName: string; lines: { productId: string; productName: string; qty: string }[] }[];
  withoutSupplier: { productId: string; productName: string; qty: string }[];
}

export function useProductionOrders(params: { state?: string; q?: string } = {}) {
  const ws = useWsId();
  return useQuery({
    queryKey: ordersKey(ws, 'list', params),
    queryFn: () => {
      const sp = new URLSearchParams({ limit: '200' });
      if (params.state) sp.set('state', params.state);
      if (params.q) sp.set('q', params.q);
      return call<{ items: ProductionOrderListItem[]; total: number }>(ws, 'GET', `/production-orders?${sp}`);
    },
    staleTime: Infinity,
    placeholderData: prev => prev,
  });
}

export function useProductionOrder(id: string | undefined) {
  const ws = useWsId();
  return useQuery({ queryKey: ordersKey(ws, 'order', id), queryFn: () => call<ProductionOrderDetail>(ws, 'GET', `/production-orders/${id}`), enabled: !!id, staleTime: Infinity });
}

/** Действия над заказами: создание, правка, снимок спецификации, выпуск, состояние */
export function useProductionOrderApi() {
  const ws = useWsId();
  const qc = useQueryClient();
  const settle = () => {
    void qc.invalidateQueries({ queryKey: ordersKey(ws) });
    void qc.invalidateQueries({ queryKey: ['ws', ws, 'docs'] });
    void qc.invalidateQueries({ queryKey: ['ws', ws, 'production'] });
  };
  const run = React.useCallback(
    async <T,>(method: string, path: string, json?: unknown): Promise<T | null> => {
      try {
        const r = await call<T>(ws, method, path, json);
        settle();
        return r;
      } catch (e) {
        toast.error(errorMessage(e));
        return null;
      }
    },
    [ws, settle],
  );

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => call<ProductionOrderDetail>(ws, 'POST', '/production-orders', { id: uuidv7(), ...body }),
    onSuccess: settle,
    onError: e => toast.error(errorMessage(e)),
  });
  const update = useMutation({
    mutationFn: (v: { id: string; body: Record<string, unknown> }) => call<ProductionOrderDetail>(ws, 'PATCH', `/production-orders/${v.id}`, v.body),
    onSuccess: settle,
    onError: e => toast.error(errorMessage(e)),
  });
  const fill = useMutation({
    mutationFn: (id: string) => call<ProductionOrderDetail>(ws, 'POST', `/production-orders/${id}/fill-from-bom`),
    onSuccess: () => {
      toast('The bill of materials is copied into the order');
      settle();
    },
    onError: e => toast.error(errorMessage(e)),
  });
  const produce = useMutation({
    mutationFn: (v: { id: string; body: Record<string, unknown> }) => call<ProductionOrderDetail>(ws, 'POST', `/production-orders/${v.id}/production`, v.body),
    onSuccess: d => {
      toast('Production created');
      settle();
      return d;
    },
    onError: e => toast.error(errorMessage(e)),
  });
  const setState = useMutation({
    mutationFn: (v: { id: string; state: string }) => call<ProductionOrderDetail>(ws, 'POST', `/production-orders/${v.id}/state`, { state: v.state }),
    onSuccess: settle,
    onError: e => toast.error(errorMessage(e)),
  });
  const schedule = useMutation({
    mutationFn: (id: string) => call<{ assignments: { id: string; start: string | null; end: string | null; scheduled: boolean }[]; forecastEnd: string | null }>(ws, 'POST', `/production-orders/${id}/schedule`),
    onSuccess: r => {
      toast(r.forecastEnd ? `The plan is ready · finishes ${r.forecastEnd}` : 'The plan is ready');
      settle();
    },
    onError: e => toast.error(errorMessage(e)),
  });
  // правка резерва строки материала: сколько в резерв и на каком складе
  const reserve = useMutation({
    mutationFn: (v: { id: string; componentId: string; qty: string; warehouseId: string }) => call<{ items: MaterialCoverageRow[] }>(ws, 'PATCH', `/production-orders/${v.id}/materials/${v.componentId}/reservation`, { qty: v.qty, warehouseId: v.warehouseId }),
    onSuccess: () => {
      toast('The reserve is saved');
      settle();
    },
    onError: e => toast.error(errorMessage(e)),
  });
  // дочерние заказы на полуфабрикаты по дефициту
  const semiOrders = useMutation({
    mutationFn: (id: string) => call<{ created: { id: string; itemName: string; qty: string }[]; skipped: { productName: string; qty: string }[] }>(ws, 'POST', `/production-orders/${id}/semi-orders`, {}),
    onSuccess: r => {
      toast(r.created.length ? `Semi-finished orders created: ${r.created.length}` : 'There is no deficit of semi-finished goods');
      settle();
    },
    onError: e => toast.error(errorMessage(e)),
  });
  // заказы поставщику по не обеспеченным материалам
  const supplierOrders = useMutation({
    mutationFn: (v: { id: string; supplierId?: string | null; comment?: string }) => call<SupplierOrdersResult>(ws, 'POST', `/production-orders/${v.id}/supplier-orders`, { supplierId: v.supplierId ?? null, comment: v.comment ?? '' }),
    onSuccess: r => {
      toast(r.orders.length ? `Supplier orders created: ${r.orders.length}` : 'There is nothing to order');
      settle();
    },
    onError: e => toast.error(errorMessage(e)),
  });
  return { run, create, update, fill, produce, setState, schedule, reserve, semiOrders, supplierOrders };
}
