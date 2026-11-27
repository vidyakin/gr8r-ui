/* Трекинг доставки по публичной ссылке и уведомления клиенту (задача 1217):
   - публичный read-only просмотр статуса/окна/адреса по токену (без цен, себестоимости и внутренних комментариев);
   - постановка уведомлений (delivery_notifications + задача delivery.notify) при смене статуса, назначении окна или включении трекинга;
   - доставка через настроенный почтовый ящик (email.send) и расширяемый адаптер SMS/мессенджеров с журналом. */
import { randomBytes } from 'node:crypto';
import { and, asc, desc, eq, inArray, ne } from 'drizzle-orm';
import {
  buildDeliveryNotificationMessage,
  DELIVERY_MESSENGER_WEBHOOK_SECRET,
  DELIVERY_NOTIFY_JOB,
  DELIVERY_SMS_WEBHOOK_SECRET,
  isDeliveryTrackingToken,
  isEmailAddress,
  isForbiddenHostname,
  isIpLiteral,
  isPrivateAddress,
  mailboxPasswordKey,
  TELEGRAM_TOKEN_SECRET,
  telegramSendMessage,
  TransientError,
  type DeliveryDocType,
  type DeliveryNotificationChannel,
  type DeliveryNotificationEvent,
  type DeliveryNotificationView,
  type DeliveryNotifySettings,
  type DeliveryStatus,
  type PublicDeliveryTimelineItem,
  type PublicDeliveryTracking,
} from '@erp/shared';
import type { Db, Sql } from './client';
import { withContext } from './context';
import { queueEmail, type Mailbox } from './email';
import { DomainError } from './errors';
import { recordEvent } from './events';
import {
  companies,
  deliveries,
  deliveryMethods,
  deliveryNotifications,
  documents,
  events,
  fleetTrips,
  fleetTripStops,
  fleetVehicles,
  jobs,
  mailboxes,
  members,
  workspaces,
  workspaceSecrets,
} from './schema';
import { readSecret } from './secrets';

export type DeliveryNotificationRow = typeof deliveryNotifications.$inferSelect;

export const newTrackingToken = (): string => randomBytes(24).toString('base64url');

export interface DeliveryNotifySendInput {
  workspaceId: string;
  deliveryId: string;
  channel: DeliveryNotificationChannel;
  eventKind: DeliveryNotificationEvent;
  recipient: string;
  subject: string;
  message: string;
  trackingUrl: string | null;
}

export interface DeliveryNotifySendResult {
  status: 'sent' | 'logged' | 'failed';
  provider: string;
  externalId?: string | null;
  error?: string | null;
}

export interface DeliveryNotifyAdapter {
  readonly id: string;
  supports(channel: DeliveryNotificationChannel): boolean;
  send(ctx: { db: Db; workspaceId: string }, input: DeliveryNotifySendInput): Promise<DeliveryNotifySendResult>;
}

const DEFAULT_CHANNELS: readonly DeliveryNotificationChannel[] = ['email', 'sms'];
const STATUS_SET = new Set<string>(['new', 'assigned', 'in_transit', 'delivered', 'failed']);

function buildTrackingUrl(baseUrl: string | null | undefined, token: string | null | undefined): string | null {
  if (!token) return null;
  const clean = (baseUrl ?? '').trim().replace(/\/+$/, '');
  return clean ? `${clean}/#/d/${token}` : `/#/d/${token}`;
}

function parseNotifySettings(settings: Record<string, unknown> | null | undefined): DeliveryNotifySettings & { locale?: string; smsWebhookUrl?: string } {
  const raw = (settings?.deliveryNotify ?? {}) as Record<string, unknown>;
  const locale = typeof settings?.locale === 'string' ? settings.locale : undefined;
  const channels = Array.isArray(raw.channels)
    ? (raw.channels.filter((c): c is DeliveryNotificationChannel => c === 'email' || c === 'sms' || c === 'telegram' || c === 'whatsapp'))
    : undefined;
  return {
    enabled: typeof raw.enabled === 'boolean' ? raw.enabled : true,
    channels: channels?.length ? channels : undefined,
    appBaseUrl: typeof raw.appBaseUrl === 'string' ? raw.appBaseUrl : undefined,
    smsWebhookUrl: typeof raw.smsWebhookUrl === 'string' ? raw.smsWebhookUrl : undefined,
    locale,
  };
}

