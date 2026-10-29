/* Лиды на клиенте (задача 1175, docs/architecture/leads.md): типы ответов и запросы /leads, /lead-statuses, /lead-forms.
   Ключи кэша ['ws', id, 'leads', …]: события lead / lead_status / lead_form / crm_activity / company / contact / deal обновляют их (data/realtime.ts). */
import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { LeadStatusCategory } from '@gr8r/shared';
import { toast } from '@/components/ui';
import { API_BASE, errorMessage } from '../data/api';
import { call, useWsId } from '../meta/data';

export interface LeadStatus {
  id: string;
  name: string;
  category: LeadStatusCategory;
  color: string;
  sortOrder: number;
}

export interface Lead {
  id: string;
  name: string;
  companyName: string;
  phone: string;
  phoneNorm: string;
  email: string;
  comment: string;
  /** Название источника (кэш); источник и кампания — задача 1177 */
  source: string;
  sourceId: string | null;
  campaignId: string | null;
  referrerCompanyId: string | null;
  referrerContactId: string | null;
  ownerId: string | null;
  statusId: string;
  rejectReason: string;
  formId: string | null;
  custom: Record<string, unknown>;
  convertedAt: string | null;
  companyId: string | null;
  contactId: string | null;
  dealId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LeadForm {
  id: string;
  name: string;
  source: string;
  sourceId: string | null;
  campaignId: string | null;
  defaultOwnerId: string | null;
  enabled: boolean;
  /** Полный токен вебхука `<воркспейс>.<секрет>`; пусто, если у пользователя нет прав admin */
  webhookToken: string;
}

export interface LeadActivity {
  id: string;
  type: 'call' | 'email' | 'meeting' | 'note' | 'task';
  subject: string;
  body: string | null;
  system: boolean;
  authorId: string | null;
  createdAt: string;
}

export interface DuplicateMatch {
  kind: 'lead' | 'contact' | 'company';
  id: string;
  name: string;
  by: 'phone' | 'email' | 'contact' | 'name';
  companyId?: string | null;
  phone?: string;
  email?: string;
}

export type ConvertTarget = { mode: 'existing'; id: string } | { mode: 'new'; name: string } | { mode: 'none' };
export interface ConvertBody {
  company: ConvertTarget;
  contact: ConvertTarget;
  deal: { name: string; amount?: string } | null;
}

export const leadsKey = (ws: string, ...rest: unknown[]) => ['ws', ws, 'leads', ...rest] as const;

export function useLeadStatuses() {
  const ws = useWsId();
  return useQuery({ queryKey: leadsKey(ws, 'statuses'), queryFn: async () => (await call<{ items: LeadStatus[] }>(ws, 'GET', '/lead-statuses?limit=200&sort=sortOrder')).items, staleTime: Infinity });
}

export function useLeadForms() {
  const ws = useWsId();
  return useQuery({ queryKey: leadsKey(ws, 'forms'), queryFn: async () => (await call<{ items: LeadForm[] }>(ws, 'GET', '/lead-forms?limit=200')).items, staleTime: Infinity });
}

export function useLeads(q: string) {
  const ws = useWsId();
  return useQuery({
    queryKey: leadsKey(ws, 'list', q),
    queryFn: async () => (await call<{ items: Lead[]; total: number }>(ws, 'GET', `/leads?limit=200&sort=-createdAt${q ? `&q=${encodeURIComponent(q)}` : ''}`)).items,
    staleTime: Infinity,
  });
}

export function useLead(id: string | null) {
  const ws = useWsId();
  return useQuery({ queryKey: leadsKey(ws, 'one', id), enabled: !!id, queryFn: () => call<Lead>(ws, 'GET', `/leads/${id}`), staleTime: Infinity });
}

export function useLeadActivities(id: string | null) {
  const ws = useWsId();
  return useQuery({
    queryKey: leadsKey(ws, 'activities', id),
    enabled: !!id,
    queryFn: async () => (await call<{ items: LeadActivity[] }>(ws, 'GET', `/crm-activities?leadId=${id}&limit=200&sort=-createdAt`)).items,
    staleTime: Infinity,
  });
}

export function useLeadDuplicates(id: string | null) {
  const ws = useWsId();
  return useQuery({ queryKey: leadsKey(ws, 'duplicates', id), enabled: !!id, queryFn: async () => (await call<{ items: DuplicateMatch[] }>(ws, 'GET', `/leads/${id}/duplicates`)).items, staleTime: Infinity });
}

/** Поиск дублей при вводе в форме нового лида (с задержкой) */
export function useDuplicatesFor(f: { phone: string; email: string; companyName: string }) {
  const ws = useWsId();
  const [debounced, setDebounced] = React.useState(f);
  React.useEffect(() => {
    const h = setTimeout(() => setDebounced(f), 400);
    return () => clearTimeout(h);
  }, [f.phone, f.email, f.companyName]); // eslint-disable-line react-hooks/exhaustive-deps
  const qs = new URLSearchParams();
  if (debounced.phone.trim()) qs.set('phone', debounced.phone.trim());
  if (debounced.email.trim()) qs.set('email', debounced.email.trim());
  if (debounced.companyName.trim()) qs.set('companyName', debounced.companyName.trim());
  const has = qs.toString().length > 0;
  return useQuery({ queryKey: leadsKey(ws, 'dup-new', qs.toString()), enabled: has, queryFn: async () => (await call<{ items: DuplicateMatch[] }>(ws, 'GET', `/leads/duplicates?${qs}`)).items, staleTime: 30_000 });
}

/** Вызов API лидов: тост при ошибке, null при ошибке; кэш обновляет realtime по событиям, но сразу помечаем и локально */
export function useLeadsApi() {
  const ws = useWsId();
  const qc = useQueryClient();
  return React.useCallback(
    async <T,>(method: string, path: string, json?: unknown): Promise<T | null> => {
      try {
        const r = await call<T>(ws, method, path, json);
        void qc.invalidateQueries({ queryKey: leadsKey(ws) });
        return r;
      } catch (e) {
        toast.error(errorMessage(e));
        return null;
      }
    },
    [ws, qc],
  );
}

/** Адрес вебхука формы (абсолютный, для вставки на сайт) */
export function webhookUrl(token: string): string {
  const base = API_BASE();
  return `${base.replace(/\/$/, '')}/hooks/leads/${token}`;
}
