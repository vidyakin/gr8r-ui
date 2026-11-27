/* Доставка (задача 1100, docs/architecture/delivery.md): тарифы, расчёт цены для клиента и себестоимости,
   вес по строкам. Чистые функции без БД — их вызывают сервер и интерфейс. */
import { dec, fmt, mul, type Dec } from './decimal';

export const DELIVERY_KINDS = ['own_courier', 'courier_service', 'third_party'] as const;
export type DeliveryKind = (typeof DELIVERY_KINDS)[number];
export const DELIVERY_STATUSES = ['new', 'assigned', 'in_transit', 'delivered', 'failed'] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];
/** Типы документов, к которым привязывается доставка */
export const DELIVERY_DOC_TYPES = ['customer_order', 'realization', 'work_order'] as const;
export type DeliveryDocType = (typeof DELIVERY_DOC_TYPES)[number];
/** Ключ системной статьи затрат «Доставка» */
export const DELIVERY_COST_ITEM_KEY = 'dostavka';

/** Тариф: база + за км + за кг, но не меньше минимума */
export interface DeliveryRateInput {
  base: string;
  perKm: string;
  perKg: string;
  min: string;
}

export interface DeliveryTariff {
  client: DeliveryRateInput;
  cost: DeliveryRateInput;
  /** Бесплатно для клиента от суммы документа без НДС; пусто — не бывает бесплатной */
  freeFrom?: string | null;
}

export interface DeliveryCostInput {
  distanceKm: string;
  weightKg: string;
  /** Сумма документа без НДС */
  orderTotal: string;
}

export interface DeliveryCostResult {
  /** Цена для клиента */
  price: string;
  /** Наша себестоимость */
  ourCost: string;
  /** Доставка бесплатна для клиента по порогу суммы */
  free: boolean;
}

export const emptyRate = (): DeliveryRateInput => ({ base: '0', perKm: '0', perKg: '0', min: '0' });

function rateAmount(r: DeliveryRateInput, km: Dec, kg: Dec): Dec {
  const sum = dec(r.base) + mul(dec(r.perKm), km) + mul(dec(r.perKg), kg);
  const min = dec(r.min);
  return sum < min ? min : sum;
}

/** Цена для клиента и себестоимость по тарифу. Бесплатно для клиента от порога суммы документа (порог 0 или пусто — выключен);
    себестоимость при этом остаётся: бесплатная доставка нам не бесплатна */
export function computeDeliveryCost(tariff: DeliveryTariff, input: DeliveryCostInput): DeliveryCostResult {
  const km = dec(input.distanceKm);
  const kg = dec(input.weightKg);
  const threshold = tariff.freeFrom == null || tariff.freeFrom === '' ? null : dec(tariff.freeFrom);
  const free = threshold !== null && threshold > 0n && dec(input.orderTotal) >= threshold;
  const price = free ? 0n : rateAmount(tariff.client, km, kg);
  return { price: fmt(price, 2), ourCost: fmt(rateAmount(tariff.cost, km, kg), 2), free };
}

/** Вес доставки: Σ количество × вес по строкам товаров; строки без веса дают 0 */
export function deliveryWeight(lines: { qty: string; weightKg: string | null }[]): string {
  let sum = 0n;
  for (const l of lines) if (l.weightKg) sum += mul(dec(l.qty), dec(l.weightKg));
  return fmt(sum, 3);
}

/** Следующие статусы: курьер идёт вперёд, но может отметить «не доставлена» и вернуть доставку назад */
export const DELIVERY_FINAL = ['delivered', 'failed'] as const;

/* ---------------- трекинг и уведомления клиенту (задача 1217) ---------------- */

export const DELIVERY_NOTIFICATION_CHANNELS = ['email', 'sms', 'telegram', 'whatsapp'] as const;
export type DeliveryNotificationChannel = (typeof DELIVERY_NOTIFICATION_CHANNELS)[number];

export const DELIVERY_NOTIFICATION_EVENTS = [
  'tracking_enabled',
  'window_updated',
  'status_assigned',
  'status_in_transit',
  'status_delivered',
  'status_failed',
] as const;
export type DeliveryNotificationEvent = (typeof DELIVERY_NOTIFICATION_EVENTS)[number];

export const DELIVERY_NOTIFICATION_STATUSES = ['queued', 'sent', 'logged', 'failed', 'skipped'] as const;
export type DeliveryNotificationStatus = (typeof DELIVERY_NOTIFICATION_STATUSES)[number];

export const DELIVERY_NOTIFY_JOB = 'delivery.notify';
export const DELIVERY_SMS_WEBHOOK_SECRET = 'delivery_notify.sms_webhook_url';
export const DELIVERY_MESSENGER_WEBHOOK_SECRET = 'delivery_notify.messenger_webhook_url';

