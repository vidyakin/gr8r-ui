/* zod-схемы интеграций оплат (задача 1174д): подключения счетов к API банков и ЮКассе, ссылки на онлайн-оплату. */
import { z } from 'zod';
import { CONNECTION_PROVIDERS } from '../bank-api';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const bankConnectionUpsert = z.object({
  bankAccountId: z.string().uuid(),
  provider: z.enum(CONNECTION_PROVIDERS),
  enabled: z.boolean().optional(),
  /** Префикс имён секретов (`tbank` → `tbank.token`); по умолчанию — имя провайдера */
  secretPrefix: z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/).optional(),
  syncFrom: isoDate.nullable().optional(),
  autoPost: z.boolean().optional(),
});
export const connectionIdParam = z.object({ id: z.string().uuid() });

export const paymentLinkCreate = z.object({
  documentId: z.string().uuid(),
  returnUrl: z.string().url().max(500).refine(u => /^https?:\/\//i.test(u), 'http(s) only'),
});
export const paymentLinksQuery = z.object({ documentId: z.string().uuid() });
