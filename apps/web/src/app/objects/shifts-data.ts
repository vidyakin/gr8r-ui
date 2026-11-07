/* Табель прораба на клиенте (задача 1271, docs/architecture/construction.md): смены объекта, часы бригады,
   сменный отчёт объёмов, табель за период, бейджи и рабочие без входа.
   Запросы живут под ['ws', id, 'objects', …] и ['ws', id, 'shifts', …]: событие object_shift.* сбрасывает их через realtime.
   Ставки и суммы сервер отдаёт только owner/admin — остальным приходит null. */
import { withPrintCsp } from '@/lib/print-csp';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { API_BASE, ok } from '../data/api';
import { call, useWsId } from '../meta/data';

export interface ShiftObjectOption {
  id: string;
  number: string;
  name: string;
  status: string;
}

export interface ShiftHourView {
  id: string;
  memberId: string;
  memberName: string;
  personnelNumber: string | null;
  estimateItemId: string | null;
  estimateItemName: string | null;
  hours: string;
  costRate: string | null;
  costAmount: string | null;
  note: string;
}

export interface ShiftVolumeView {
  id: string;
  estimateItemId: string;
  estimateItemName: string;
  unitCode: string;
  qty: string;
}

export interface ShiftLogView {
  id: string;
  at: string;
  authorId: string | null;
  authorName: string | null;
  action: string;
  reason: string;
  before: unknown;
  after: unknown;
}

export interface ShiftView {
  id: string;
  objectId: string;
  objectNumber: string;
  objectName: string;
  workDate: string;
  foremanId: string;
  foremanName: string;
  status: 'draft' | 'confirmed';
  confirmedBy: string | null;
  confirmedAt: string | null;
  note: string;
  hours: ShiftHourView[];
  volumes: ShiftVolumeView[];
  totalHours: string;
  /** Сумма смены: только owner/admin, остальным null */
  totalAmount: string | null;
  noRate: number;
  canSeeCost: boolean;
  canWrite: boolean;
  log: ShiftLogView[];
  createdAt: string;
  updatedAt: string;
  /** Коды предупреждений контроля бюджета при подтверждении */
  warnings?: string[];
}

export interface ShiftListItem {
  id: string;
  workDate: string;
  status: 'draft' | 'confirmed';
  foremanId: string;
  foremanName: string;
  note: string;
  totalHours: string;
  totalAmount: string | null;
  confirmedAt: string | null;
  employees: number;
  noRate: number;
}

export interface ObjectShiftsView {
  objectId: string;
  canSeeCost: boolean;
  items: ShiftListItem[];
}

export interface ObjectTimesheetView {
  objectId: string;
  from: string;
  to: string;
  days: string[];
  rows: { memberId: string; memberName: string; personnelNumber: string | null; hours: string[]; total: string; noRate: boolean }[];
  totalByDay: string[];
  total: string;
}

export interface ShiftOptions {
  objectId: string;
  members: { id: string; name: string; title: string; personnelNumber: string | null; badgeCode: string | null }[];
  workItems: { id: string; estimateId: string; estimateName: string; name: string; unitCode: string; qty: string; doneQty: string; laborHours: string }[];
  volumeItems: { id: string; name: string; unitCode: string; qty: string; doneQty: string }[];
  foremanId: string;
}

export interface ShiftHourInput {
  memberId: string;
  hours: string;
  estimateItemId?: string | null;
  note?: string;
}

export interface ShiftVolumeInput {
  estimateItemId: string;
  qty: string;
}

export interface ShiftSaveBody {
  hours?: ShiftHourInput[];
  volumes?: ShiftVolumeInput[];
  note?: string;
  /** Причина правки подтверждённой смены (только admin/owner) */
  reason?: string;
}

/** Рабочий по коду бейджа: { memberId, name, personnelNumber, badgeCode } */
export interface BadgeLookup {
  memberId: string;
  name: string;
  personnelNumber: string | null;
  badgeCode: string;
}

export const shiftsKey = (ws: string, ...rest: unknown[]) => ['ws', ws, 'shifts', ...rest] as const;

/** Объекты, на которых участник может вести смену: прорабу — только свои */
export function useShiftObjects() {
  const ws = useWsId();
  return useQuery({ queryKey: shiftsKey(ws, 'objects'), queryFn: () => call<{ items: ShiftObjectOption[] }>(ws, 'GET', '/shifts/objects').then(r => r.items) });
}

