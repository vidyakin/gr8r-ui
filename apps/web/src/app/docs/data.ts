/* Документы, организации, склады и остатки на клиенте. Всё лежит в кэше TanStack Query под ключом ['ws', id, 'docs', …];
   realtime помечает его устаревшим по событиям document / organization / warehouse / bank_account / product / company (см. data/realtime.ts).
   Суммы строк и итоги документа в форме считает та же чистая функция, что и сервер при проведении (computeDocument из @gr8r/shared). */
import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DOCUMENT_META, type CompanyKind, type CostItemKind, type DocumentGroup, type DocumentStatus, type DocumentType, type FileRef, type TaxSystem, type VatRate, type WarehouseKind, type WorkOrderBillingMode, type WorkOrderStateCategory } from '@gr8r/shared';
import { toast } from '@/components/ui';
import type { Tone } from '@/components/ui';
import { errorMessage } from '../data/api';
import { call, useWsId } from '../meta/data';

export const docsKey = (ws: string, ...rest: unknown[]) => ['ws', ws, 'docs', ...rest] as const;

export const STATUS_LABEL: Record<DocumentStatus, string> = { draft: 'Draft', posted: 'Posted', cancelled: 'Cancelled' };
export const STATUS_TONE: Record<DocumentStatus, Tone> = { draft: 'gray', posted: 'green', cancelled: 'red' };
export const typeLabel = (t: string) => DOCUMENT_META[t as DocumentType]?.label ?? t;
export const docTitle = (d: { type: string; number: string | null }) => `${typeLabel(d.type)}${d.number ? ` ${d.number}` : ' (draft)'}`;

export interface DocLine {
  id: string;
  productId: string;
  name: string;
  unitCode: string;
  qty: string;
  price: string;
  discountPct: string;
  vatRate: VatRate;
  net: string;
  vatAmount: string;
  total: string;
  sku: string;
  kind: 'goods' | 'service' | 'work' | 'operation';
  shipped: string;
  planned: string;
  returned: string;
  sourceLineId: string | null;
  originLineId: string | null;
  /** Роль строки внутреннего документа: приход или расход */
  stockRole: 'in' | 'out' | null;
  /** Учётное количество по остаткам (инвентаризация) */
  bookQty: string;
  /** Принятое количество (перемещение «в пути») */
  receivedQty: string;
}

export interface DocListItem {
  id: string;
  type: DocumentType;
  number: string | null;
  date: string;
  dueDate: string | null;
  status: DocumentStatus;
  /** Состояние документа (отдельно от проведения) */
  state: string | null;
  organizationId: string;
  organizationName: string;
  counterpartyId: string | null;
  counterpartyName: string | null;
  warehouseId: string | null;
  warehouseName: string | null;
  targetWarehouseId: string | null;
  targetWarehouseName?: string | null;
  costItemId: string | null;
  priceIncludesVat: boolean;
  amountNet: string;
  vatTotal: string;
  total: string;
  /** Стоимость по себестоимости (внутренние документы); member и guest её не видят (null) */
  costTotal?: string | null;
  basedOnId: string | null;
  comment: string;
  createdAt: string;
  updatedAt: string;
}

export interface DocLink {
  id: string;
  type: DocumentType;
  number: string | null;
  status: DocumentStatus;
  date: string;
  total?: string;
}

export interface DocDetail extends Omit<DocListItem, 'organizationName' | 'counterpartyName' | 'warehouseName'> {
  numberYear: number | null;
  numberSeq: number | null;
  currency: string;
  organization: { id: string; name: string } | null;
  counterparty: { id: string; name: string; inn: string } | null;
  warehouse: { id: string; name: string } | null;
  /** Склад-получатель (перемещение) */
  targetWarehouse: { id: string; name: string; kind: WarehouseKind } | null;
  /** Статья затрат или доходов */
  costItem: { id: string; name: string; kind: CostItemKind } | null;
  operation: string | null;
  /** Получатель имущества в эксплуатацию: сотрудник */
  inUseMember: { id: string; name: string } | null;
  /** Получатель имущества в эксплуатацию: участок */
  inUseWorkCenter: { id: string; name: string } | null;
  /** Стоимость по себестоимости (внутренние документы) */
  costTotal?: string;
  basedOn: DocLink | null;
  children: DocLink[];
  lines: DocLine[];
  postedAt: string | null;
  /** Заказ-наряд: вид, набор состояний, материалы и назначения */
  kindId?: string | null;
  kindName?: string | null;
  states?: WorkOrderState[];
  materials?: WorkOrderMaterial[];
  assignments?: WorkOrderAssignment[];
  /** Производственный документ: изготовитель, плановые сроки, позиции и состав */
  workCenter?: { id: string; name: string } | null;
  plannedStart?: string | null;
  plannedEnd?: string | null;
  components?: { id: string; kind: 'material' | 'semi' | 'work'; operation: string; qty: string; hours: string; plannedCost: string | null; actualCost: string | null }[];
}

