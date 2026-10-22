/* Планирование загрузки на клиенте: загрузка строк (сотрудники, участки, ресурсы), полосы плана,
   справочник ресурсов, сменные графики, праздники и исключения. */
import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/components/ui';
import { errorMessage } from '../data/api';
import { call, useWsId } from '../meta/data';

/** Строка загрузки: сотрудник, участок или ресурс */
export interface PlannerRow {
  rowId: string;
  rowType: 'member' | 'work_center' | 'resource';
  name: string;
  days: { date: string; hours: string; capacity: string; overloaded: boolean }[];
  totalHours: string;
  overloaded: boolean;
}

/** Полоса плана: операция, назначение или работа ресурса */
export interface PlannerEntry {
  id: string;
  kind: 'operation' | 'assignment' | 'resource';
  title: string;
  rowType: 'member' | 'work_center' | 'resource';
  rowId: string;
  start: string;
  end: string;
  hours: string;
  documentId: string | null;
  memberId: string | null;
  workCenterId: string | null;
  resourceId: string | null;
  assignmentId: string | null;
  taskId: string | null;
}

/** Сменный график */
export interface WorkCalendar {
  id: string;
  name: string;
  kind: 'weekly' | 'cycle';
  pattern: { weekdays?: number[]; startHour?: number; endHour?: number; cycle?: number[] };
  cycleStart: string | null;
  hoursPerDay: string;
  isDefault: boolean;
  note: string;
}

/** Ключевой ресурс */
export interface Resource {
  id: string;
  code: string;
  name: string;
  kind: 'equipment' | 'other';
  workCenterId: string | null;
  capacityUnits: number;
  calendarId: string | null;
  note: string;
  archivedAt: string | null;
}

/** Исключение из графика */
export interface CalendarException {
  id: string;
  scope: 'member' | 'work_center' | 'resource';
  scopeId: string;
  dateFrom: string;
  dateTo: string;
  note: string;
}

/** Ресурс документа (закладка «Ресурсы») */
export interface DocumentResource {
  id: string;
  documentId: string;
  lineId: string | null;
  resourceId: string;
  startAt: string | null;
  endAt: string | null;
  hours: string;
  sortOrder: number;
}

export type LoadRowType = 'member' | 'work_center' | 'resource';

export const planningKey = (ws: string, ...rest: unknown[]) => ['ws', ws, 'planning', ...rest] as const;

/* ---------------- часовой план услуг ---------------- */

/** Слот часовой загрузки (час) */
export interface ServiceSlot {
  start: string;
  end: string;
  /** Занято часов в слоте */
  used: string;
  /** Доступно часов в слоте (ноль — нерабочее время) */
  capacity: string;
  working: boolean;
  overloaded: boolean;
}

/** Строка часового плана: сотрудник или ресурс */
export interface ServiceScheduleRow {
  rowId: string;
  rowType: 'member' | 'resource';
  name: string;
  capacityUnits: number;
  slots: ServiceSlot[];
  totalHours: string;
  bookedHours: string;
  overloaded: boolean;
}

/** Полоса часового плана: назначение заказ-наряда или работа ресурса */
export interface ServiceScheduleEntry {
  id: string;
  kind: 'assignment' | 'resource';
  title: string;
  rowType: 'member' | 'resource';
  rowId: string;
  startAt: string;
  endAt: string;
  hours: string;
  documentId: string | null;
  taskId: string | null;
  memberId: string | null;
  resourceId: string | null;
}

/** Предупреждение о перегрузке */
export interface ServiceWarning {
  code: 'member_overlap' | 'resource_overload' | 'outside_shift' | 'over_capacity';
  rowType: 'member' | 'resource';
  rowId: string;
  entryIds: string[];
  message: string;
}

/** Часовой план услуг: строки, полосы и предупреждения */
export function useServiceSchedule(from: string, to: string, resource: 'member' | 'resource') {
  const ws = useWsId();
  return useQuery({
    queryKey: planningKey(ws, 'schedule', from, to, resource),
    queryFn: () => call<{ rows: ServiceScheduleRow[]; entries: ServiceScheduleEntry[]; warnings: ServiceWarning[]; timeZone: string }>(ws, 'GET', `/services/schedule?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&resource=${resource}`),
    staleTime: 15_000,
  });
}

/** Загрузка за период: строки с часами по дням и полосы плана */
export function useLoad(from: string, to: string, rowType: LoadRowType) {
  const ws = useWsId();
  return useQuery({
    queryKey: planningKey(ws, 'load', from, to, rowType),
    queryFn: () => call<{ rows: PlannerRow[]; entries: PlannerEntry[]; holidays: string[] }>(ws, 'GET', `/production/load?from=${from}&to=${to}&rowType=${rowType}`),
    staleTime: 15_000,
  });
}

/** Справочник ключевых ресурсов */
export function useResources() {
  const ws = useWsId();
  return useQuery({ queryKey: planningKey(ws, 'resources'), queryFn: () => call<{ items: Resource[] }>(ws, 'GET', '/production/resources'), staleTime: 30_000 });
}

/** Сменные графики */
export function useCalendars() {
  const ws = useWsId();
  return useQuery({ queryKey: planningKey(ws, 'calendars'), queryFn: () => call<{ items: WorkCalendar[] }>(ws, 'GET', '/production/calendars'), staleTime: 30_000 });
}

/** Праздники воркспейса */
export function useHolidays() {
  const ws = useWsId();
  return useQuery({ queryKey: planningKey(ws, 'holidays'), queryFn: () => call<{ items: { date: string; name: string }[] }>(ws, 'GET', '/production/holidays'), staleTime: 30_000 });
}

/** Исключения из графика */
export function useCalendarExceptions() {
  const ws = useWsId();
  return useQuery({ queryKey: planningKey(ws, 'exceptions'), queryFn: () => call<{ items: CalendarException[] }>(ws, 'GET', '/production/calendar-exceptions'), staleTime: 30_000 });
}

/** Ресурсы документа */
export function useDocumentResources(documentId: string | undefined) {
  const ws = useWsId();
  return useQuery({
    queryKey: planningKey(ws, 'document-resources', documentId ?? ''),
    queryFn: () => call<{ items: DocumentResource[] }>(ws, 'GET', `/production/document-resources?documentId=${documentId}`),
    enabled: !!documentId,
    staleTime: 15_000,
  });
}

/** Норматив потребности в ресурсах у товара (операции или работы) */
export function useProductResources(productId: string | undefined) {
  const ws = useWsId();
  return useQuery({
    queryKey: planningKey(ws, 'product-resources', productId ?? ''),
    queryFn: () => call<{ items: { resourceId: string; name: string; hoursPerUnit: string }[] }>(ws, 'GET', `/production/product-resources?productId=${productId}`),
    enabled: !!productId,
    staleTime: 30_000,
  });
}

/** Вызов API планирования с обновлением кэша */
export function usePlanningApi() {
  const ws = useWsId();
  const qc = useQueryClient();
  return React.useCallback(
    async <T,>(method: string, path: string, json?: unknown): Promise<T | null> => {
      try {
        const r = await call<T>(ws, method, path, json);
        await qc.invalidateQueries({ queryKey: planningKey(ws) });
        return r;
      } catch (e) {
        toast.error(errorMessage(e));
        return null;
      }
    },
    [ws, qc],
  );
}
