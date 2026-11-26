/* Юнит-тесты аналитики транспорта (задача 1216): OTD, загрузка, удельные показатели, маскирование финансовых полей. */
import { describe, expect, test } from 'bun:test';
import {
  computeRatio,
  computeUtilizationPct,
  evaluateOnTime,
  maskTransportAnalytics,
  type TransportAnalyticsReport,
} from '../src/transport-analytics';

describe('transport analytics pure calculations', () => {
  test('evaluateOnTime handles windows, boundaries, multi-day delays and failures', () => {
    expect(evaluateOnTime({ status: 'delivered', targetDate: '2026-10-15', windowTo: '14:00', actualDate: '2026-10-15', actualTime: '13:45' })).toEqual({ status: 'on_time', delayMinutes: 0 });
    expect(evaluateOnTime({ status: 'delivered', targetDate: '2026-10-15', windowTo: '14:00', actualDate: '2026-10-15', actualTime: '14:00' })).toEqual({ status: 'on_time', delayMinutes: 0 });
    expect(evaluateOnTime({ status: 'delivered', targetDate: '2026-10-15', windowTo: '14:00', actualDate: '2026-10-15', actualTime: '14:25' })).toEqual({ status: 'late', delayMinutes: 25 });
    expect(evaluateOnTime({ status: 'delivered', targetDate: '2026-10-15', windowTo: '14:00', actualDate: '2026-10-16', actualTime: '14:10' })).toEqual({ status: 'late', delayMinutes: 1450 });
    expect(evaluateOnTime({ status: 'delivered', targetDate: '2026-10-15', windowTo: '14:00', actualDate: '2026-10-14', actualTime: '18:00' })).toEqual({ status: 'on_time', delayMinutes: 0 });
    expect(evaluateOnTime({ status: 'delivered', targetDate: '2026-10-15', windowTo: null, actualDate: '2026-10-15', actualTime: null })).toEqual({ status: 'on_time', delayMinutes: 0 });
    expect(evaluateOnTime({ status: 'delivered', targetDate: '2026-10-15', windowTo: null, actualDate: '2026-10-17', actualTime: null })).toEqual({ status: 'late', delayMinutes: 2880 });
    expect(evaluateOnTime({ status: 'failed', targetDate: '2026-10-15', windowTo: '14:00', actualDate: null, actualTime: null })).toEqual({ status: 'failed', delayMinutes: null });
    expect(evaluateOnTime({ status: 'delivered', targetDate: null, windowTo: null, actualDate: '2026-10-15', actualTime: null })).toEqual({ status: 'no_window', delayMinutes: null });
  });

  test('computeRatio and computeUtilizationPct handle zero and null safely', () => {
    expect(computeRatio('1000.00', '4', 2)).toBe('250.00');
    expect(computeRatio('1000.00', '0', 2)).toBeNull();
    expect(computeUtilizationPct('750', '1000')).toBe('75.0');
    expect(computeUtilizationPct('1200', '1000')).toBe('120.0');
    expect(computeUtilizationPct('500', null)).toBeNull();
    expect(computeUtilizationPct('500', '0')).toBeNull();
  });

  test('maskTransportAnalytics hides all financial fields for non-admins while keeping operational metrics', () => {
    const sample: TransportAnalyticsReport = {
      from: '2026-10-01',
      to: '2026-10-31',
      canSeeCost: true,
      summary: {
        ordersCount: 10,
        deliveriesCompleted: 8,
        deliveriesTotal: 10,
        tripsCount: 4,
        doneTripsCount: 3,
        totalKm: '400.0',
        otdPct: '80.0',
        avgVehicleLoadPct: '65.0',
        totalCost: '12000.00',
        totalRevenue: '20000.00',
        margin: '8000.00',
        marginPct: '40.0',
        costPerOrder: '1200.00',
        costPerTrip: '3000.00',
        costPerKm: '30.00',
      },
      cost: {
        fuelCost: '4000.00',
        repairCost: '1000.00',
        finesCost: '500.00',
        driverPayCost: '3500.00',
        carrierCost: '2000.00',
        otherTripCost: '500.00',
        deliveryCost: '500.00',
        totalCost: '12000.00',
        totalRevenue: '20000.00',
        margin: '8000.00',
        marginPct: '40.0',
        costPerOrder: '1200.00',
        costPerTrip: '3000.00',
        costPerKm: '30.00',
      },
      byDay: [{ date: '2026-10-10', orders: 5, trips: 2, km: '200.0', cost: '6000.00', revenue: '10000.00' }],
      otd: { total: 5, onTime: 4, late: 1, failed: 0, noWindow: 0, otdPct: '80.0', byDay: [], rows: [] },
      vehicles: [
        {
          vehicleId: 'v1',
          plate: 'А123АА77',
          name: 'Газель',
          kind: 'van',
          tripsCount: 4,
          doneTripsCount: 3,
          activeDays: 4,
          periodDays: 31,
          timeUtilizationPct: '12.9',
          distanceKm: '400.0',
          fuelLiters: '50.0',
          capacityKg: '1500.000',
          avgWeightKg: '975.0',
          weightUtilizationPct: '65.0',
          volumeM3: '10.000',
          avgVolumeM3: '5.00',
          volumeUtilizationPct: '50.0',
          pallets: 4,
          avgPallets: '2.0',
          palletsUtilizationPct: '50.0',
          overloadsCount: 0,
          fuelCost: '4000.00',
          repairCost: '1000.00',
          finesCost: '500.00',
          totalCost: '5500.00',
          costPerKm: '13.75',
        },
      ],
      drivers: [
        {
          memberId: 'm1',
          memberName: 'Иван',
          roles: ['driver', 'courier'],
          tripsCount: 4,
          doneTripsCount: 3,
          stopsDone: 8,
          deliveriesTotal: 10,
          deliveriesCompleted: 8,
          deliveriesFailed: 1,
          otdPct: '80.0',
          distanceKm: '400.0',
          payrollAmount: '3000.00',
          payrollCost: '3500.00',
          deliveryCost: '500.00',
          totalCost: '4000.00',
          costPerDelivery: '500.00',
          costPerKm: '10.00',
        },
      ],
    };

    const masked = maskTransportAnalytics(sample, false);
    expect(masked.canSeeCost).toBe(false);
    expect(masked.summary.ordersCount).toBe(10);
    expect(masked.summary.otdPct).toBe('80.0');
    expect(masked.summary.totalCost).toBeNull();
    expect(masked.summary.costPerOrder).toBeNull();
    expect(masked.summary.costPerKm).toBeNull();
    expect(masked.cost.fuelCost).toBeNull();
    expect(masked.cost.driverPayCost).toBeNull();
    expect(masked.byDay[0]!.cost).toBeNull();
    expect(masked.byDay[0]!.km).toBe('200.0');
    expect(masked.vehicles[0]!.weightUtilizationPct).toBe('65.0');
    expect(masked.vehicles[0]!.totalCost).toBeNull();
    expect(masked.drivers[0]!.deliveriesCompleted).toBe(8);
    expect(masked.drivers[0]!.payrollAmount).toBeNull();
    expect(masked.drivers[0]!.totalCost).toBeNull();
  });
});
