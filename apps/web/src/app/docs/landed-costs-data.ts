/* Дополнительные расходы в себестоимость на клиенте (задача 1385): журнал, карточка с распределением,
   основания для выбора и отчёт за период. Распределение сумм по строкам считает сервер; в форме то же самое
   считает чистая функция из @erp/shared (allocateLandedCost) — предпросмотр совпадает с проводкой до копейки. */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { LandedCostMethod } from '@erp/shared';
import { t } from '@/i18n';
import { errorMessage } from '../data/api';
import { call, useWsId } from '../meta/data';
import { docsKey } from './data';

export const landedKey = (ws: string, ...rest: unknown[]) => ['ws', ws, 'landed-costs', ...rest] as const;

/** Подписи способов распределения: динамический ключ словаря собирается здесь, а не в разметке */
export const METHOD_LABEL: Record<LandedCostMethod, string> = {
  get by_amount() {
    return t('landedCosts.methods.by_amount');
  },
  get by_qty() {
    return t('landedCosts.methods.by_qty');
  },
  get by_weight() {
    return t('landedCosts.methods.by_weight');
  },
  get manual() {
    return t('landedCosts.methods.manual');
  },
};

export interface LandedCostJournalRow {
  id: string;
  number: string | null;
  date: string;
  status: 'draft' | 'posted' | 'cancelled';
  method: LandedCostMethod;
  supplierName: string | null;
  costItemName: string | null;
  supplierDocument: string;
  comment: string;
  lineCount: number;
  /** null — суммы скрыты (видят admin и owner) */
  total: string | null;
}

export interface LandedCostJournal {
  items: LandedCostJournalRow[];
  total: number;
  amount: string | null;
  costVisible: boolean;
}

export interface LandedCostLine {
  id: string;
  baseDocumentId: string;
  baseDocumentNumber: string | null;
  baseDocumentDate: string | null;
  baseDocumentType: string | null;
  baseDocumentLineId: string;
  productId: string;
  productName: string;
  sku: string;
  unitCode: string;
  qty: string;
  baseAmount: string | null;
  weight: string;
  amount: string | null;
  sharePct: string | null;
}

export interface LandedCostDetail {
  id: string;
  number: string | null;
  date: string;
  status: 'draft' | 'posted' | 'cancelled';
  comment: string;
  organizationId: string;
  organizationName: string | null;
  method: LandedCostMethod;
  supplierId: string | null;
  supplierName: string | null;
  costItemId: string | null;
  costItemName: string | null;
  supplierDocumentId: string | null;
  supplierDocument: string;
  supplierDocumentRef: { id: string; number: string | null; date: string; type: string; total: string } | null;
  total: string | null;
  lines: LandedCostLine[];
}

export interface LandedCostBaseRow {
  id: string;
  number: string | null;
  date: string;
  type: 'receipt' | 'production';
  counterpartyName: string | null;
  total: string | null;
  /** Уже отнесённые на документ доп. расходы (проведёнными документами) */
  landedAmount: string | null;
}

export interface LandedCostBaseLine {
  lineId: string;
  baseDocumentId: string;
  productId: string;
  productName: string;
  sku: string;
  unitCode: string;
  qty: string;
  baseAmount: string | null;
  weight: string;
  weightKg: string | null;
}

export interface LandedCostReport {
  from: string;
  to: string;
  documents: { id: string; number: string | null; date: string; status: 'draft' | 'posted' | 'cancelled'; method: LandedCostMethod; supplierName: string | null; costItemName: string | null; total: string | null; lineCount: number }[];
  byCostItem: { costItemId: string; name: string; amount: string | null }[];
  byBase: { baseDocumentId: string; number: string | null; date: string; type: string; amount: string | null; linesCount: number }[];
  byProduct: { productId: string; name: string; sku: string; qty: string; amount: string | null }[];
  total: string | null;
  postedTotal: string | null;
  costVisible: boolean;
}

/** Строка распределения в форме: суммы по автоматическим способам считаются на клиенте */
export interface LandedCostLineDraft {
  id: string;
  baseDocumentId: string;
  baseDocumentNumber: string;
  baseDocumentLineId: string;
  productId: string;
  productName: string;
  sku: string;
  qty: string;
  baseAmount: string;
  weight: string;
  amount: string;
}

export interface LandedCostDraft {
  date: string;
  supplier: { id: string; name: string } | null;
  costItemId: string | null;
  supplierDocument: string;
  method: LandedCostMethod;
  /** Общая сумма расходов; при способе «вручную» её даёт сумма строк */
  amount: string;
  comment: string;
  lines: LandedCostLineDraft[];
}

