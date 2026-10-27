/* Деньги на клиенте (задача 1174б): оплаты, кассы, статьи ДДС, остатки, отчёты и взаиморасчёты.
   Запросы лежат под ['ws', id, 'docs', 'money', …]: события документов инвалидируют их вместе с остальными документами. */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { DocumentStatus, PaymentLineInput, PaymentState } from '@gr8r/shared';
import { call, useWsId } from '../meta/data';

export const moneyKey = (ws: string, ...rest: unknown[]) => ['ws', ws, 'docs', 'money', ...rest] as const;

export interface PaymentListItem {
  id: string;
  type: string;
  number: string | null;
  date: string;
  status: DocumentStatus;
  operation: string | null;
  total: string;
  comment: string;
  counterpartyId: string | null;
  counterpartyName: string | null;
  accountName: string | null;
}

export interface PaymentLine {
  id: string;
  settlementDocumentId: string | null;
  settlementDocument: { id: string; type: string; number: string | null; date: string } | null;
  counterpartyId: string | null;
  counterpartyName: string | null;
  contractId: string | null;
  contractNumber: string | null;
  amount: string;
  cashFlowItemId: string;
  cashFlowItemName: string;
  costItemId: string | null;
  costItemName: string | null;
  investmentProjectId: string | null;
  comment: string;
}

export interface PaymentDetail {
  id: string;
  type: string;
  number: string | null;
  date: string;
  status: DocumentStatus;
  operation: string | null;
  organizationId: string;
  organizationName: string | null;
  counterpartyId: string | null;
  counterparty: { id: string; name: string; settlementMode: string } | null;
  accountableMemberId: string | null;
  accountable: { id: string; name: string } | null;
  cashRegisterId: string | null;
  bankAccountId: string | null;
  targetCashRegisterId: string | null;
  targetBankAccountId: string | null;
  cashRegisterName: string | null;
  bankAccountName: string | null;
  targetName: string | null;
  investmentProjectId: string | null;
  basedOnId: string | null;
  basedOn: { id: string; type: string; number: string | null; status: string; date: string } | null;
  comment: string;
  total: string;
  warnings: string[];
  lines: PaymentLine[];
}

export interface PaymentBody {
  type?: string;
  operation?: string | null;
  organizationId?: string | null;
  date?: string;
  cashRegisterId?: string | null;
  bankAccountId?: string | null;
  targetCashRegisterId?: string | null;
  targetBankAccountId?: string | null;
  counterpartyId?: string | null;
  accountableMemberId?: string | null;
  basedOnId?: string | null;
  comment?: string;
  lines?: Partial<PaymentLineInput>[];
}

export interface CashRegister {
  id: string;
  name: string;
  organizationId: string;
  archivedAt: string | null;
}
export interface CashFlowItem {
  id: string;
  name: string;
  kind: 'income' | 'expense';
  flowGroup: 'operating' | 'investing' | 'financing';
  systemKey: string | null;
  investmentProjectId: string | null;
  archivedAt: string | null;
}

export interface BalanceRow {
  id: string;
  name: string;
  organizationId: string;
  organizationName: string;
  balance: string;
}
export interface Balances {
  asOf: string;
  cash: BalanceRow[];
  bank: BalanceRow[];
  accountable: { memberId: string; name: string; balance: string }[];
  totals: { cash: string; bank: string; all: string };
}

export interface CashFlowRow {
  key: string;
  name: string;
  group?: string;
  income: string;
  expense: string;
  net: string;
  opening?: string;
  closing?: string;
}
export interface CashFlowReport {
  from: string;
  to: string;
  groupBy: string;
  rows: CashFlowRow[];
  totals: { income: string; expense: string; net: string };
}

export interface DebtDoc {
  documentId: string;
  type: string;
  number: string | null;
  date: string;
  dueDate: string | null;
  amount: string;
  overdueDays: number;
}
export interface DebtRow {
  companyId: string;
  companyName: string;
  mode: string;
  balance: string;
  debt: string;
  advance: string;
  overdue: string;
  docs: DebtDoc[];
}
export interface DebtReport {
  rows: DebtRow[];
  totals: { debt: string; advance: string; overdue: string };
}

export interface PaymentStatus {
  documentId: string;
  rootId: string;
  side: 'customer' | 'supplier';
  mode: string;
  obligation: string;
  paid: string;
  remaining: string;
  state: PaymentState;
}

export interface SettlementCard {
  companyId: string;
  mode: string;
  from: string;
  to: string;
  balances: { customer: string; supplier: string };
  sides: { side: 'customer' | 'supplier'; opening: string; closing: string; rows: { date: string; documentId: string; documentType: string; number: string | null; label: string; accrual: string; payment: string }[] }[];
}

const qs = (o: Record<string, string | undefined>) => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v) sp.set(k, v);
  return sp.toString();
};

