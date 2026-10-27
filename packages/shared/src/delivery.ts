/* Доставка (задача 1100, docs/architecture/delivery.md): тарифы, расчёт цены для клиента и себестоимости,
   вес по строкам. Чистые функции без БД — их вызывают сервер и интерфейс. */
import { dec, fmt, mul, type Dec } from './decimal';

export const DELIVERY_KINDS = ['own_courier', 'courier_service', 'third_party'] as const;
export type DeliveryKind = (typeof DELIVERY_KINDS)[number];
export const DELIVERY_STATUSES = ['new', 'assigned', 'in_transit', 'delivered', 'failed'] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];
/** Типы документов, к которым привязывается доставка */
export const DELIVERY_DOC_TYPES = ['customer_order', 'realization', 'work_order'] as const;
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