export interface DocListParams {
  type?: string;
  group?: DocumentGroup;
  status?: string[];
  organizationId?: string;
  counterpartyId?: string;
  q?: string;
  sort?: string;
}

export interface DocList {
  items: DocListItem[];
  total: number;
  limit: number;
  sum: { net: string; vat: string; total: string; cost?: string | null };
}

export function useDocuments(params: DocListParams) {
  const ws = useWsId();
  return useQuery({
    queryKey: docsKey(ws, 'list', params),
    queryFn: () => {
      const sp = new URLSearchParams({ limit: '200', sort: params.sort ?? '-date' });
      if (params.type) sp.set('type', params.type);
      if (params.group) sp.set('group', params.group);
      if (params.status?.length) sp.set('status', params.status.join(','));
      if (params.organizationId) sp.set('organizationId', params.organizationId);
      if (params.counterpartyId) sp.set('counterpartyId', params.counterpartyId);
      if (params.q) sp.set('q', params.q);
      return call<DocList>(ws, 'GET', `/documents?${sp}`);
    },
    staleTime: Infinity,
    placeholderData: prev => prev,
  });
}

export function useDocument(id: string | undefined) {
  const ws = useWsId();
  return useQuery({ queryKey: docsKey(ws, 'doc', id), queryFn: () => call<DocDetail>(ws, 'GET', `/documents/${id}`), enabled: !!id, staleTime: Infinity, retry: false });
}

/** Заголовок документа из уже загруженного кэша (для крошек): запрос не отправляется */
export function useCachedDocTitle(id: string | undefined): string | undefined {
  const ws = useWsId();
  const q = useQuery<DocDetail>({ queryKey: docsKey(ws, 'doc', id), queryFn: () => call<DocDetail>(ws, 'GET', `/documents/${id}`), enabled: false, staleTime: Infinity });
  return id && q.data ? docTitle(q.data) : undefined;
}

/** Вызов API с обновлением кэша документов (и производства: проведение меняет среднюю себестоимость) и тостом об ошибке; null — ошибка */
export function useDocsApi() {
  const ws = useWsId();
  const qc = useQueryClient();
  return React.useCallback(
    async <T,>(method: string, path: string, json?: unknown, opts: { quiet?: boolean; refresh?: boolean } = {}): Promise<T | null> => {
      try {
        const r = await call<T>(ws, method, path, json);
        if (opts.refresh !== false) {
          void qc.invalidateQueries({ queryKey: docsKey(ws) });
          if (path.startsWith('/documents')) void qc.invalidateQueries({ queryKey: ['ws', ws, 'production'] });
        }
        return r;
      } catch (e) {
        if (!opts.quiet) toast.error(errorMessage(e));
        return null;
      }
    },
    [ws, qc],
  );
}

/* ---------------- организации, склады, счета ---------------- */

export interface Organization {
  id: string;
  name: string;
  fullName: string;
  kind: CompanyKind;
  inn: string;
  kpp: string;
  ogrn: string;
  legalAddress: string;
  actualAddress: string;
  phone: string;
  email: string;
  directorName: string;
  directorTitle: string;
  accountantName: string;
  taxSystem: TaxSystem;
  defaultVatRate: VatRate;
  stampFile: FileRef;
  directorSignatureFile: FileRef;
  accountantSignatureFile: FileRef;
  isDefault: boolean;
  archivedAt: string | null;
}

export interface Warehouse {
  id: string;
  name: string;
  code: string;
  address: string;
  kind: WarehouseKind;
  isDefault: boolean;
  archivedAt: string | null;
}

export interface CostItem {
  id: string;
  name: string;
  kind: CostItemKind;
  systemKey: string | null;
  archivedAt: string | null;
}

export interface BankAccount {
  id: string;
  companyId: string | null;
  organizationId: string | null;
  bik: string;
  account: string;
  corrAccount: string;
  bankName: string;
  isDefault: boolean;
  note: string;
}

export function useOrganizations() {
  const ws = useWsId();
  return useQuery({ queryKey: docsKey(ws, 'organizations'), queryFn: async () => (await call<{ items: Organization[] }>(ws, 'GET', '/organizations?limit=100')).items, staleTime: Infinity });
}

export function useWarehouses() {
  const ws = useWsId();
  return useQuery({ queryKey: docsKey(ws, 'warehouses'), queryFn: async () => (await call<{ items: Warehouse[] }>(ws, 'GET', '/warehouses?limit=100')).items, staleTime: Infinity });
}

