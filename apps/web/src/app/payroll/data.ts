/* Зарплата на клиенте (задача 1184): начисление, ведомость, кадровые данные, справочники, отчёты и расчётный листок.
   Ключи — под ['ws', id, 'docs', 'payroll', …]: события документов инвалидируют их вместе с остальными документами. */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { DocumentStatus } from '@gr8r/shared';
import { API_BASE, ok } from '../data/api';
import { call, useWsId } from '../meta/data';

export const payrollKey = (ws: string, ...rest: unknown[]) => ['ws', ws, 'docs', 'payroll', ...rest] as const;

export type BaseType = 'salary' | 'piecework' | 'sales_percent' | 'bonus' | 'one_time' | 'deduction';
export interface PayrollKind {
  id: string;
  name: string;
  baseType: BaseType;
  systemKey: string | null;
  insurable: boolean;
}
export interface Reflection {
  id: string;
  name: string;
  costItemId: string;
  costItemName: string;
  workCenterId: string | null;
  workCenterName: string | null;
}
export interface Accrual {
  id: string;
  kindId: string;
  kindName: string;
  baseType: BaseType;
  validFrom: string;
  amount: string | null;
  percent: string | null;
  percentBasis: string;
}
export interface Employee {
  memberId: string;
  name: string;
  title: string;
  configured: boolean;
  hiredAt: string | null;
  firedAt: string | null;
  organizationId: string | null;
  workCenterId: string | null;
  reflectionId: string | null;
  ndflRate: string;
  cardAccount: string;
  advanceAmount: string | null;
  advancePercent: string | null;
  accruals: Accrual[];
}

export interface PayrollLine {
  id: string;
  memberId: string;
  memberName: string;
  kindId: string;
  kindName: string;
  baseType: BaseType;
  base: string;
  rate: string;
  workedDays: number;
  normDays: number;
  amount: string;
  ndfl: string;
  insurance: string;
  reflectionId: string | null;
  comment: string;
}
export interface PayrollListItem {
  id: string;
  number: string | null;
  date: string;
  status: DocumentStatus;
  total: string;
  comment: string;
  period: string;
}
export interface PayrollDetail {
  id: string;
  number: string | null;
  date: string;
  status: DocumentStatus;
  organizationId: string;
  period: string;
  workCenterId: string | null;
  comment: string;
  total: string;
  lines: PayrollLine[];
  totals: { accrued: string; ndfl: string; deductions: string; insurance: string; payable: string };
}
export interface PayrollBody {
  organizationId?: string | null;
  period?: string;
  workCenterId?: string | null;
  date?: string;
  comment?: string;
  lines?: Partial<PayrollLine>[];
}

export type StatementKind = 'advance' | 'settlement';
export type PayoutMethod = 'cash' | 'bank';
export interface StatementListItem extends PayrollListItem {
  kind: StatementKind;
  method: PayoutMethod;
}
export interface StatementLine {
  id: string;
  memberId: string;
  memberName: string;
  amount: string;
  paid: string;
  scheduled: string;
  comment: string;
}
export interface StatementDetail {
  id: string;
  number: string | null;
  date: string;
  status: DocumentStatus;
  organizationId: string;
  period: string;
  kind: StatementKind;
  method: PayoutMethod;
  comment: string;
  total: string;
  paidTotal: string;
  remaining: string;
  payState: 'none' | 'unpaid' | 'partial' | 'paid';
  lines: StatementLine[];
  payments: { id: string; type: string; number: string | null; status: DocumentStatus; total: string; date: string }[];
}
export interface StatementBody {
  organizationId?: string | null;
  period?: string;
  kind?: StatementKind;
  method?: PayoutMethod;
  date?: string;
  comment?: string;
  lines?: { id?: string; memberId: string; amount: string; comment?: string }[];
}

export interface SettlementsReport {
  items: { memberId: string; memberName: string; opening: string; accrued: string; withheld: string; paid: string; closing: string }[];
  totals: { opening: string; accrued: string; withheld: string; paid: string; closing: string };
}
export interface SummaryReport {
  byKind: { kindId: string; kindName: string; baseType: string; amount: string; ndfl: string; insurance: string }[];
  byWorkCenter: { workCenterId: string | null; workCenterName: string; accrued: string; insurance: string }[];
}
export interface Payslip {
  memberId: string;
  memberName: string;
  period: string;
  items: { kindName: string; baseType: string; base: string; rate: string; workedDays: number; normDays: number; amount: string; ndfl: string; deduction: boolean }[];
  totals: { accrued: string; ndfl: string; deductions: string; paid: string; debtAtEnd: string };
}

