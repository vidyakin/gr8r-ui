/* Инвестпроекты на клиенте: список, карточка, план-факт, проекты для поля документа и действия.
   Суммы и показатели участнику без права видеть стоимость приходят пустыми (null) — их маскирует сервер. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CashflowPeriod, InvestmentMetrics, InvestmentPeriodKind, InvestmentStatus } from '@gr8r/shared';
import { useSession } from '../data/session';
import { call, useWsId } from '../meta/data';

export interface InvestmentPlanLine {
  id: string;
  periodIndex: number;
  costItemId: string;
  costItemName: string;
  kind: 'expense' | 'income';
  amount: string | null;
  comment: string;
}

/** Поток сценария: у участника без права видеть суммы — только номера периодов */
export interface Scenario {
  cashflow: (CashflowPeriod | { index: number })[];
  metrics: InvestmentMetrics | null;
}

export interface InvestmentDetail {
  id: string;
  name: string;
  status: InvestmentStatus;
  /** База факта: начисление (документы) или оплаты (движения денег) */
  factBasis: 'accrual' | 'payments';
  periodKind: InvestmentPeriodKind;
  startDate: string;
  periods: number;
  discountRate: string | null;
  projectId: string | null;
  organizationId: string | null;
  responsibleId: string | null;
  comment: string;
  approvedAt: string | null;
  archivedAt: string | null;
  updatedAt: string;
  project: { id: string; key: string; name: string; status: string; startDate: string | null; dueDate: string | null } | null;
  organizationName: string | null;
  responsibleName: string | null;
  lines: InvestmentPlanLine[];
  costItems: { id: string; name: string; kind: 'expense' | 'income' }[];
  factDocuments: number;
  currentPeriod: number;
  outsideHorizon: number;
  periodList: { index: number; label: string; start: string }[];
  plan: Scenario;
  fact: Scenario;
  forecast: Scenario;
}

export interface InvestmentListItem {
  id: string;
  name: string;
  status: InvestmentStatus;
  periodKind: InvestmentPeriodKind;
  startDate: string;
  periods: number;
  discountRate: string | null;
  archivedAt: string | null;
  currentPeriod: number;
  plan: InvestmentMetrics | null;
  fact: InvestmentMetrics | null;
  forecast: InvestmentMetrics | null;
}

export interface PlanFactRow {
  costItemId: string | null;
  costItemName: string | null;
  direction: 'in' | 'out';
  plan: string[] | null;
  fact: string[] | null;
  planTotal: string | null;
  factTotal: string | null;
  deviation: string | null;
}

export interface PlanFactDocument {
  documentId: string;
  type: string;
  number: string | null;
  date: string;
  costItemId: string | null;
  costItemName: string | null;
  direction: 'in' | 'out';
  amount: string | null;
  via: 'field' | 'cost_item';
  periodIndex: number;
}

export interface InvestmentPlanFact {
  id: string;
  name: string;
  periodList: { index: number; label: string }[];
  rows: PlanFactRow[];
  documents: PlanFactDocument[];
}

export interface InvestmentInput {
  name: string;
  periodKind: InvestmentPeriodKind;
  startDate: string;
  periods: number;
  discountRate: string;
  projectId: string | null;
  organizationId: string | null;
  responsibleId: string | null;
  comment: string;
  lines: { id: string; periodIndex: number; costItemId: string; amount: string; comment: string }[];
  costItemIds: string[];
  factBasis: 'accrual' | 'payments';
}

export const investmentsKey = (ws: string, ...rest: unknown[]) => ['ws', ws, 'investments', ...rest] as const;

/** Суммы и показатели видят admin и owner (как себестоимость) */
export function useCanSeeAmounts() {
  const { active } = useSession();
  return active?.role === 'owner' || active?.role === 'admin';
}

export function useInvestments(params: { status?: InvestmentStatus; q?: string } = {}) {
  const ws = useWsId();
  const sp = new URLSearchParams({ limit: '200' });
  if (params.status) sp.set('status', params.status);
  if (params.q) sp.set('q', params.q);
  return useQuery({ queryKey: investmentsKey(ws, 'list', params), queryFn: () => call<{ items: InvestmentListItem[]; total: number }>(ws, 'GET', `/investments?${sp}`) });
}

export function useInvestment(id: string | undefined) {
  const ws = useWsId();
  return useQuery({ queryKey: investmentsKey(ws, 'detail', id), queryFn: () => call<InvestmentDetail>(ws, 'GET', `/investments/${id}`), enabled: !!id });
}

export function useInvestmentPlanFact(id: string | undefined) {
  const ws = useWsId();
  return useQuery({ queryKey: investmentsKey(ws, 'plan-fact', id), queryFn: () => call<InvestmentPlanFact>(ws, 'GET', `/investments/${id}/plan-fact`), enabled: !!id });
}

/** Проекты для поля «Инвестпроект» документа: неархивные и незакрытые */
export function useInvestmentOptions() {
  const ws = useWsId();
  return useQuery({
    queryKey: investmentsKey(ws, 'options'),
    queryFn: async () => (await call<{ items: { id: string; name: string; status: InvestmentStatus }[] }>(ws, 'GET', '/investments/options')).items,
    staleTime: 60_000,
  });
}

export function useInvestmentApi() {
  const ws = useWsId();
  const qc = useQueryClient();
  const done = async () => {
    await qc.invalidateQueries({ queryKey: investmentsKey(ws) });
  };
  const create = useMutation({ mutationFn: (body: InvestmentInput) => call<InvestmentDetail>(ws, 'POST', '/investments', body), onSuccess: done });
  const update = useMutation({ mutationFn: ({ id, body }: { id: string; body: Partial<InvestmentInput> }) => call<InvestmentDetail>(ws, 'PATCH', `/investments/${id}`, body), onSuccess: done });
  const status = useMutation({ mutationFn: ({ id, action }: { id: string; action: 'approve' | 'unapprove' | 'close' | 'reopen' }) => call<InvestmentDetail>(ws, 'POST', `/investments/${id}/status`, { action }), onSuccess: done });
  const archive = useMutation({ mutationFn: ({ id, restore }: { id: string; restore?: boolean }) => (restore ? call(ws, 'POST', `/investments/${id}/restore`) : call(ws, 'DELETE', `/investments/${id}`)), onSuccess: done });
  return {
    create: create.mutateAsync,
    update: (id: string, body: Partial<InvestmentInput>) => update.mutateAsync({ id, body }),
    status: (id: string, action: 'approve' | 'unapprove' | 'close' | 'reopen') => status.mutateAsync({ id, action }),
    archive: (id: string, restore?: boolean) => archive.mutateAsync({ id, restore }),
  };
}