function assertSafeWebhookUrl(rawUrl: string): string {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new Error('Invalid notification webhook URL');
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Notification webhook must use HTTP(S)');
  const allowPrivate = process.env.FLOW_HTTP_ALLOW_PRIVATE === '1' || process.env.EMAIL_ALLOW_PRIVATE === '1';
  if (!allowPrivate) {
    const h = u.hostname.replace(/^\[|\]$/g, '');
    if (isIpLiteral(h) ? isPrivateAddress(h) : isForbiddenHostname(h)) throw new Error('Private notification webhook host is not allowed');
  }
  return u.toString();
}

const webhookAdapter: DeliveryNotifyAdapter = {
  id: 'webhook',
  supports: ch => ch === 'sms' || ch === 'whatsapp' || ch === 'telegram',
  async send({ db, workspaceId }, input) {
    const [ws] = await db.select({ settings: workspaces.settings }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
    const cfg = parseNotifySettings(ws?.settings);
    const secretKey = input.channel === 'sms' ? DELIVERY_SMS_WEBHOOK_SECRET : DELIVERY_MESSENGER_WEBHOOK_SECRET;
    const secretUrl = await readSecret(db, workspaceId, secretKey);
    const url = secretUrl || (input.channel === 'sms' ? cfg.smsWebhookUrl : undefined);
    if (!url) return { status: 'logged', provider: 'log', externalId: null, error: null };

    const safeUrl = assertSafeWebhookUrl(url);
    let res: Response;
    try {
      res = await deliveryNotifyRuntime.fetch(safeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: input.channel,
          eventKind: input.eventKind,
          recipient: input.recipient,
          subject: input.subject,
          message: input.message,
          deliveryId: input.deliveryId,
          trackingUrl: input.trackingUrl,
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (e) {
      throw new TransientError(`Notification webhook request failed: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300));
    }
    if (res.status === 429 || res.status >= 500) throw new TransientError(`Notification webhook responded ${res.status}`);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { status: 'failed', provider: 'webhook', error: `HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}` };
    }
    const json = (await res.json().catch(() => null)) as { id?: unknown; messageId?: unknown } | null;
    const ext = typeof json?.id === 'string' ? json.id : typeof json?.messageId === 'string' ? json.messageId : null;
    return { status: 'sent', provider: 'webhook', externalId: ext, error: null };
  },
};

const telegramAdapter: DeliveryNotifyAdapter = {
  id: 'telegram',
  supports: ch => ch === 'telegram',
  async send({ db, workspaceId }, input) {
    const token = await readSecret(db, workspaceId, TELEGRAM_TOKEN_SECRET);
    if (!token || !/^(?:-?\d+|@[A-Za-z0-9_]{4,})$/.test(input.recipient.trim())) {
      return { status: 'logged', provider: 'log', externalId: null, error: null };
    }
    const res = await telegramSendMessage(token, { chatId: input.recipient.trim(), text: input.message }, { fetch: deliveryNotifyRuntime.fetch as typeof fetch });
    return { status: 'sent', provider: 'telegram', externalId: res.messageId !== null ? String(res.messageId) : null, error: null };
  },
};

const logAdapter: DeliveryNotifyAdapter = {
  id: 'log',
  supports: () => true,
  async send() {
    return { status: 'logged', provider: 'log', externalId: null, error: null };
  },
};

/** Точка подмены для тестов и подключения провайдеров */
export const deliveryNotifyRuntime: {
  appBaseUrl: () => string;
  fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  adapters: DeliveryNotifyAdapter[];
} = {
  appBaseUrl: () => process.env.PUBLIC_APP_URL?.trim() || process.env.APP_URL?.trim() || '',
  fetch: (input, init) => fetch(input, init),
  adapters: [telegramAdapter, webhookAdapter, logAdapter],
};

function toNotificationView(r: DeliveryNotificationRow): DeliveryNotificationView {
  return {
    id: r.id,
    deliveryId: r.deliveryId,
    channel: r.channel,
    eventKind: r.eventKind,
    recipient: r.recipient,
    subject: r.subject,
    message: r.message,
    status: r.status,
    provider: r.provider,
    externalId: r.externalId,
    error: r.error,
    sentAt: r.sentAt ? r.sentAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
  };
}

/** Журнал уведомлений по доставке */
export async function listDeliveryNotifications(db: Db, deliveryId: string): Promise<DeliveryNotificationView[]> {
  const rows = await db
    .select()
    .from(deliveryNotifications)
    .where(eq(deliveryNotifications.deliveryId, deliveryId))
    .orderBy(desc(deliveryNotifications.createdAt), desc(deliveryNotifications.id))
    .limit(100);
  return rows.map(toNotificationView);
}

/** Ставит уведомления клиенту в очередь (delivery_notifications + job delivery.notify) внутри текущей транзакции */
export async function enqueueDeliveryNotifications(
  db: Db,
  ctx: { workspaceId: string; memberId?: string | null },
  delivery: typeof deliveries.$inferSelect,
  eventKind: DeliveryNotificationEvent,
  opts: { channels?: DeliveryNotificationChannel[]; strictRecipient?: boolean } = {},
): Promise<DeliveryNotificationView[]> {
  const [ws] = await db.select({ name: workspaces.name, settings: workspaces.settings }).from(workspaces).where(eq(workspaces.id, ctx.workspaceId)).limit(1);
  const cfg = parseNotifySettings(ws?.settings);
  if (!opts.channels && cfg.enabled === false) return [];

  const [doc] = await db.select({ number: documents.number }).from(documents).where(eq(documents.id, delivery.documentId)).limit(1);
  const [courier] = delivery.courierMemberId ? await db.select({ name: members.name }).from(members).where(eq(members.id, delivery.courierMemberId)).limit(1) : [];
  const [carrier] = delivery.carrierCompanyId ? await db.select({ name: companies.name }).from(companies).where(eq(companies.id, delivery.carrierCompanyId)).limit(1) : [];

  const courierLabel = courier?.name ?? carrier?.name ?? null;
  const baseUrl = cfg.appBaseUrl || deliveryNotifyRuntime.appBaseUrl();
  const trackingUrl = delivery.trackingEnabled ? buildTrackingUrl(baseUrl, delivery.trackingToken) : null;
  const { subject, text } = buildDeliveryNotificationMessage({
    locale: cfg.locale,
    workspaceName: ws?.name ?? '',
    documentNumber: doc?.number ?? null,
    eventKind,
    deliveryDate: delivery.deliveryDate,
    windowFrom: delivery.windowFrom,
    windowTo: delivery.windowTo,
    address: delivery.address,
    courierLabel,
    trackingUrl,
  });

  const channels = opts.channels?.length ? opts.channels : (cfg.channels ?? DEFAULT_CHANNELS);
  const created: DeliveryNotificationView[] = [];
  for (const channel of channels) {
    const email = delivery.contactEmail.trim();
    const phone = delivery.contactPhone.trim();
    const recipient = channel === 'email' ? (isEmailAddress(email) ? email : '') : phone;
    if (!recipient) {
      if (opts.strictRecipient) {
        throw new DomainError(422, 'delivery_notify_no_recipient', channel === 'email' ? 'Delivery has no valid contact email' : 'Delivery has no contact phone');
      }
      continue;
    }
    const [row] = await db
      .insert(deliveryNotifications)
      .values({
        workspaceId: ctx.workspaceId,
        deliveryId: delivery.id,
        channel,
        eventKind,
        recipient,
        subject: channel === 'email' ? subject : '',
        message: text,
        status: 'queued',
        provider: '',
      })
      .returning();
    await db.insert(jobs).values({ workspaceId: ctx.workspaceId, type: DELIVERY_NOTIFY_JOB, payload: { notificationId: row!.id }, maxAttempts: 5 });
    await recordEvent(db, {
      workspaceId: ctx.workspaceId,
      type: 'delivery.notification_queued',
      entity: 'delivery',
      recordId: delivery.id,
      actorId: ctx.memberId ?? null,
      payload: { notificationId: row!.id, channel, eventKind },
    });
    created.push(toNotificationView(row!));
  }
  return created;
}

async function pickNotificationMailbox(db: Db, workspaceId: string): Promise<Mailbox | null> {
  const rows = await db.select().from(mailboxes).where(eq(mailboxes.workspaceId, workspaceId)).orderBy(asc(mailboxes.kind), asc(mailboxes.createdAt));
  if (!rows.length) return null;
  const keys = rows.map(r => mailboxPasswordKey(r.id));
  const withPw = new Set((await db.select({ key: workspaceSecrets.key }).from(workspaceSecrets).where(inArray(workspaceSecrets.key, keys))).map(r => r.key));
  const shared = rows.find(m => m.kind === 'shared' && withPw.has(mailboxPasswordKey(m.id)));
  return shared ?? rows.find(m => withPw.has(mailboxPasswordKey(m.id))) ?? null;
}

/** Обработчик задачи воркера `delivery.notify`: email — через почтовый ящик (или log), SMS/мессенджеры — через адаптеры с fallback в log */
export async function processDeliveryNotification(
  sql: Sql,
  workspaceId: string,
  notificationId: string,
  job: { attempts: number; maxAttempts: number },
): Promise<'sent' | 'logged' | 'queued' | 'skipped' | 'failed'> {
  const prep = await withContext(sql, { workspaceId }, async db => {
    const [row] = await db.select().from(deliveryNotifications).where(eq(deliveryNotifications.id, notificationId)).limit(1);
    if (!row || row.status !== 'queued') return { kind: 'skip' as const };
    const [delivery] = await db.select().from(deliveries).where(eq(deliveries.id, row.deliveryId)).limit(1);
    if (!delivery) {
      await db.update(deliveryNotifications).set({ status: 'skipped', error: 'Delivery deleted', updatedAt: new Date() }).where(eq(deliveryNotifications.id, row.id));
      return { kind: 'skip' as const };
    }
    const [ws] = await db.select({ settings: workspaces.settings }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
    const cfg = parseNotifySettings(ws?.settings);
    const trackingUrl = delivery.trackingEnabled ? buildTrackingUrl(cfg.appBaseUrl || deliveryNotifyRuntime.appBaseUrl(), delivery.trackingToken) : null;

    if (row.channel === 'email') {
      if (!isEmailAddress(row.recipient)) {
        await db.update(deliveryNotifications).set({ status: 'skipped', error: 'Invalid recipient email', updatedAt: new Date() }).where(eq(deliveryNotifications.id, row.id));
        await recordEvent(db, { workspaceId, type: 'delivery.notification_updated', entity: 'delivery', recordId: delivery.id, actorId: null, payload: { notificationId: row.id, status: 'skipped' } });
        return { kind: 'skip' as const };
      }
      const mailbox = await pickNotificationMailbox(db, workspaceId);
      if (!mailbox) {
        await db.update(deliveryNotifications).set({ status: 'logged', provider: 'log', sentAt: new Date(), error: null, updatedAt: new Date() }).where(eq(deliveryNotifications.id, row.id));
        await recordEvent(db, { workspaceId, type: 'delivery.notification_updated', entity: 'delivery', recordId: delivery.id, actorId: null, payload: { notificationId: row.id, status: 'logged' } });
        return { kind: 'logged' as const };
      }
      try {
        const [doc] = await db.select({ counterpartyId: documents.counterpartyId }).from(documents).where(eq(documents.id, delivery.documentId)).limit(1);
        const emailMsg = await queueEmail(
          db,
          { workspaceId, memberId: null, role: 'member' },
          {
            mailboxId: mailbox.id,
            to: [row.recipient],
            cc: [],
            subject: row.subject,
            body: row.message,
            documentId: delivery.documentId,
            companyId: doc?.counterpartyId ?? null,
            attachmentIds: [],
          },
          { mailbox, appendSignature: true },
        );
        await db.update(deliveryNotifications).set({ provider: 'smtp', externalId: emailMsg.id, error: null, updatedAt: new Date() }).where(eq(deliveryNotifications.id, row.id));
        return { kind: 'email_queued' as const };
      } catch (e) {
        const msg = (e instanceof Error ? e.message : String(e)).slice(0, 500);
        await db.update(deliveryNotifications).set({ status: 'failed', provider: 'smtp', error: msg, updatedAt: new Date() }).where(eq(deliveryNotifications.id, row.id));
        await recordEvent(db, { workspaceId, type: 'delivery.notification_updated', entity: 'delivery', recordId: delivery.id, actorId: null, payload: { notificationId: row.id, status: 'failed' } });
        return { kind: 'failed' as const };
      }
    }

    return {
      kind: 'external' as const,
      row,
      trackingUrl,
    };
  });

  if (prep.kind === 'skip') return 'skipped';
  if (prep.kind === 'logged') return 'logged';
  if (prep.kind === 'email_queued') return 'queued';
  if (prep.kind === 'failed') return 'failed';

  const { row, trackingUrl } = prep;
  let result: DeliveryNotifySendResult = { status: 'logged', provider: 'log', externalId: null, error: null };
  let transientErr: TransientError | null = null;
  try {
    for (const adapter of deliveryNotifyRuntime.adapters) {
      if (!adapter.supports(row.channel)) continue;
      result = await withContext(sql, { workspaceId }, db =>
        adapter.send(
          { db, workspaceId },
          {
            workspaceId,
            deliveryId: row.deliveryId,
            channel: row.channel,
            eventKind: row.eventKind,
            recipient: row.recipient,
            subject: row.subject,
            message: row.message,
            trackingUrl,
          },
        ),
      );
      if (result.status !== 'logged' || adapter.id === 'log') break;
    }
  } catch (e) {
    if (e instanceof TransientError && job.attempts < job.maxAttempts) {
      transientErr = e;
    } else {
      result = { status: 'failed', provider: 'adapter', error: (e instanceof Error ? e.message : String(e)).slice(0, 500) };
    }
  }

  if (transientErr) {
    await withContext(sql, { workspaceId }, db =>
      db.update(deliveryNotifications).set({ error: transientErr!.message.slice(0, 500), updatedAt: new Date() }).where(eq(deliveryNotifications.id, row.id)),
    );
    throw transientErr;
  }

  await withContext(sql, { workspaceId }, async db => {
    await db
      .update(deliveryNotifications)
      .set({
        status: result.status,
        provider: result.provider,
        externalId: result.externalId ?? null,
        error: result.error ?? null,
        sentAt: result.status === 'sent' || result.status === 'logged' ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(deliveryNotifications.id, row.id));
    await recordEvent(db, {
      workspaceId,
      type: 'delivery.notification_updated',
      entity: 'delivery',
      recordId: row.deliveryId,
      actorId: null,
      payload: { notificationId: row.id, status: result.status, provider: result.provider },
    });
  });
  return result.status;
}

/* ---------------- публичный трекинг по токену ---------------- */

/** Поиск воркспейса по токену трекинга (под app_worker; только включённый трекинг) */
export async function resolveDeliveryTrackingToken(sql: Sql, token: string): Promise<{ deliveryId: string; workspaceId: string } | null> {
  if (!isDeliveryTrackingToken(token)) return null;
  const [found] = await withContext(
    sql,
    {},
    db =>
      db
        .select({ deliveryId: deliveries.id, workspaceId: deliveries.workspaceId })
        .from(deliveries)
        .where(and(eq(deliveries.trackingToken, token), eq(deliveries.trackingEnabled, true)))
        .limit(1),
    'app_worker',
  );
  return found ?? null;
}

/** Безопасная публичная карточка отслеживания доставки (без цен, себестоимости, телефонов/email и внутренних заметок) */
export async function getPublicDeliveryTracking(db: Db, workspaceId: string, deliveryId: string): Promise<PublicDeliveryTracking | null> {
  const [row] = await db
    .select({
      d: deliveries,
      workspaceName: workspaces.name,
      documentNumber: documents.number,
      documentType: documents.type,
      methodName: deliveryMethods.name,
      courierName: members.name,
      carrierName: companies.name,
    })
    .from(deliveries)
    .innerJoin(workspaces, eq(workspaces.id, deliveries.workspaceId))
    .innerJoin(documents, eq(documents.id, deliveries.documentId))
    .leftJoin(deliveryMethods, eq(deliveryMethods.id, deliveries.methodId))
    .leftJoin(members, eq(members.id, deliveries.courierMemberId))
    .leftJoin(companies, eq(companies.id, deliveries.carrierCompanyId))
    .where(and(eq(deliveries.id, deliveryId), eq(deliveries.trackingEnabled, true)))
    .limit(1);

  if (!row) return null;
  const d = row.d;

  const [tripInfo] = await db
    .select({
      hired: fleetTrips.hired,
      driverName: members.name,
      vehicleName: fleetVehicles.name,
      vehicleMake: fleetVehicles.make,
      vehicleModel: fleetVehicles.model,
    })
    .from(fleetTripStops)
    .innerJoin(fleetTrips, eq(fleetTrips.id, fleetTripStops.tripId))
    .leftJoin(members, eq(members.id, fleetTrips.driverMemberId))
    .leftJoin(fleetVehicles, eq(fleetVehicles.id, fleetTrips.vehicleId))
    .where(and(eq(fleetTripStops.deliveryId, deliveryId), ne(fleetTrips.status, 'cancelled')))
    .orderBy(desc(fleetTrips.createdAt))
    .limit(1);

  const vehicleLabel =
    tripInfo && !tripInfo.hired
      ? [tripInfo.vehicleMake, tripInfo.vehicleModel].filter(Boolean).join(' ').trim() || tripInfo.vehicleName?.trim() || null
      : null;
  const courierLabel = row.courierName ?? tripInfo?.driverName ?? row.carrierName ?? null;

  const evRows = await db
    .select({ type: events.type, payload: events.payload, createdAt: events.createdAt })
    .from(events)
    .where(and(eq(events.workspaceId, workspaceId), eq(events.entity, 'delivery'), eq(events.recordId, deliveryId)))
    .orderBy(asc(events.createdAt), asc(events.id));

  const timeline: PublicDeliveryTimelineItem[] = [{ status: 'new', at: d.createdAt.toISOString() }];
  for (const ev of evRows) {
    if (ev.type !== 'delivery.status_changed') continue;
    const to = (ev.payload as { to?: unknown })?.to;
    if (typeof to !== 'string' || !STATUS_SET.has(to)) continue;
    const status = to as DeliveryStatus;
    if (timeline[timeline.length - 1]?.status !== status) {
      timeline.push({ status, at: ev.createdAt.toISOString() });
    }
  }
  const currentStatus = d.status as DeliveryStatus;
  if (timeline[timeline.length - 1]?.status !== currentStatus) {
    timeline.push({ status: currentStatus, at: d.updatedAt.toISOString() });
  }

  return {
    workspaceName: row.workspaceName,
    documentType: row.documentType as DeliveryDocType,
    documentNumber: row.documentNumber,
    status: currentStatus,
    deliveryDate: d.deliveryDate,
    windowFrom: d.windowFrom ? d.windowFrom.slice(0, 5) : null,
    windowTo: d.windowTo ? d.windowTo.slice(0, 5) : null,
    deliveredAt: d.deliveredAt,
    addressSummary: d.address,
    contactName: d.contactName,
    methodName: row.methodName ?? null,
    courierLabel,
    vehicleLabel,
    timeline,
    updatedAt: d.updatedAt.toISOString(),
  };
}
