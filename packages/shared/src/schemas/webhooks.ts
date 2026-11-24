/* Схемы валидации исходящих вебхуков и журнала доставок (задача 1392). */
import { z } from 'zod';

/** Стандартные события outbox, на которые можно подписаться через вебхуки */
export const WEBHOOK_EVENTS = [
  'product.created',
  'product.updated',
  'product.deleted',
  'company.created',
  'company.updated',
  'company.deleted',
  'document.created',
  'document.updated',
  'document.posted',
  'document.unposted',
  'document.cancelled',
  'document.deleted',
  'stock.changed',
  'deal.created',
  'deal.updated',
  'deal.won',
  'deal.lost',
  'lead.created',
  'lead.updated',
  'payment.posted',
  '*',
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENTS)[number];

const EVENT_PATTERN = /^(\*|[a-z][a-z0-9_]*(\.[a-z0-9_*]+)+)$/;

const webhookUrl = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .refine(v => {
    try {
      const u = new URL(v);
      return u.protocol === 'https:' || u.protocol === 'http:';
    } catch {
      return false;
    }
  }, 'URL must start with http:// or https://');

const webhookEvent = z.string().trim().min(1).max(100).regex(EVENT_PATTERN, 'Invalid event pattern');

export const webhookCreate = z.object({
  url: webhookUrl,
  events: z.array(webhookEvent).min(1).max(50),
  secret: z.string().trim().min(16).max(512).optional(),
  enabled: z.boolean().default(true),
});

export const webhookUpdate = z.object({
  url: webhookUrl.optional(),
  events: z.array(webhookEvent).min(1).max(50).optional(),
  enabled: z.boolean().optional(),
  rotateSecret: z.boolean().optional(),
});

export const webhookDeliveriesQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.enum(['queued', 'delivered', 'failed']).optional(),
});

/** Проверка, подходит ли тип события outbox под подписку (поддерживает `*` и `entity.*`) */
export function webhookMatchesEvent(subscribed: readonly string[], eventType: string): boolean {
  for (const pattern of subscribed) {
    if (pattern === '*' || pattern === eventType) return true;
    if (pattern.endsWith('.*') && eventType.startsWith(pattern.slice(0, -1))) return true;
  }
  return false;
}
