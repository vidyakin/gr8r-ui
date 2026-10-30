/* Запись на приём (задача 1171): типы и запросы /appointments/*. Ключи кэша под ['ws', id, 'docs', 'appointments', …]:
   события appointment, specialist_schedule и document обновляют их вместе с остальными журналами. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AppointmentStatus, ScheduleDef, ScheduleException } from '@gr8r/shared';
import { call, useWsId } from '../meta/data';
import { docsKey } from '../docs/data';

export type { AppointmentStatus };

export interface Appt {
  id: string;
  specialistId: string;
  contactId: string | null;
  companyId: string | null;
  productId: string;
  date: string;
  startMin: number;
  endMin: number;
  slots: number;
  slotMinutes: number;
  status: AppointmentStatus;
  cancelReason: string | null;
  price: string;
  comment: string;
  dayLineId: string | null;
  workOrderId: string | null;
  workOrderNumber: string | null;
  clientName: string;
  contactPhone: string | null;
  productName: string | null;
  specialistName: string | null;
}
export interface DayColumn {
  specialistId: string;
  date: string;
  working: number[];
  slotMinutes: number;
  dayStartMin: number;
  dayEndMin: number;
  holiday: boolean;
  unclosed: boolean;
  appointments: Appt[];
}
export interface SpecialistColumn extends DayColumn {
  name: string;
  color: string;
}
export interface Specialist {
  memberId: string;
  name: string;
  color: string;
  slotMinutes: number;
  dayStartMin: number;
  dayEndMin: number;
  /** Оказываемые виды номенклатуры (задача 1172); null — любые услуги */
  productKindIds: string[] | null;
}
export interface ScheduleView {
  memberId: string;
  name: string;
  schedule: ScheduleDef | null;
  exceptions: (ScheduleException & { note: string })[];
  holidays: string[];
}
export interface UnclosedDay {
  specialistId: string;
  specialistName: string;
  date: string;
  count: number;
  documentId: string | null;
}
export interface DayLine {
  id: string;
  companyId: string;
  companyName: string;
  contactId: string | null;
  contactName: string | null;
  productId: string;
  productName: string;
  startMin: number | null;
  qty: string;
  price: string;
  amount: string;
}
export interface DayDoc {
  id: string;
  number: string | null;
  date: string;
  status: 'draft' | 'posted' | 'cancelled';
  comment: string;
  total: string;
  specialistId: string;
  specialistName: string;
  lines: DayLine[];
  sales: { id: string; number: string | null; type: string; total: string }[];
}
export interface FreeSlot {
  memberId: string;
  date: string;
  startMin: number;
  slots: number;
  specialistName: string;
}

const key = (ws: string, ...rest: unknown[]) => docsKey(ws, 'appointments', ...rest);

export const useSpecialists = () => {
  const ws = useWsId();
  return useQuery({ queryKey: key(ws, 'specialists'), queryFn: async () => (await call<{ items: Specialist[] }>(ws, 'GET', '/appointments/specialists')).items });
};
export const useDayBoard = (date: string) => {
  const ws = useWsId();
  return useQuery({ queryKey: key(ws, 'day', date), queryFn: () => call<{ date: string; columns: SpecialistColumn[] }>(ws, 'GET', `/appointments/day?date=${date}`) });
};
export const useWeekBoard = (specialistId: string | undefined, from: string) => {
  const ws = useWsId();
  return useQuery({ queryKey: key(ws, 'week', specialistId, from), enabled: !!specialistId, queryFn: () => call<{ days: DayColumn[]; name: string }>(ws, 'GET', `/appointments/week?specialistId=${specialistId}&from=${from}`) });
};
export const useSchedule = (memberId: string | undefined) => {
  const ws = useWsId();
  return useQuery({ queryKey: key(ws, 'schedule', memberId), enabled: !!memberId, queryFn: () => call<ScheduleView>(ws, 'GET', `/appointments/schedules/${memberId}`) });
};
export const useUnclosedDays = () => {
  const ws = useWsId();
  return useQuery({ queryKey: key(ws, 'unclosed'), queryFn: async () => (await call<{ items: UnclosedDay[] }>(ws, 'GET', '/appointments/unclosed-days')).items });
};
export const useClientAppointments = (f: { contactId?: string; companyId?: string }) => {
  const ws = useWsId();
  const qs = new URLSearchParams({ ...(f.contactId ? { contactId: f.contactId } : {}), ...(f.companyId ? { companyId: f.companyId } : {}), limit: '200' }).toString();
  return useQuery({ queryKey: key(ws, 'client', qs), queryFn: async () => (await call<{ items: Appt[] }>(ws, 'GET', `/appointments?${qs}`)).items });
};
export const useDayDoc = (id: string | undefined) => {
  const ws = useWsId();
  return useQuery({ queryKey: key(ws, 'doc', id), enabled: !!id, queryFn: () => call<DayDoc>(ws, 'GET', `/appointments/day-documents/${id}`) });
};
export const useFreeSlot = () => {
  const ws = useWsId();
  return useMutation({ mutationFn: (q: { productId: string; specialistId?: string; from?: string }) => call<{ slot: FreeSlot | null }>(ws, 'GET', `/appointments/free?${new URLSearchParams(Object.entries(q).filter((e): e is [string, string] => !!e[1])).toString()}`) });
};

/** Любая запись/действие: после успеха обновляется всё под appointments */
export const useApptMutation = <T,>(method: 'POST' | 'PATCH' | 'PUT' | 'DELETE') => {
  const ws = useWsId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: { path: string; body?: unknown }) => call<T>(ws, method, `/appointments${a.path}`, a.body),
    onSuccess: () => qc.invalidateQueries({ queryKey: key(ws) }),
  });
};
