import { describe, expect, test } from 'bun:test';
import { computeDeliveryCost, deliveryWeight } from '../src';

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