const periodQuery = (from?: string, to?: string, q?: string) => {
  const sp = new URLSearchParams();
  if (from) sp.set('from', from);
  if (to) sp.set('to', to);
  if (q) sp.set('q', q);
  const s = sp.toString();
  return s ? `?${s}` : '';
};

export function useLandedCosts(params: { from?: string; to?: string; q?: string } = {}) {
  const ws = useWsId();
  return useQuery({
    queryKey: landedKey(ws, 'list', params),
    queryFn: () => call<LandedCostJournal>(ws, 'GET', `/landed-costs${periodQuery(params.from, params.to, params.q)}`),
    staleTime: Infinity,
    placeholderData: prev => prev,
  });
}

export function useLandedCost(id: string | undefined) {
  const ws = useWsId();
  return useQuery({
    queryKey: landedKey(ws, 'item', id ?? 'new'),
    queryFn: () => call<LandedCostDetail>(ws, 'GET', `/landed-costs/${id}`),
    enabled: !!id,
    staleTime: Infinity,
  });
}

/** Основания для выбора: проведённые поступления и выпуски за период */
export function useLandedCostBases(params: { from?: string; to?: string; q?: string } = {}, enabled = true) {
  const ws = useWsId();
  return useQuery({
    queryKey: landedKey(ws, 'bases', params),
    queryFn: () => call<{ items: LandedCostBaseRow[] }>(ws, 'GET', `/landed-costs/bases${periodQuery(params.from, params.to, params.q)}`),
    enabled,
    staleTime: Infinity,
    placeholderData: prev => prev,
  });
}

/** Приходные строки основания (товар, количество, стоимость, вес) */
export function useLandedCostBaseLines(documentId: string | null) {
  const ws = useWsId();
  return useQuery({
    queryKey: landedKey(ws, 'base-lines', documentId ?? ''),
    queryFn: () => call<{ document: { id: string; number: string | null; date: string; type: string }; lines: LandedCostBaseLine[] }>(ws, 'GET', `/landed-costs/bases/lines?documentId=${documentId}`),
    enabled: !!documentId,
    staleTime: Infinity,
  });
}

export function useLandedCostReport(from: string, to: string) {
  const ws = useWsId();
  return useQuery({
    queryKey: landedKey(ws, 'report', from, to),
    queryFn: () => call<LandedCostReport>(ws, 'GET', `/landed-costs/report?from=${from}&to=${to}`),
    staleTime: Infinity,
    placeholderData: prev => prev,
  });
}

/** Изменения документа: сохранение, проведение, отмена проведения, удаление. После любого —
    журнал, карточки и отчёт перечитываются; проведение меняет себестоимость, поэтому и складские запросы ('docs'). */
export function useLandedCostApi() {
  const ws = useWsId();
  const qc = useQueryClient();
  const after = async () => {
    await qc.invalidateQueries({ queryKey: landedKey(ws) });
    await qc.invalidateQueries({ queryKey: docsKey(ws) });
  };
  const run = <T>(path: string, method: string, body?: unknown) => call<T>(ws, method, path, body);
  const wrap = <A extends unknown[], R>(fn: (...args: A) => Promise<R>) => async (...args: A) => {
    try {
      const res = await fn(...args);
      await after();
      return res;
    } catch (e) {
      throw new Error(errorMessage(e));
    }
  };
  return {
    save: wrap((body: LandedCostBody) => run<LandedCostDetail>('/landed-costs', 'POST', body)),
    update: wrap((id: string, body: LandedCostBody) => run<LandedCostDetail>(`/landed-costs/${id}`, 'PATCH', body)),
    post: wrap((id: string) => run<LandedCostDetail>(`/landed-costs/${id}/post`, 'POST')),
    unpost: wrap((id: string) => run<LandedCostDetail>(`/landed-costs/${id}/unpost`, 'POST')),
    remove: wrap((id: string) => run<{ ok: true }>(`/landed-costs/${id}`, 'DELETE')),
  };
}

/** Тело запроса сохранения: суммы строк отправляются только для ручного распределения */
export interface LandedCostBody {
  date: string;
  supplierId: string | null;
  costItemId: string | null;
  supplierDocument: string;
  method: LandedCostMethod;
  amount: string | null;
  comment: string;
  lines: { id?: string; baseDocumentId: string; baseDocumentLineId: string; amount?: string | null }[];
}

/** Строки распределения для тела запроса */
export function bodyLines(draft: LandedCostDraft): LandedCostBody['lines'] {
  return draft.lines.map(l => ({
    id: l.id,
    baseDocumentId: l.baseDocumentId,
    baseDocumentLineId: l.baseDocumentLineId,
    ...(draft.method === 'manual' ? { amount: l.amount } : {}),
  }));
}
