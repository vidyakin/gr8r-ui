import { describe, expect, test } from 'bun:test';
import {
  buildDeliveryNotificationMessage,
  computeDeliveryCost,
  deliveryWeight,
  formatDeliveryWindow,
  isDeliveryTrackingToken,
} from '../src';

const tariff = {
  client: { base: '100', perKm: '10', perKg: '5', min: '150' },
  cost: { base: '50', perKm: '8', perKg: '2', min: '0' },
  freeFrom: '5000',
};

describe('computeDeliveryCost', () => {
  test('base + per km + per kg', () => {
    expect(computeDeliveryCost(tariff, { distanceKm: '10', weightKg: '10', orderTotal: '2000' })).toEqual({ price: '250.00', ourCost: '150.00', free: false });
  });
  test('the minimum lifts a small delivery', () => {
    const r = computeDeliveryCost(tariff, { distanceKm: '0', weightKg: '0', orderTotal: '100' });
    expect(r.price).toBe('150.00');
    expect(r.ourCost).toBe('50.00');
  });
  test('fractional km and kg are exact', () => {
    expect(computeDeliveryCost({ ...tariff, freeFrom: null }, { distanceKm: '2.5', weightKg: '0.4', orderTotal: '0' }).price).toBe('150.00');
    expect(computeDeliveryCost({ client: { base: '0', perKm: '0.1', perKg: '0.2', min: '0' }, cost: tariff.cost }, { distanceKm: '3', weightKg: '3', orderTotal: '0' }).price).toBe('0.90');
  });
  test('free for the client from the order total; our cost stays', () => {
    const r = computeDeliveryCost(tariff, { distanceKm: '10', weightKg: '10', orderTotal: '5000' });
    expect(r).toEqual({ price: '0.00', ourCost: '150.00', free: true });
    expect(computeDeliveryCost(tariff, { distanceKm: '10', weightKg: '10', orderTotal: '4999.99' }).free).toBe(false);
  });
  test('zero or empty threshold turns the free delivery off', () => {
    expect(computeDeliveryCost({ ...tariff, freeFrom: '0' }, { distanceKm: '1', weightKg: '1', orderTotal: '99999' }).free).toBe(false);
    expect(computeDeliveryCost({ ...tariff, freeFrom: null }, { distanceKm: '1', weightKg: '1', orderTotal: '99999' }).free).toBe(false);
  });
});

describe('deliveryWeight', () => {
  test('sums qty x weight, lines without weight give zero', () => {
    expect(deliveryWeight([{ qty: '4', weightKg: '2.5' }, { qty: '3', weightKg: null }, { qty: '0.5', weightKg: '1' }])).toBe('10.500');
    expect(deliveryWeight([])).toBe('0.000');
  });
});

describe('tracking token and notification formatting', () => {
  test('isDeliveryTrackingToken validates length and URL-safe alphabet', () => {
    expect(isDeliveryTrackingToken('abcDEF_1234567890-abcdef')).toBe(true);
    expect(isDeliveryTrackingToken('short')).toBe(false);
    expect(isDeliveryTrackingToken('bad token with spaces 123456')).toBe(false);
  });

  test('formatDeliveryWindow formats date and time range', () => {
    expect(formatDeliveryWindow('2026-11-26', '10:00:00', '13:00:00')).toBe('2026-11-26, 10:00–13:00');
    expect(formatDeliveryWindow('2026-11-26', null, null)).toBe('2026-11-26');
    expect(formatDeliveryWindow(null, '09:30', null)).toBe('09:30');
    expect(formatDeliveryWindow(null, null, null)).toBe('');
  });

  test('buildDeliveryNotificationMessage renders ru, en and es messages with window and link', () => {
    const ru = buildDeliveryNotificationMessage({
      locale: 'ru',
      workspaceName: 'Магазин',
      documentNumber: 'ЗП-001',
      eventKind: 'status_in_transit',
      deliveryDate: '2026-11-26',
      windowFrom: '10:00:00',
      windowTo: '12:00:00',
      address: 'ул. Ленина, 1',
      courierLabel: 'Иван',
      trackingUrl: 'https://app.test/#/d/tok123',
    });
    expect(ru.subject).toBe('Магазин: Доставка в пути (Заказ ЗП-001)');
    expect(ru.text).toContain('Окно доставки: 2026-11-26, 10:00–12:00');
    expect(ru.text).toContain('Курьер: Иван');
    expect(ru.text).toContain('Отследить: https://app.test/#/d/tok123');

    const en = buildDeliveryNotificationMessage({
      locale: 'en',
      workspaceName: 'Shop',
      documentNumber: 'ORD-7',
      eventKind: 'tracking_enabled',
      deliveryDate: '2026-11-26',
      windowFrom: '14:00',
      windowTo: '18:00',
      address: 'Main st 5',
      trackingUrl: 'https://app.test/#/d/tok123',
    });
    expect(en.subject).toBe('Shop: Delivery tracking link (Order ORD-7)');
    expect(en.text).toContain('Delivery window: 2026-11-26, 14:00–18:00');

    const es = buildDeliveryNotificationMessage({
      locale: 'es',
      workspaceName: 'Tienda',
      documentNumber: null,
      eventKind: 'status_delivered',
      deliveryDate: null,
      windowFrom: null,
      windowTo: null,
      address: 'Calle 10',
    });
    expect(es.subject).toBe('Tienda: Tu pedido ha sido entregado');
    expect(es.text).toContain('Dirección: Calle 10');
  });
});
