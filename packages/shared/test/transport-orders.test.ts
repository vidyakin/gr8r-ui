import { describe, expect, test } from 'bun:test';
import { computeForwardingMargin, computeTransportRateAmount, computeTripMargin, findRateSchedule } from '../src';

describe('computeTransportRateAmount', () => {
  test('flat — ставка сама по себе', () => {
    expect(computeTransportRateAmount({ rateKind: 'flat', rate: '15000' }, {})).toBe('15000.00');
  });
  test('per_km — ставка × расстояние', () => {
    expect(computeTransportRateAmount({ rateKind: 'per_km', rate: '25.5' }, { distanceKm: '400' })).toBe('10200.00');
  });
  test('per_ton — ставка × тонны (вес в кг / 1000)', () => {
    expect(computeTransportRateAmount({ rateKind: 'per_ton', rate: '1200' }, { weightKg: '3500' })).toBe('4200.00');
  });
  test('пустые контекстные значения дают 0', () => {
    expect(computeTransportRateAmount({ rateKind: 'per_km', rate: '10' }, {})).toBe('0.00');
  });
});

describe('computeTripMargin', () => {
  test('доход минус топливо, наёмный перевозчик и прочие статьи', () => {
    const r = computeTripMargin({
      ordersAmount: '50000',
      fuelAmount: '8000',
      driverPay: '2000',
      carrierRate: null,
      otherCosts: '1500',
    });
    expect(r).toEqual({
      income: '50000.00',
      fuelAmount: '8000.00',
      driverPay: '2000.00',
      carrierRate: '0.00',
      otherCosts: '1500.00',
      totalCosts: '11500.00',
      margin: '38500.00',
      marginPct: '77.00',
    });
  });
  test('доход 0 — маржа в процентах null', () => {
    expect(computeTripMargin({ ordersAmount: '0' }).marginPct).toBeNull();
  });
  test('наёмный рейс: ставка перевозчику входит в затраты', () => {
    const r = computeTripMargin({ ordersAmount: '20000', carrierRate: '15000' });
    expect(r.margin).toBe('5000.00');
  });
});

describe('computeForwardingMargin', () => {
  test('маржа экспедитора = ставка клиенту минус ставка перевозчику', () => {
    expect(computeForwardingMargin('20000', '15000')).toEqual({ margin: '5000.00', marginPct: '25.00' });
  });
  test('доход 0 — процент null', () => {
    expect(computeForwardingMargin('0', '0').marginPct).toBeNull();
  });
});

describe('findRateSchedule', () => {
  const schedules = [
    { fromPlace: 'Москва', toPlace: 'Казань', bodyType: '', rateKind: 'flat' as const, rate: '20000', distanceKm: '820' },
    { fromPlace: 'Москва', toPlace: 'Казань', bodyType: 'Рефрижератор', rateKind: 'flat' as const, rate: '28000', distanceKm: '820' },
  ];
  test('совпадение по направлению без учёта регистра', () => {
    expect(findRateSchedule(schedules, { fromPlace: 'москва', toPlace: 'КАЗАНЬ' })?.rate).toBe('20000');
  });
  test('точное совпадение по типу кузова важнее общего тарифа', () => {
    expect(findRateSchedule(schedules, { fromPlace: 'Москва', toPlace: 'Казань', bodyType: 'Рефрижератор' })?.rate).toBe('28000');
  });
  test('нет совпадения по направлению — null', () => {
    expect(findRateSchedule(schedules, { fromPlace: 'Москва', toPlace: 'Сочи' })).toBeNull();
  });
});