/** Статьи затрат и доходов: справочник для списаний и оприходований */
export function useCostItems(kind?: CostItemKind) {
  const ws = useWsId();
  return useQuery({
    queryKey: docsKey(ws, 'cost-items', kind ?? 'all'),
    queryFn: async () => (await call<{ items: CostItem[] }>(ws, 'GET', `/cost-items?limit=200${kind ? `&kind=${kind}` : ''}`)).items,
    staleTime: Infinity,
  });
}

export function useBankAccounts(owner: 'companies' | 'organizations', id: string | undefined) {
  const ws = useWsId();
  return useQuery({ queryKey: docsKey(ws, 'bank', owner, id), queryFn: async () => (await call<{ items: BankAccount[] }>(ws, 'GET', `/${owner}/${id}/bank-accounts`)).items, enabled: !!id, staleTime: Infinity });
}

export interface CompanyRequisites {
  id: string;
  name: string;
  kind: CompanyKind;
  inn: string;
  kpp: string;
  ogrn: string;
  legalAddress: string;
  actualAddress: string;
}

export function useCompanyRequisites(id: string | undefined) {
  const ws = useWsId();
  return useQuery({ queryKey: docsKey(ws, 'company', id), queryFn: () => call<CompanyRequisites>(ws, 'GET', `/companies/${id}`), enabled: !!id, staleTime: Infinity });
}

export function useInventorySettings() {
  const ws = useWsId();
  return useQuery({ queryKey: docsKey(ws, 'inventory-settings'), queryFn: () => call<{ allowNegativeStock: boolean }>(ws, 'GET', '/stock/settings'), staleTime: Infinity });
}

/* ---------------- остатки ---------------- */

export interface StockBalance {
  warehouseId: string;
  warehouseName: string;
  productId: string;
  name: string;
  sku: string;
  unitCode: string;
  qty: string;
  reserved: string;
  available: string;
  avgCost: string;
  value: string;
}

export interface StockMove {
  id: string;
  seq: number;
  warehouseId: string;
  warehouseName: string;
  productId: string;
  documentId: string;
  documentType: DocumentType;
  documentNumber: string | null;
  qty: string;
  cost: string;
  movedAt: string;
  balance: string;
}

export function useStockBalances(params: { warehouseId?: string; q?: string; nonZero?: boolean }) {
  const ws = useWsId();
  return useQuery({
    queryKey: docsKey(ws, 'balances', params),
    queryFn: () => {
      const sp = new URLSearchParams({ limit: '1000' });
      if (params.warehouseId) sp.set('warehouseId', params.warehouseId);
      if (params.q) sp.set('q', params.q);
      if (params.nonZero) sp.set('nonZero', 'true');
      return call<{ items: StockBalance[]; total: number; value: string | null }>(ws, 'GET', `/stock/balances?${sp}`);
    },
    staleTime: Infinity,
    placeholderData: prev => prev,
  });
}

export function useStockMoves(productId: string | undefined) {
  const ws = useWsId();
  return useQuery({ queryKey: docsKey(ws, 'moves', productId), queryFn: async () => (await call<{ items: StockMove[] }>(ws, 'GET', `/stock/moves?productId=${productId}&limit=200`)).items, enabled: !!productId, staleTime: Infinity });
}

/** Имущество в эксплуатации: у какого сотрудника или участка оно лежит */
export interface InUseBalance {
  productId: string;
  name: string;
  sku: string;
  unitCode: string;
  qty: string;
  memberId: string | null;
  memberName: string | null;
  workCenterId: string | null;
  workCenterName: string | null;
}

export function useInUseBalances() {
  const ws = useWsId();
  return useQuery({ queryKey: docsKey(ws, 'in-use'), queryFn: async () => (await call<{ items: InUseBalance[] }>(ws, 'GET', '/stock/in-use')).items, staleTime: Infinity });
}

/* ---------------- заказ-наряды ---------------- */

/** Состояние заказ-наряда: набор задаёт воркспейс, логика — по категории */
export interface WorkOrderState {
  key: string;
  label: string;
  category: WorkOrderStateCategory;
  color?: string;
}

export interface WorkOrderKind {
  id: string;
  name: string;
  isDefault: boolean;
  sortOrder: number;
}

/** Материал заказ-наряда: израсходован на работу, списывается при выполнении */
export interface WorkOrderMaterial {
  id: string;
  productId: string;
  name: string;
  unitCode: string;
  qty: string;
  warehouseId: string | null;
  warehouseName: string | null;
}

