/* Объекты объектного учёта на клиенте (задача 1268): список, карточка, сводка и действия.
   Запросы живут под ['ws', id, 'objects', …]: событие object.* сбрасывает их через realtime. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BudgetPolicy, MilestoneKind, ObjectCostCategory, ObjectProgressMode, ObjectStatus, RevenueMode } from '@gr8r/shared';
import { call, useWsId } from '../meta/data';

export interface ObjectListItem {
  id: string;
  number: string;
  name: string;
  customerId: string | null;
  customerName: string | null;
  address: string;
  startDate: string | null;
  dueDate: string | null;
  status: ObjectStatus;
  managerId: string | null;
  managerName: string | null;
  revenueMode: RevenueMode;
  overheadPct: string;
  /** Контроль бюджета объекта (задача 1270) */
  budgetPolicy: BudgetPolicy;
  /** Как считать процент выполнения (задача 1272) */
  progressMode: ObjectProgressMode;
  /** Ручной процент выполнения 0–100 */
  progressManual: string | null;
  projectId: string | null;
  projectName: string | null;
  warehouseId: string | null;
  warehouseName: string | null;
  note: string;
  archivedAt: string | null;
  foremen: string[];
  contractIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ObjectInput {
  number: string;
  name: string;
  customerId?: string | null;
  address?: string;
  startDate?: string | null;
  dueDate?: string | null;
  status?: ObjectStatus;
  managerId?: string | null;
  revenueMode?: RevenueMode;
  overheadPct?: string;
  budgetPolicy?: BudgetPolicy;
  progressMode?: ObjectProgressMode;
  progressManual?: string | null;
  projectId?: string | null;
  warehouseId?: string | null;
  note?: string;
  foremen?: string[];
  contracts?: string[];
}

export interface ObjectSummary {
  taskCount: number;
  documents: { id: string; type: string; number: string | null; date: string; total: string | null; status: string }[];
  payments: { id: string; documentId: string; documentType: string; documentNumber: string | null; documentDate: string; amount: string | null; comment: string }[];
  stock: { productId: string; sku: string; name: string; unitCode: string; qty: string; avgCost: string | null }[];
  canSeeCost: boolean;
}

export interface ObjectTaskRow {
  id: string;
  key: string;
  title: string;
  status: string;
  dueDate: string | null;
  assigneeId: string | null;
  archivedAt: string | null;
}

export const objectsKey = (ws: string, ...rest: unknown[]) => ['ws', ws, 'objects', ...rest] as const;

export function useObjects(params: { q?: string; status?: ObjectStatus } = {}) {
  const ws = useWsId();
  const sp = new URLSearchParams({ limit: '200', sort: 'createdAt' });
  if (params.q) sp.set('q', params.q);
  if (params.status) sp.set('status', params.status);
  return useQuery({
    queryKey: objectsKey(ws, 'list', params),
    queryFn: () => call<{ items: ObjectListItem[]; total: number }>(ws, 'GET', `/objects?${sp}`),
  });
}

export function useObject(id: string | undefined) {
  const ws = useWsId();
  return useQuery({ queryKey: objectsKey(ws, 'detail', id), queryFn: () => call<ObjectListItem>(ws, 'GET', `/objects/${id}`), enabled: !!id });
}

export function useObjectSummary(id: string | undefined) {
  const ws = useWsId();
  return useQuery({ queryKey: objectsKey(ws, 'summary', id), queryFn: () => call<ObjectSummary>(ws, 'GET', `/objects/${id}/summary`), enabled: !!id });
}

/* ---------------- бюджет объекта (задача 1270) ---------------- */

/** Суммы одной категории затрат: null — нет права видеть стоимость (не owner/admin) */
export interface ObjectBudgetCategory {
  budget: string | null;
  fact: string | null;
  rest: string | null;
  over: boolean;
}

export interface ObjectBudget {
  objectId: string;
  policy: BudgetPolicy;
  /** Согласованная смета есть: без неё бюджета нет и контроль не действует */
  hasEstimate: boolean;
  categories: Record<ObjectCostCategory, ObjectBudgetCategory>;
  totals: ObjectBudgetCategory;
  canSeeCost: boolean;
}

/** Бюджет объекта: бюджет, факт и остаток по категориям; перечитывается событием object.* и проведением документов */
export function useObjectBudget(id: string | undefined) {
  const ws = useWsId();
  return useQuery({ queryKey: objectsKey(ws, 'budget', id), queryFn: () => call<ObjectBudget>(ws, 'GET', `/objects/${id}/budget`), enabled: !!id });
}

/** Задачи объекта — обычный список задач; карточка показывает их во вкладке «Задачи» */
export function useObjectTasks(id: string | undefined) {  const ws = useWsId();
  return useQuery({
    queryKey: objectsKey(ws, 'tasks', id),
    queryFn: () => call<{ items: ObjectTaskRow[] }>(ws, 'GET', `/tasks?objectId=${id}&limit=200&archived=include&sort=sortOrder`),
    enabled: !!id,
  });
}

