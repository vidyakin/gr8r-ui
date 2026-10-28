/* Ввод начальных остатков на клиенте: журнал, карточка и запись документа. Ключи — под ['ws', id, 'docs', 'money', …]. */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { DocumentStatus } from '@gr8r/shared';
import { call, useWsId } from '../meta/data';
import { moneyKey } from './data';

export type OpeningKind = 'cash' | 'bank' | 'customer_debt' | 'customer_advance' | 'supplier_debt' | 'supplier_advance';
export interface OpeningLine {
  id: string;
  kind: OpeningKind;
  cashRegisterId: string | null;
  bankAccountId: string | null;
  counterpartyId: string | null;
  counterpartyName: string | null;
  contractId: string | null;
  settlementDocumentId: string | null;
  settlementDocumentLabel: string | null;
  amount: string;
  comment: string;
}
export interface OpeningListItem {
  id: string;
  number: string | null;
  date: string;
  status: DocumentStatus;
  total: string;
  comment: string;
  organizationId: string;
  organizationName: string;
}
export interface OpeningDetail {
  id: string;
  number: string | null;
  date: string;
  status: DocumentStatus;
  organizationId: string;
  comment: string;
  total: string;
  lines: OpeningLine[];
}
export interface OpeningBody {
  organizationId?: string | null;
  date?: string;
  comment?: string;
  lines?: Partial<OpeningLine>[];
}

export function useOpenings() {
  const ws = useWsId();
  return useQuery({ queryKey: moneyKey(ws, 'openings'), queryFn: () => call<{ items: OpeningListItem[]; total: number }>(ws, 'GET', '/opening-balances?limit=100') });
}

export function useOpening(id: string | undefined) {
  const ws = useWsId();
  return useQuery({ queryKey: moneyKey(ws, 'opening', id ?? ''), queryFn: () => call<OpeningDetail>(ws, 'GET', `/opening-balances/${id}`), enabled: !!id });
}

export function useOpeningApi() {
  const ws = useWsId();
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ['ws', ws, 'docs'] });
  return {
    save: async (body: OpeningBody) => {
      const r = await call<OpeningDetail>(ws, 'POST', '/opening-balances', body);
      await refresh();
      return r;
    },
    update: async (id: string, body: OpeningBody) => {
      const r = await call<OpeningDetail>(ws, 'PATCH', `/opening-balances/${id}`, body);
      await refresh();
      return r;
    },
    action: async (id: string, action: 'post' | 'unpost') => {
      await call(ws, 'POST', `/documents/${id}/${action}`);
      await refresh();
    },
    remove: async (id: string) => {
      await call(ws, 'DELETE', `/documents/${id}`);
      await refresh();
    },
  };
}