/** Назначение: исполнитель — задача модуля services */
export interface WorkOrderAssignment {
  id: string;
  taskId: string;
  taskKey: string;
  title: string;
  status: string;
  assigneeId: string | null;
  assigneeName: string | null;
  lineId: string | null;
  workCenterId: string | null;
  workCenterName: string | null;
  plannedHours: string | null;
  startDate: string | null;
  dueDate: string | null;
  /** Интервал работы по часам */
  startAt: string | null;
  endAt: string | null;
}

export interface WorkOrderListItem extends DocListItem {
  kindName: string | null;
  stateLabel: string | null;
  stateColor: string | null;
  category: WorkOrderStateCategory | null;
}

export function useWorkOrders(params: { state?: string; status?: string; q?: string }) {
  const ws = useWsId();
  return useQuery({
    queryKey: docsKey(ws, 'work-orders', params),
    queryFn: () => {
      const sp = new URLSearchParams({ limit: '200' });
      if (params.state) sp.set('state', params.state);
      if (params.status) sp.set('status', params.status);
      if (params.q) sp.set('q', params.q);
      return call<{ items: WorkOrderListItem[]; total: number; sum: { net: string; vat: string; total: string } }>(ws, 'GET', `/work-orders?${sp}`);
    },
    staleTime: Infinity,
    placeholderData: prev => prev,
  });
}

/** Табель сотрудника: время по задачам модуля services (строки по заказчику и виду работ) */
export interface TimesheetRow {
  logDate: string;
  hours: string;
  memberId: string;
  memberName: string;
  taskId: string;
  taskKey: string;
  title: string;
  companyId: string | null;
  companyName: string | null;
  workName: string | null;
  documentId: string | null;
  documentNumber: string | null;
}

export interface Timesheet {
  items: TimesheetRow[];
  totals: { hours: string; byMember: { memberId: string; memberName: string; hours: string }[] };
}

export function useTimesheet(params: { memberId?: string; from?: string; to?: string }) {
  const ws = useWsId();
  return useQuery({
    queryKey: docsKey(ws, 'timesheet', params),
    queryFn: () => {
      const sp = new URLSearchParams();
      if (params.memberId) sp.set('memberId', params.memberId);
      if (params.from) sp.set('from', params.from);
      if (params.to) sp.set('to', params.to);
      return call<Timesheet>(ws, 'GET', `/services/timesheet?${sp}`);
    },
    staleTime: Infinity,
    placeholderData: prev => prev,
  });
}

/** Время заказ-наряда: план и факт по назначениям, способ выставления строк работ */
export interface WorkOrderTime {
  assignments: { assignmentId: string; taskId: string; taskKey: string; title: string; assigneeName: string | null; lineId: string | null; lineName: string | null; plannedHours: string; actualHours: string }[];
  lines: { lineId: string; name: string; billing: WorkOrderBillingMode; actualHours: string }[];
  members: { memberId: string | null; memberName: string | null; plannedHours: string; actualHours: string }[];
  totals: { plannedHours: string; actualHours: string };
}

export function useWorkOrderTime(id: string | undefined) {
  const ws = useWsId();
  return useQuery({ queryKey: docsKey(ws, 'wo-time', id), queryFn: () => call<WorkOrderTime>(ws, 'GET', `/work-orders/${id}/time`), enabled: !!id, staleTime: Infinity });
}

/** Виды заказ-нарядов воркспейса */
export function useWorkOrderKinds() {  const ws = useWsId();
  return useQuery({ queryKey: docsKey(ws, 'work-order-kinds'), queryFn: async () => (await call<{ items: WorkOrderKind[] }>(ws, 'GET', '/work-order-kinds?limit=100')).items, staleTime: Infinity });
}

/** Состояния заказ-наряда (по видам) */
export function useDocumentStates(kindId?: string) {
  const ws = useWsId();
  return useQuery({
    queryKey: docsKey(ws, 'document-states', kindId ?? 'all'),
    queryFn: async () => {
      const sp = new URLSearchParams({ limit: '200' });
      if (kindId) sp.set('kindId', kindId);
      return (await call<{ items: (WorkOrderState & { id: string; kindId: string })[] }>(ws, 'GET', `/document-states?${sp}`)).items;
    },
    staleTime: Infinity,
  });
}

/* ---------------- поиск ---------------- */

export interface CompanyHit {
  id: string;
  name: string;
  inn: string;
  city: string;
}

export const searchCompanies = async (ws: string, q: string, limit = 8) => {
  const sp = new URLSearchParams({ limit: String(limit), sort: 'name' });
  if (q) sp.set('q', q);
  return (await call<{ items: CompanyHit[] }>(ws, 'GET', `/companies?${sp}`)).items;
};

export const searchDocuments = async (ws: string, q: string, limit = 5) => (await call<{ items: DocListItem[] }>(ws, 'GET', `/documents?limit=${limit}&q=${encodeURIComponent(q)}`)).items;
