/* Рабочее место «Выпуск продукции» на клиенте: отбор заказов с остатком к выпуску и выполнение выпуска.
   Данные лежат в кэше TanStack Query под ключом ['ws', id, 'production-workbench', …]. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/components/ui';
import { errorMessage } from '../data/api';
import { call, useWsId } from '../meta/data';

export interface WorkbenchRow {
  /** Строка заказа: позиция заказа на производство или строка заказа покупателя */
  id: string;
  source: 'customer_order' | 'production_order';
  orderId: string;
  productId: string;
  productName: string;
  itemId: string;
  itemName: string;
  unitCode: string;
  /** Заказано */
  qty: string;
  /** Уже выпущено */
  produced: string;
  /** Отгружено покупателю */
  shipped: string;
  /** Осталось к выпуску */
  remaining: string;
  /** Этап выпуска */
  stage: 'final';
}

export interface WorkbenchOrder {
  id: string;
  type: 'customer_order' | 'production_order';
  number: string | null;
  date: string;
  state: string | null;
  comment: string;
  counterparty: { id: string; name: string } | null;
  dueDate: string | null;
  workCenterId: string | null;
  workCenterName: string | null;
  rows: WorkbenchRow[];
}

export interface WorkbenchData {
  orders: WorkbenchOrder[];
  total: number;
  workCenters: { id: string; name: string }[];
}

export interface WorkbenchFilters {
  q?: string;
  customerOrderId?: string;
  productionOrderId?: string;
  counterpartyId?: string;
  productId?: string;
  state?: string;
  from?: string;
  to?: string;
}

/** Режим выполнения: simple — весь остаток, extended — своё количество */
export type WorkbenchMode = 'simple' | 'extended';

export const workbenchKey = (ws: string, ...rest: unknown[]) => ['ws', ws, 'production-workbench', ...rest] as const;

export function useWorkbench(filters: WorkbenchFilters = {}) {
  const ws = useWsId();
  return useQuery({
    queryKey: workbenchKey(ws, 'list', filters),
    queryFn: () => {
      const sp = new URLSearchParams({ limit: '200' });
      for (const [k, v] of Object.entries(filters)) if (v) sp.set(k, v);
      return call<WorkbenchData>(ws, 'GET', `/production/workbench?${sp}`);
    },
    staleTime: Infinity,
    placeholderData: prev => prev,
  });
}

/** Выполнение: отмеченные строки заказов превращаются в документы выпуска */
export function useWorkbenchExecute() {
  const ws = useWsId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { date?: string; mode: WorkbenchMode; rows: { orderId: string; source: 'customer_order' | 'production_order'; lineId: string; qty?: string; workCenterId?: string }[] }) =>
      call<{ documents: { id: string; number: string | null; workCenterId: string; qty: string }[] }>(ws, 'POST', '/production/workbench/execute', body),
    onSuccess: r => {
      const docs = r.documents ?? [];
      toast(docs.length === 1 ? `Production ${docs[0].number ?? ''} is released` : `${docs.length} production documents are released`);
      void qc.invalidateQueries({ queryKey: workbenchKey(ws) });
      void qc.invalidateQueries({ queryKey: ['ws', ws, 'docs'] });
      void qc.invalidateQueries({ queryKey: ['ws', ws, 'production-orders'] });
      void qc.invalidateQueries({ queryKey: ['ws', ws, 'production'] });
    },
    onError: e => toast.error(errorMessage(e)),
  });
}
