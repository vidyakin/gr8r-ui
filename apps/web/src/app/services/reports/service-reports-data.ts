/* Отчёты услуг (задача 1097): типы ответов и запросы GET /services/reports/<имя>.
   Ключи кэша под ['ws', id, 'docs', 'service-reports', …]: события документов обновляют их вместе с журналами. */
import { useQuery } from '@tanstack/react-query';
import { call, useWsId } from '../../meta/data';
import { docsKey } from '../../docs/data';

export interface ServiceReportFilter {
  from: string;
  to: string;
  counterpartyId?: string | undefined;
  assigneeId?: string | undefined;
  kindId?: string | undefined;
}

export interface StatesOrderRow {
  documentId: string;
  number: string | null;
  date: string;
  dueDate: string | null;
  status: string;
  kindId: string | null;
  kindName: string | null;
  state: string | null;
  stateLabel: string | null;
  category: string | null;
  counterpartyId: string | null;
  counterpartyName: string | null;
  amountNet: string;
  total: string;
  overdue: boolean;
  overdueDays: number;
  overdueReasons: ('due' | 'assignment')[];
  plannedHours: string;
  actualHours: string;
  completionPct: string | null;
}

export interface StatesSummaryRow {
  kindId: string | null;
  kindName: string | null;
  category: string | null;
  state: string | null;
  stateLabel: string | null;
  count: number;
  amountNet: string;
  total: string;
  overdue: number;
  plannedHours: string;
  actualHours: string;
  completionPct: string | null;
}

export interface StatesReport {
  rows: StatesOrderRow[];
  summary: StatesSummaryRow[];
  totals: { count: number; amountNet: string; total: string; overdue: number; plannedHours: string; actualHours: string; completionPct: string | null };
}

export interface ScheduleRow {
  assignmentId: string;
  documentId: string;
  number: string | null;
  counterpartyName: string | null;
  taskKey: string;
  title: string;
  assigneeId: string | null;
  assigneeName: string | null;
  plannedHours: string;
  actualHours: string;
  deviationHours: string;
  plannedEnd: string | null;
  closedDate: string | null;
  closed: boolean;
  deviationDays: number | null;
}

export interface ScheduleReport {
  rows: ScheduleRow[];
  byAssignee: { assigneeId: string | null; assigneeName: string | null; plannedHours: string; actualHours: string }[];
}

export interface ServiceLoadDay {
  date: string | null;
  capacity: string;
  planned: string;
  fact: string;
  overloaded: boolean;
}

export interface ServiceLoadRow {
  memberId: string;
  memberName: string;
  capacity: string;
  planned: string;
  fact: string;
  plannedPct: string | null;
  factPct: string | null;
  overloaded: boolean;
  undated: string;
  days: ServiceLoadDay[];
}

export interface ClientsRow {
  counterpartyId: string | null;
  counterpartyName: string | null;
  orders: number;
  documents: number;
  revenueServices: string;
  revenueGoods: string;
  revenue: string;
  /** Себестоимость, маржа и процент — только admin и owner (иначе null) */
  cost: string | null;
  margin: string | null;
  marginPct: string | null;
}

export interface ClientsReport {
  rows: ClientsRow[];
  totals: Omit<ClientsRow, 'counterpartyId' | 'counterpartyName'>;
}

const qs = (p: Record<string, string | undefined>) => new URLSearchParams(Object.entries(p).filter((e): e is [string, string] => !!e[1])).toString();

function useReport<T>(name: string, f: ServiceReportFilter) {
  const ws = useWsId();
  const query = qs({ ...f });
  return useQuery({ queryKey: docsKey(ws, 'service-reports', name, query), queryFn: () => call<T>(ws, 'GET', `/services/reports/${name}?${query}`), enabled: !!f.from && !!f.to });
}

export const useStatesReport = (f: ServiceReportFilter) => useReport<StatesReport>('states', f);
export const useScheduleReport = (f: ServiceReportFilter) => useReport<ScheduleReport>('schedule', f);
export const useServiceLoadReport = (f: ServiceReportFilter) => useReport<{ rows: ServiceLoadRow[] }>('load', f);
export const useClientsReport = (f: ServiceReportFilter) => useReport<ClientsReport>('clients', f);