export function useShift(id: string | undefined) {
  const ws = useWsId();
  return useQuery({ queryKey: shiftsKey(ws, 'detail', id), queryFn: () => call<ShiftView>(ws, 'GET', `/shifts/${id}`), enabled: !!id });
}

export function useShiftOptions(objectId: string | undefined) {
  const ws = useWsId();
  return useQuery({ queryKey: shiftsKey(ws, 'options', objectId), queryFn: () => call<ShiftOptions>(ws, 'GET', `/objects/${objectId}/shifts/options`), enabled: !!objectId });
}

export function useObjectShifts(objectId: string | undefined, from: string, to: string) {
  const ws = useWsId();
  return useQuery({
    queryKey: shiftsKey(ws, 'list', objectId, from, to),
    queryFn: () => call<ObjectShiftsView>(ws, 'GET', `/objects/${objectId}/shifts?from=${from}&to=${to}`),
    enabled: !!objectId,
  });
}

export function useObjectTimesheet(objectId: string | undefined, from: string, to: string) {
  const ws = useWsId();
  return useQuery({
    queryKey: shiftsKey(ws, 'timesheet', objectId, from, to),
    queryFn: () => call<ObjectTimesheetView>(ws, 'GET', `/objects/${objectId}/timesheet?from=${from}&to=${to}`),
    enabled: !!objectId,
  });
}

/** Действия со сменой: после каждой записи перечитываются смены, объекты (бюджет и объёмы) и табель */
export function useShiftApi() {
  const ws = useWsId();
  const qc = useQueryClient();
  const done = async () => {
    await qc.invalidateQueries({ queryKey: ['ws', ws, 'shifts'] });
    await qc.invalidateQueries({ queryKey: ['ws', ws, 'objects'] });
    await qc.invalidateQueries({ queryKey: ['ws', ws, 'estimates'] });
  };
  const wrap = async <T>(p: Promise<T>): Promise<T> => {
    const r = await p;
    await done();
    return r;
  };
  return {
    create: (objectId: string, body: { workDate: string; foremanId?: string | null; note?: string }) =>
      wrap(call<ShiftView>(ws, 'POST', `/objects/${objectId}/shifts`, body)),
    save: (id: string, body: ShiftSaveBody) => wrap(call<ShiftView>(ws, 'PUT', `/shifts/${id}`, body)),
    confirm: (id: string) => wrap(call<ShiftView>(ws, 'POST', `/shifts/${id}/confirm`, {})),
    unconfirm: (id: string, reason: string) => wrap(call<ShiftView>(ws, 'POST', `/shifts/${id}/unconfirm`, { reason })),
  };
}

/* ---------------- бейджи и рабочие без входа ---------------- */

/** Выпуск и перевыпуск бейджа: новый код заменяет старый, старый отзывается */
export function useIssueBadge() {
  const ws = useWsId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { memberId: string; personnelNumber?: string | null }) => call<BadgeLookup>(ws, 'POST', `/members/${body.memberId}/badge`, { personnelNumber: body.personnelNumber }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['ws', ws, 'members'] });
      await qc.invalidateQueries({ queryKey: ['ws', ws, 'shifts'] });
    },
  });
}

/** Поиск работника по коду бейджа (скан камеры или ручной ввод); неизвестный код — ошибка badge_not_found */
export function useBadgeLookup() {
  const ws = useWsId();
  return useMutation({ mutationFn: (code: string) => call<BadgeLookup>(ws, 'GET', `/members/badge/${encodeURIComponent(code)}`) });
}

/** Рабочий без входа: участник воркспейса без учётной записи */
export function useCreateWorker() {
  const ws = useWsId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; personnelNumber?: string }) => call<{ id: string; name: string }>(ws, 'POST', '/members/workers', body),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['ws', ws, 'members'] });
      await qc.invalidateQueries({ queryKey: ['ws', ws, 'shifts'] });
    },
  });
}

/** Печатная страница бейджей в новой вкладке: ?ids= — только выбранные участники (как печать в зарплате) */
export async function openBadgesPrint(ws: string, ids?: string[]): Promise<void> {
  const qs = ids?.length ? `?ids=${ids.join(',')}` : '';
  const res = await fetch(`${API_BASE()}/members/badges/print${qs}`, { credentials: 'include', headers: { 'X-Workspace-Id': ws } });
  if (!res.ok) await ok(res);
  window.open(URL.createObjectURL(new Blob([withPrintCsp(await res.text())], { type: 'text/html;charset=utf-8' })), '_blank');
}
