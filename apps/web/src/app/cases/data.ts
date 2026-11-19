/* Обращения на клиенте (docs/architecture/cases.md): типы ответов и запросы /cases, /case-sla-rules, /case-forms.
   Ключи кэша ['ws', id, 'cases', …]: события case / case_form / crm_activity / email / company / contact / deal / document обновляют их (data/realtime.ts). */
import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { CaseChannel, CasePriority, CaseSlaRules, CaseStatus } from '@erp/shared';
import { toast } from '@/components/ui';
import { API_BASE, errorMessage } from '../data/api';
import { call, useWsId } from '../meta/data';
import type { EmailMessage } from '../email/data';

export interface CaseRow {
  id: string;
  number: string;
  subject: string;
  description: string;
  status: CaseStatus;
  priority: CasePriority;
  channel: CaseChannel;
  companyId: string | null;
  contactId: string | null;
  leadId: string | null;
  ownerId: string | null;
  dealId: string | null;
  workOrderId: string | null;
  mailboxId: string | null;
  firstResponseDueAt: string | null;
  resolveDueAt: string | null;
  firstRespondedAt: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  custom: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CaseActivity {
  id: string;
  type: 'call' | 'email' | 'meeting' | 'note' | 'task';
  subject: string;
  body: string | null;
  system: boolean;
  authorId: string | null;
  emailMessageId?: string | null;
  createdAt: string;
}

export interface CaseDetail extends CaseRow {
  emails: (EmailMessage & { bodyText?: string })[];
  activities: CaseActivity[];
}

export interface CaseForm {
  id: string;
  name: string;
  defaultOwnerId: string | null;
  enabled: boolean;
  /** Полный токен вебхука `<воркспейс>.<секрет>`; пусто, если у пользователя нет прав admin */
  webhookToken: string;
}

export interface CaseFilters {
  q?: string;
  status?: string;
  priority?: string;
  ownerId?: string;
  channel?: string;
  overdue?: boolean;
  companyId?: string;
  contactId?: string;
}

export const casesKey = (ws: string, ...rest: unknown[]) => ['ws', ws, 'cases', ...rest] as const;

const qs = (f: CaseFilters) => {
  const p = new URLSearchParams({ limit: '200', sort: '-createdAt' });
  if (f.q?.trim()) p.set('q', f.q.trim());
  for (const k of ['status', 'priority', 'ownerId', 'channel', 'companyId', 'contactId'] as const) if (f[k]) p.set(k, f[k]!);
  if (f.overdue) p.set('overdue', 'true');
  return p.toString();
};

export function useCases(f: CaseFilters) {
  const ws = useWsId();
  const key = qs(f);
  return useQuery({ queryKey: casesKey(ws, 'list', key), queryFn: async () => (await call<{ items: CaseRow[]; total: number }>(ws, 'GET', `/cases?${key}`)).items, staleTime: Infinity });
}

export function useCaseSummary() {
  const ws = useWsId();
  return useQuery({ queryKey: casesKey(ws, 'summary'), queryFn: () => call<{ new: number; open: number; overdue: number }>(ws, 'GET', '/cases/summary'), staleTime: 60_000, refetchInterval: 60_000 });
}

export function useCase(id: string | null) {
  const ws = useWsId();
  return useQuery({ queryKey: casesKey(ws, 'one', id), enabled: !!id, queryFn: () => call<CaseDetail>(ws, 'GET', `/cases/${id}`), staleTime: Infinity });
}

export function useCaseSlaRules() {
  const ws = useWsId();
  return useQuery({ queryKey: casesKey(ws, 'sla-rules'), queryFn: () => call<CaseSlaRules>(ws, 'GET', '/case-sla-rules'), staleTime: Infinity });
}

export function useCaseForms() {
  const ws = useWsId();
  return useQuery({ queryKey: casesKey(ws, 'forms'), queryFn: async () => (await call<{ items: CaseForm[] }>(ws, 'GET', '/case-forms?limit=200')).items, staleTime: Infinity });
}

/** Вызов API обращений: тост при ошибке, null при ошибке; кэш обновляет realtime, но сразу помечаем и локально */
export function useCasesApi() {
  const ws = useWsId();
  const qc = useQueryClient();
  return React.useCallback(
    async <T,>(method: string, path: string, json?: unknown): Promise<T | null> => {
      try {
        const r = await call<T>(ws, method, path, json);
        void qc.invalidateQueries({ queryKey: casesKey(ws) });
        return r;
      } catch (e) {
        toast.error(errorMessage(e));
        return null;
      }
    },
    [ws, qc],
  );
}

/** Текущее время для обратного отсчёта SLA: обновляется раз в полминуты */
export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = React.useState(() => new Date());
  React.useEffect(() => {
    const h = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(h);
  }, [intervalMs]);
  return now;
}

/** Адрес вебхука формы обращений (абсолютный, для вставки на сайт) */
export function caseWebhookUrl(token: string): string {
  return `${API_BASE().replace(/\/$/, '')}/hooks/cases/${token}`;
}