export function usePayments(params: { type?: string; status?: string; q?: string; from?: string; to?: string; counterpartyId?: string }) {
  const ws = useWsId();
  return useQuery({ queryKey: moneyKey(ws, 'list', params), queryFn: () => call<{ items: PaymentListItem[]; total: number; incoming: string; outgoing: string }>(ws, 'GET', `/payments?${qs({ ...params, limit: '100' })}`) });
}

export function usePayment(id: string | undefined) {
  const ws = useWsId();
  return useQuery({ queryKey: moneyKey(ws, 'doc', id ?? ''), queryFn: () => call<PaymentDetail>(ws, 'GET', `/payments/${id}`), enabled: !!id });
}

export function usePaymentApi() {
  const ws = useWsId();
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ['ws', ws, 'docs'] });
  return {
    save: async (body: PaymentBody) => {
      const r = await call<PaymentDetail>(ws, 'POST', '/payments', body);
      await refresh();
      return r;
    },
    update: async (id: string, body: PaymentBody) => {
      const r = await call<PaymentDetail>(ws, 'PATCH', `/payments/${id}`, body);
      await refresh();
      return r;
    },
    fromDocument: async (documentId: string, account: 'cash' | 'bank') => {
      const r = await call<PaymentDetail>(ws, 'POST', '/payments/from-document', { documentId, account });
      await refresh();
      return r;
    },
    action: async (id: string, action: 'post' | 'unpost' | 'cancel' | 'restore') => {
      await call(ws, 'POST', `/documents/${id}/${action}`);
      await refresh();
    },
    remove: async (id: string) => {
      await call(ws, 'DELETE', `/documents/${id}`);
      await refresh();
    },
  };
}

export function useCashRegisters() {
  const ws = useWsId();
  return useQuery({ queryKey: moneyKey(ws, 'registers'), queryFn: async () => (await call<{ items: CashRegister[] }>(ws, 'GET', '/cash-registers?limit=200')).items });
}

export function useCashFlowItems(kind?: 'income' | 'expense') {
  const ws = useWsId();
  return useQuery({
    queryKey: moneyKey(ws, 'items', kind ?? 'all'),
    queryFn: async () => {
      await call(ws, 'GET', `/payments/reports/cash-flow?from=2000-01-01&to=2000-01-02`); // заводит системные статьи
      return (await call<{ items: CashFlowItem[] }>(ws, 'GET', `/cash-flow-items?limit=200${kind ? `&kind=${kind}` : ''}`)).items;
    },
  });
}

export function useRefsApi() {
  const ws = useWsId();
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ['ws', ws, 'docs'] });
  return {
    create: async (path: 'cash-registers' | 'cash-flow-items', body: Record<string, unknown>) => {
      await call(ws, 'POST', `/${path}`, body);
      await refresh();
    },
    archive: async (path: 'cash-registers' | 'cash-flow-items', id: string) => {
      await call(ws, 'DELETE', `/${path}/${id}`);
      await refresh();
    },
  };
}

export function useBalances(asOf: string) {
  const ws = useWsId();
  return useQuery({ queryKey: moneyKey(ws, 'balances', asOf), queryFn: () => call<Balances>(ws, 'GET', `/payments/balances?${qs({ asOf })}`) });
}

export function useCashFlowReport(p: { from: string; to: string; groupBy: string }) {
  const ws = useWsId();
  return useQuery({ queryKey: moneyKey(ws, 'cash-flow', p), queryFn: () => call<CashFlowReport>(ws, 'GET', `/payments/reports/cash-flow?${qs(p)}`) });
}

export function useDebtReport(side: 'customer' | 'supplier', asOf: string) {
  const ws = useWsId();
  return useQuery({ queryKey: moneyKey(ws, 'debts', side, asOf), queryFn: () => call<DebtReport>(ws, 'GET', `/payments/reports/${side === 'customer' ? 'receivables' : 'payables'}?${qs({ asOf })}`) });
}

/** «Оплачено / к оплате» для документов на экране (ключ — список id) */
export function usePaymentStatuses(ids: string[]) {
  const ws = useWsId();
  const key = [...ids].sort().join(',');
  return useQuery({
    queryKey: moneyKey(ws, 'status', key),
    queryFn: async () => (await call<{ items: Record<string, PaymentStatus> }>(ws, 'GET', `/payments/status?ids=${key}`)).items,
    enabled: ids.length > 0,
  });
}

export function useSettlementCard(companyId: string | undefined, p: { from?: string; to?: string }) {
  const ws = useWsId();
  return useQuery({ queryKey: moneyKey(ws, 'card', companyId ?? '', p), queryFn: () => call<SettlementCard>(ws, 'GET', `/payments/settlements/${companyId}?${qs(p)}`), enabled: !!companyId });
}

export function useOrgBankAccounts(organizationId: string | undefined) {
  const ws = useWsId();
  return useQuery({
    queryKey: moneyKey(ws, 'org-banks', organizationId ?? ''),
    queryFn: async () => (await call<{ items: { id: string; bankName: string; account: string }[] }>(ws, 'GET', `/organizations/${organizationId}/bank-accounts`)).items,
    enabled: !!organizationId,
  });
}