/** Объекты для поля выбора (документ, строка платежа, задача): без архива */
export function useObjectOptions() {
  const ws = useWsId();
  return useQuery({
    queryKey: objectsKey(ws, 'options'),
    queryFn: async () => (await call<{ items: ObjectListItem[] }>(ws, 'GET', '/objects?limit=200')).items,
    staleTime: 60_000,
  });
}

export function useObjectApi() {
  const ws = useWsId();
  const qc = useQueryClient();
  const done = async () => {
    await qc.invalidateQueries({ queryKey: objectsKey(ws) });
    await qc.invalidateQueries({ queryKey: ['ws', ws, 'tasks'] });
    await qc.invalidateQueries({ queryKey: ['ws', ws, 'docs'] });
  };
  const create = useMutation({ mutationFn: (body: ObjectInput) => call<ObjectListItem>(ws, 'POST', '/objects', body), onSuccess: done });
  const update = useMutation({ mutationFn: ({ id, body }: { id: string; body: Partial<ObjectInput> }) => call<ObjectListItem>(ws, 'PATCH', `/objects/${id}`, body), onSuccess: done });
  const archive = useMutation({ mutationFn: (id: string) => call(ws, 'DELETE', `/objects/${id}`), onSuccess: done });
  return {
    create: create.mutateAsync,
    update: (id: string, body: Partial<ObjectInput>) => update.mutateAsync({ id, body }),
    archive: (id: string) => archive.mutateAsync(id),
  };
}

/* ---------------- процент выполнения и вехи объекта (задача 1272) ---------------- */

export interface ObjectProgress {
  objectId: string;
  mode: ObjectProgressMode;
  progressManual: string | null;
  /** Процент с одним знаком после запятой; null — базы расчёта нет */
  percent: string | null;
  base: {
    tasks: { total: number; closed: number; weightTotal: string; weightClosed: string };
    estimate: { lines: number; revenue: string; doneRevenue: string } | null;
  };
  contractValue: string | null;
}

export interface ObjectMilestone {
  id: string;
  objectId: string;
  sortOrder: number;
  name: string;
  dueDate: string | null;
  kind: MilestoneKind;
  amount: string | null;
  pct: string | null;
  doneAt: string | null;
  acceptedAt: string | null;
  note: string;
  /** Сумма вехи: amount или pct × стоимость договора; null — нет согласованной сметы */
  value: string | null;
  /** Выставлено и оплачено — задача 1273 (акты и счета) */
  invoiced: null;
  paid: null;
  createdAt: string;
  updatedAt: string;
}

/** Суммы по вехам: этапы и аванс отдельно */
export interface ObjectMilestoneTotals {
  total: string | null;
  done: string | null;
  accepted: string | null;
  invoiced: null;
  paid: null;
}

export interface ObjectMilestones {
  objectId: string;
  contractValue: string | null;
  items: ObjectMilestone[];
  summary: { contractValue: string | null; stages: ObjectMilestoneTotals; advance: ObjectMilestoneTotals };
}

export interface MilestoneInput {
  name: string;
  dueDate?: string | null;
  kind?: MilestoneKind;
  amount?: string | null;
  pct?: string | null;
  note?: string;
}

/** Процент выполнения объекта: способ, процент и база расчёта */
export function useObjectProgress(id: string | undefined) {
  const ws = useWsId();
  return useQuery({ queryKey: objectsKey(ws, 'progress', id), queryFn: () => call<ObjectProgress>(ws, 'GET', `/objects/${id}/progress`), enabled: !!id });
}

/** Вехи объекта и сводка «выполнено / принято / выставлено / оплачено» */
export function useObjectMilestones(id: string | undefined) {
  const ws = useWsId();
  return useQuery({ queryKey: objectsKey(ws, 'milestones', id), queryFn: () => call<ObjectMilestones>(ws, 'GET', `/objects/${id}/milestones`), enabled: !!id });
}

export function useObjectMilestoneApi() {
  const ws = useWsId();
  const qc = useQueryClient();
  const done = async () => {
    await qc.invalidateQueries({ queryKey: ['ws', ws, 'objects'] });
    await qc.invalidateQueries({ queryKey: ['ws', ws, 'tasks'] });
  };
  const wrap = async <T>(p: Promise<T>): Promise<T> => {
    const r = await p;
    await done();
    return r;
  };
  return {
    create: (objectId: string, body: MilestoneInput) => wrap(call<ObjectMilestone>(ws, 'POST', `/objects/${objectId}/milestones`, body)),
    update: (objectId: string, id: string, body: Partial<MilestoneInput>) => wrap(call<ObjectMilestone>(ws, 'PATCH', `/objects/${objectId}/milestones/${id}`, body)),
    remove: (objectId: string, id: string) => wrap(call(ws, 'DELETE', `/objects/${objectId}/milestones/${id}`)),
    setDone: (objectId: string, id: string, value: boolean) => wrap(call<ObjectMilestone>(ws, 'POST', `/objects/${objectId}/milestones/${id}/done`, { done: value })),
    setAccepted: (objectId: string, id: string, value: boolean) => wrap(call<ObjectMilestone>(ws, 'POST', `/objects/${objectId}/milestones/${id}/accept`, { accepted: value })),
  };
}
