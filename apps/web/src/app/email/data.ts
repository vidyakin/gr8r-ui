/* Почта (задача 1092, docs/architecture/email.md): ящики и письма. Ключи кэша ['ws', id, 'email', …]:
   события mailbox / email (data/realtime.ts) перечитывают их, письмо в ленте лида обновляется по ключу 'leads'. */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/components/ui';
import { errorMessage } from '../data/api';
import { call, useWsId } from '../meta/data';

export type MailSecurity = 'ssl' | 'starttls' | 'none';

export interface Mailbox {
  id: string;
  kind: 'shared' | 'personal';
  memberId: string | null;
  email: string;
  displayName: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: MailSecurity;
  smtpUser: string;
  imapHost: string | null;
  imapPort: number | null;
  imapSecure: MailSecurity | null;
  imapUser: string | null;
  signature: string;
  status: 'ok' | 'error' | 'unchecked';
  lastError: string | null;
  checkedAt: string | null;
  hasPassword: boolean;
}

export interface EmailMessage {
  id: string;
  mailboxId: string | null;
  direction: 'out' | 'in';
  status: 'queued' | 'sending' | 'sent' | 'failed' | 'received';
  fromEmail: string;
  to: string[];
  cc: string[];
  subject: string;
  lastError: string | null;
  sentAt: string | null;
  createdBy: string | null;
}

export interface EmailLinks {
  leadId?: string;
  contactId?: string;
  companyId?: string;
  dealId?: string;
}

export interface NewEmail extends EmailLinks {
  mailboxId?: string | null;
  to: string[];
  cc: string[];
  subject: string;
  body: string;
  attachmentIds: string[];
  documentId?: string;
  printForm?: string | null;
}

export const emailKey = (ws: string, ...rest: unknown[]) => ['ws', ws, 'email', ...rest] as const;

export function useMailboxes() {
  const ws = useWsId();
  return useQuery({ queryKey: emailKey(ws, 'mailboxes'), staleTime: Infinity, queryFn: async () => (await call<{ items: Mailbox[] }>(ws, 'GET', '/mailboxes')).items });
}

/** Письма по их id (лента касаний показывает статус) */
export function useEmailsByIds(ids: string[]) {
  const ws = useWsId();
  const key = [...ids].sort().join(',');
  return useQuery({
    queryKey: emailKey(ws, 'ids', key),
    enabled: ids.length > 0,
    staleTime: Infinity,
    queryFn: async () => new Map((await call<{ items: EmailMessage[] }>(ws, 'GET', `/emails?ids=${key}&limit=200`)).items.map(m => [m.id, m])),
  });
}

/** Мутации почты: ошибка показывается тостом по коду, кэш сбрасывается */
export function useEmailApi() {
  const ws = useWsId();
  const qc = useQueryClient();
  return async <T,>(method: string, path: string, body?: unknown): Promise<T | null> => {
    try {
      const r = await call<T>(ws, method, path, body);
      void qc.invalidateQueries({ queryKey: emailKey(ws) });
      void qc.invalidateQueries({ queryKey: ['ws', ws, 'leads'] });
      return r;
    } catch (e) {
      toast.error(errorMessage(e));
      return null;
    }
  };
}