export function usePayrollKinds() {
  const ws = useWsId();
  return useQuery({ queryKey: payrollKey(ws, 'kinds'), queryFn: async () => (await call<{ items: PayrollKind[] }>(ws, 'GET', '/payroll/kinds')).items });
}
export function useReflections() {
  const ws = useWsId();
  return useQuery({ queryKey: payrollKey(ws, 'reflections'), queryFn: async () => (await call<{ items: Reflection[] }>(ws, 'GET', '/payroll/reflections')).items });
}
export function useEmployees() {
  const ws = useWsId();
  return useQuery({ queryKey: payrollKey(ws, 'employees'), queryFn: async () => (await call<{ items: Employee[] }>(ws, 'GET', '/payroll/employees')).items });
}
export function usePayrollSettings() {
  const ws = useWsId();
  return useQuery({ queryKey: payrollKey(ws, 'settings'), queryFn: () => call<{ insuranceRate: string }>(ws, 'GET', '/payroll/settings') });
}
export function usePayrolls() {
  const ws = useWsId();
  return useQuery({ queryKey: payrollKey(ws, 'list'), queryFn: () => call<{ items: PayrollListItem[]; total: number }>(ws, 'GET', '/payroll/documents?limit=100') });
}
export function usePayroll(id: string | undefined) {
  const ws = useWsId();
  return useQuery({ queryKey: payrollKey(ws, 'doc', id ?? ''), queryFn: () => call<PayrollDetail>(ws, 'GET', `/payroll/documents/${id}`), enabled: !!id });
}
export function useStatements() {
  const ws = useWsId();
  return useQuery({ queryKey: payrollKey(ws, 'statements'), queryFn: () => call<{ items: StatementListItem[]; total: number }>(ws, 'GET', '/payroll/statements?limit=100') });
}
export function useStatement(id: string | undefined) {
  const ws = useWsId();
  return useQuery({ queryKey: payrollKey(ws, 'statement', id ?? ''), queryFn: () => call<StatementDetail>(ws, 'GET', `/payroll/statements/${id}`), enabled: !!id });
}
export function useSettlementsReport(from: string, to: string) {
  const ws = useWsId();
  return useQuery({ queryKey: payrollKey(ws, 'report-settlements', from, to), queryFn: () => call<SettlementsReport>(ws, 'GET', `/payroll/reports/settlements?from=${from}&to=${to}`) });
}
export function useSummaryReport(from: string, to: string) {
  const ws = useWsId();
  return useQuery({ queryKey: payrollKey(ws, 'report-summary', from, to), queryFn: () => call<SummaryReport>(ws, 'GET', `/payroll/reports/summary?from=${from}&to=${to}`) });
}
export function usePayslip(period: string) {
  const ws = useWsId();
  return useQuery({ queryKey: payrollKey(ws, 'payslip', period), queryFn: () => call<Payslip>(ws, 'GET', `/payroll/payslip?period=${period}`) });
}

export function usePayrollApi() {
  const ws = useWsId();
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ['ws', ws, 'docs'] });
  const wrap = async <T>(p: Promise<T>): Promise<T> => {
    const r = await p;
    await refresh();
    return r;
  };
  return {
    savePayroll: (body: PayrollBody) => wrap(call<PayrollDetail>(ws, 'POST', '/payroll/documents', body)),
    updatePayroll: (id: string, body: PayrollBody) => wrap(call<PayrollDetail>(ws, 'PATCH', `/payroll/documents/${id}`, body)),
    fillPayroll: (id: string) => wrap(call<PayrollDetail>(ws, 'POST', `/payroll/documents/${id}/fill`, {})),
    saveStatement: (body: StatementBody) => wrap(call<StatementDetail>(ws, 'POST', '/payroll/statements', body)),
    updateStatement: (id: string, body: StatementBody) => wrap(call<StatementDetail>(ws, 'PATCH', `/payroll/statements/${id}`, body)),
    fillStatement: (id: string) => wrap(call<StatementDetail>(ws, 'POST', `/payroll/statements/${id}/fill`)),
    pay: (id: string, account: { cashRegisterId?: string | null; bankAccountId?: string | null }) => wrap(call<{ paymentId: string; statement: StatementDetail }>(ws, 'POST', `/payroll/statements/${id}/pay`, account)),
    action: (id: string, action: 'post' | 'unpost') => wrap(call(ws, 'POST', `/documents/${id}/${action}`)),
    remove: (id: string) => wrap(call(ws, 'DELETE', `/documents/${id}`)),
    updateEmployee: (memberId: string, body: Record<string, unknown>) => wrap(call(ws, 'PUT', `/payroll/employees/${memberId}`, body)),
    addAccrual: (body: Record<string, unknown>) => wrap(call(ws, 'POST', '/payroll/accruals', body)),
    removeAccrual: (id: string) => wrap(call(ws, 'DELETE', `/payroll/accruals/${id}`)),
    addReflection: (body: Record<string, unknown>) => wrap(call(ws, 'POST', '/payroll/reflections', body)),
    removeReflection: (id: string) => wrap(call(ws, 'DELETE', `/payroll/reflections/${id}`)),
    addKind: (body: Record<string, unknown>) => wrap(call(ws, 'POST', '/payroll/kinds', body)),
    removeKind: (id: string) => wrap(call(ws, 'DELETE', `/payroll/kinds/${id}`)),
    setInsuranceRate: (insuranceRate: string) => wrap(call(ws, 'PATCH', '/payroll/settings', { insuranceRate })),
    /** Реестр на банк: файл сохраняется через ссылку на blob */
    downloadRegistry: async (id: string) => {
      const res = await fetch(`${API_BASE()}/payroll/statements/${id}/registry`, { credentials: 'include', headers: { 'X-Workspace-Id': ws } });
      if (!res.ok) await ok(res);
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = 'salary-registry.csv';
      a.click();
      URL.revokeObjectURL(url);
    },
    /** Печатные формы с сервера (HTML) открываются в новой вкладке */
    openPrint: async (path: string) => {
      const res = await fetch(`${API_BASE()}${path}`, { credentials: 'include', headers: { 'X-Workspace-Id': ws } });
      if (!res.ok) await ok(res);
      window.open(URL.createObjectURL(new Blob([await res.text()], { type: 'text/html;charset=utf-8' })), '_blank');
    },
  };
}