const TRACKING_TOKEN_RE = /^[A-Za-z0-9_-]{24,128}$/;
export const isDeliveryTrackingToken = (token: string): boolean => TRACKING_TOKEN_RE.test(token);

export interface PublicDeliveryTimelineItem {
  status: DeliveryStatus;
  at: string;
}

export interface PublicDeliveryTracking {
  workspaceName: string;
  documentType: (typeof DELIVERY_DOC_TYPES)[number];
  documentNumber: string | null;
  status: DeliveryStatus;
  deliveryDate: string | null;
  windowFrom: string | null;
  windowTo: string | null;
  deliveredAt: string | null;
  addressSummary: string;
  contactName: string;
  methodName: string | null;
  courierLabel: string | null;
  vehicleLabel: string | null;
  timeline: PublicDeliveryTimelineItem[];
  updatedAt: string;
}

export interface DeliveryNotificationView {
  id: string;
  deliveryId: string;
  channel: DeliveryNotificationChannel;
  eventKind: DeliveryNotificationEvent;
  recipient: string;
  subject: string;
  message: string;
  status: DeliveryNotificationStatus;
  provider: string;
  externalId: string | null;
  error: string | null;
  sentAt: string | null;
  createdAt: string;
}

export interface DeliveryNotifySettings {
  enabled?: boolean;
  channels?: DeliveryNotificationChannel[];
  appBaseUrl?: string;
}

/** Читаемое окно доставки: «2026-11-26, 10:00–13:00» или пустая строка */
export function formatDeliveryWindow(date: string | null, from: string | null, to: string | null): string {
  const f = from ? from.slice(0, 5) : '';
  const t = to ? to.slice(0, 5) : '';
  const time = f && t ? `${f}–${t}` : f || t;
  return [date ?? '', time].filter(Boolean).join(', ');
}

const NOTIFY_TEXT = {
  ru: {
    tracking_enabled: 'Отслеживание доставки',
    window_updated: 'Время доставки уточнено',
    status_assigned: 'Курьер назначен',
    status_in_transit: 'Доставка в пути',
    status_delivered: 'Заказ доставлен',
    status_failed: 'Не удалось выполнить доставку',
    orderPrefix: 'Заказ',
    window: 'Окно доставки',
    address: 'Адрес',
    track: 'Отследить',
    courier: 'Курьер',
  },
  en: {
    tracking_enabled: 'Delivery tracking link',
    window_updated: 'Delivery window updated',
    status_assigned: 'Courier assigned',
    status_in_transit: 'Your delivery is on the way',
    status_delivered: 'Your order has been delivered',
    status_failed: 'Delivery attempt unsuccessful',
    orderPrefix: 'Order',
    window: 'Delivery window',
    address: 'Address',
    track: 'Track delivery',
    courier: 'Courier',
  },
  es: {
    tracking_enabled: 'Seguimiento de entrega',
    window_updated: 'Franja de entrega actualizada',
    status_assigned: 'Repartidor asignado',
    status_in_transit: 'Tu entrega está en camino',
    status_delivered: 'Tu pedido ha sido entregado',
    status_failed: 'No se pudo completar la entrega',
    orderPrefix: 'Pedido',
    window: 'Franja de entrega',
    address: 'Dirección',
    track: 'Seguir entrega',
    courier: 'Repartidor',
  },
} as const;

export interface BuildDeliveryNotifyInput {
  locale?: string | null;
  workspaceName: string;
  documentNumber: string | null;
  eventKind: DeliveryNotificationEvent;
  deliveryDate: string | null;
  windowFrom: string | null;
  windowTo: string | null;
  address: string;
  courierLabel?: string | null;
  trackingUrl?: string | null;
}

/** Собирает тему и текст уведомления клиенту о доставке (чистая функция для email / SMS / мессенджеров) */
export function buildDeliveryNotificationMessage(input: BuildDeliveryNotifyInput): { subject: string; text: string } {
  const code = (input.locale ?? 'ru').toLowerCase().slice(0, 2);
  const dict = code === 'en' ? NOTIFY_TEXT.en : code === 'es' ? NOTIFY_TEXT.es : NOTIFY_TEXT.ru;
  const title = dict[input.eventKind];
  const docTag = input.documentNumber ? ` (${dict.orderPrefix} ${input.documentNumber})` : '';
  const subject = `${input.workspaceName}: ${title}${docTag}`;
  const lines: string[] = [`${title}${docTag}`];
  const win = formatDeliveryWindow(input.deliveryDate, input.windowFrom, input.windowTo);
  if (win) lines.push(`${dict.window}: ${win}`);
  if (input.courierLabel) lines.push(`${dict.courier}: ${input.courierLabel}`);
  if (input.address.trim()) lines.push(`${dict.address}: ${input.address.trim()}`);
  if (input.trackingUrl) lines.push(`${dict.track}: ${input.trackingUrl}`);
  return { subject, text: lines.join('\n') };
}
