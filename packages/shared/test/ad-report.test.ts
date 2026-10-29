/* Задача 1177: расчёт отчёта по каналам — конверсия, CPL, цена клиента, ROMI и итог от сумм. */
import { describe, expect, test } from 'bun:test';
import { adReportRow, buildAdReport } from '../src/ad-report';

describe('отчёт по каналам', () => {
  test('показатели строки', () => {
    expect(adReportRow({ key: 'a', leads: 3, converted: 1, newClients: 2, wonDeals: 1, revenue: '30000', expense: '10000' })).toMatchObject({
      revenue: '30000.00',
      expense: '10000.00',
      conversion: '33.3',
      cpl: '3333.33',
      cac: '5000.00',
      romi: '200.0',
    });
  });
  test('без лидов и расходов показатели пустые, убыток — отрицательный ROMI', () => {
    expect(adReportRow({ key: null, leads: 0, converted: 0, newClients: 0, wonDeals: 0, revenue: '0', expense: '0' })).toMatchObject({ conversion: null, cpl: null, cac: null, romi: null });
    expect(adReportRow({ key: 'b', leads: 1, converted: 0, newClients: 0, wonDeals: 0, revenue: '0', expense: '500' }).romi).toBe('-100.0');
  });
  test('итог считается от сумм', () => {
    const { total } = buildAdReport([
      { key: 'a', leads: 1, converted: 1, newClients: 1, wonDeals: 1, revenue: '1000', expense: '100' },
      { key: 'b', leads: 3, converted: 0, newClients: 0, wonDeals: 0, revenue: '0', expense: '300.5' },
    ]);
    expect(total).toMatchObject({ leads: 4, converted: 1, revenue: '1000.00', expense: '400.50', conversion: '25.0', cpl: '100.13', romi: '149.7' });
  });
});
