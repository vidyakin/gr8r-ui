/* Отчёты производства: типы ответов и запросы (задача 1091). Сервер — GET /production/reports/<имя>.
   Ключи кэша под ['ws', id, 'production', 'reports', …]: события документов обновляют их вместе с остальным производством. */
import { useQuery } from '@tanstack/react-query';
import { call, useWsId } from '../../meta/data';
import { productionKey } from '../data';

export interface ReleaseRow {
  itemId: string;
  itemName: string;
  documentId: string;
  number: string | null;
  date: string;
  workCenterName: string | null;
  qty: string;
  defectQty: string;
  goodQty: string;
}

export interface OrderReportRow {
  orderId: string;
  number: string | null;
  date: string;
  dueDate: string | null;
  state: string | null;
  workCenterName: string | null;
  itemId: string;
  itemName: string;
  opening: string;
  ordered: string;
  produced: string;
  closing: string;
  overdueDays: number;
}

export interface PlanFactRow {
  itemId: string;
  itemName: string;
  periodStart: string;
  periodEnd: string;
  plan: string;
  fact: string;
  deviation: string;
  pct: string | null;
}

export interface BomReportRow {
  kind: 'material' | 'expense' | 'semi' | 'work' | 'overhead';
  level: number;
  nested: boolean;
  stageId: string | null;
  stageName: string | null;
  stageOrder: number;
  name: string;
  unitCode: string | null;
  qty: string;
  hours: string;
  workCenterName: string | null;
  price: string | null;
  amount: string | null;
}

export interface BomReport {
  itemId: string;
  itemName: string;
  qty: string;
  priceMode: 'price_kind' | 'last_purchase';
  priceKind: 'purchase' | 'price' | 'avg_cost';
  rows: BomReportRow[];
  hoursTotal: string;
  total: string | null;
  unitTotal: string | null;
  unpriced: number;
}

export interface LoadReportDay {
  date: string;
  capacity: string;
  planned: string;
  fact: string;
  overloaded: boolean;
}

export interface LoadReportRow {
  workCenterId: string;
  workCenterName: string;
  capacity: string;
  planned: string;
  fact: string;
  plannedPct: string | null;
  factPct: string | null;
  overloaded: boolean;
  days: LoadReportDay[];
}

export interface CostReportRow {
  itemId: string;
  itemName: string;
  documentId: string;
  number: string | null;
  date: string;
  workCenterName: string | null;
  qty: string;
  materials: string;
  semi: string;
  alloc: string;
  work: string;
  services: string;
  indirect: string;
  other: string;
  total: string;
  indirectItems: { costItemId: string | null; name: string; amount: string }[];
}

export interface CostPlanFactRow {
  itemId: string;
  itemName: string;
  productId: string;
  materialName: string;
  unitCode: string | null;
  documentId: string;
  number: string | null;
  date: string;
  planQty: string;
  factQty: string;
  deviationQty: string;
  planAmount: string | null;
  factAmount: string | null;
  deviationAmount: string | null;
}

export interface WipMovementRow {
  workCenterId: string | null;
  workCenterName: string | null;
  orderId: string | null;
  number: string | null;
  date: string | null;
  itemKey: string;
  itemName: string;
  openingQty: string;
  inQty: string;
  outQty: string;
  closingQty: string;
  openingAmount: string | null;
  inAmount: string | null;
  outAmount: string | null;
  closingAmount: string | null;
}

/** Параметры запроса без пустых значений */
const qs = (p: Record<string, string | undefined>) => new URLSearchParams(Object.entries(p).filter((e): e is [string, string] => !!e[1])).toString();

/** Общий хук отчёта: name — путь после /production/reports/, rows — поле с данными */
function useReport<T>(name: string, params: Record<string, string | undefined>, enabled = true) {
  const ws = useWsId();
  const query = qs(params);
  return useQuery({ queryKey: productionKey(ws, 'reports', name, query), queryFn: () => call<T>(ws, 'GET', `/production/reports/${name}?${query}`), enabled });
}

export interface ReportFilter {
  from: string;
  to: string;
  workCenterId?: string | undefined;
  itemId?: string | undefined;
}

export const useReleaseReport = (f: ReportFilter) => useReport<{ rows: ReleaseRow[] }>('release', { ...f }, !!f.from && !!f.to);
export const useOrdersReport = (f: ReportFilter) => useReport<{ rows: OrderReportRow[]; today: string }>('orders', { ...f }, !!f.from && !!f.to);
export const usePlanFactReport = (f: ReportFilter) => useReport<{ rows: PlanFactRow[] }>('plan-fact', { from: f.from, to: f.to, itemId: f.itemId }, !!f.from && !!f.to);
export const useLoadReport = (f: ReportFilter) => useReport<{ rows: LoadReportRow[] }>('load', { from: f.from, to: f.to, workCenterId: f.workCenterId }, !!f.from && !!f.to);
export const useBomReport = (p: { itemId: string; qty: string; priceMode: string; priceKind: string; params?: string | undefined }) => useReport<BomReport>('bom', { ...p }, !!p.itemId && Number(p.qty) > 0);
export const useReleaseCostReport = (f: ReportFilter) => useReport<{ rows: CostReportRow[]; indirectItems: { costItemId: string | null; name: string; amount: string }[] }>('release-cost', { ...f }, !!f.from && !!f.to);
export const useCostPlanFactReport = (f: ReportFilter) => useReport<{ rows: CostPlanFactRow[] }>('cost-plan-fact', { ...f }, !!f.from && !!f.to);
export const useWipMovementReport = (f: ReportFilter) => useReport<{ rows: WipMovementRow[]; closingTotal: string | null }>('wip-movement', { from: f.from, to: f.to, workCenterId: f.workCenterId }, !!f.from && !!f.to);

/** Себестоимость заказ-нарядов, выполненных за период (задача 1096) */
export interface WorkOrderCostReportRow {
  documentId: string;
  number: string | null;
  date: string;
  doneDate: string;
  counterpartyId: string | null;
  counterpartyName: string | null;
  revenue: string;
  labor: string;
  materials: string;
  goods: string;
  other: string;
  indirect: string;
  cost: string;
  margin: string;
  marginPct: string | null;
  estimated: boolean;
  /** Гарантийный ремонт: затраты на статью «Гарантийный ремонт» */
  warranty: boolean;
}
export const useWorkOrderCostReport = (f: ReportFilter) => useReport<{ rows: WorkOrderCostReportRow[]; warrantyCost: string }>('work-order-cost', { from: f.from, to: f.to }, !!f.from && !!f.to);
