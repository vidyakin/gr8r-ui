/* Рендер-тесты вкладок аналитики транспорта (задача 1216): проверка вывода данных, CSV-кнопки и скрытия финансовых колонок для member. */
import { beforeAll, describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { maskTransportAnalytics, type TransportAnalyticsReport } from '@erp/shared';
import { loadLocale, setLocale } from '@/i18n';
import { CostTab } from './CostTab';
import { DriversTab } from './DriversTab';
import { OtdTab } from './OtdTab';
import { VehiclesTab } from './VehiclesTab';

const sample: TransportAnalyticsReport = {
  from: '2026-10-01',
  to: '2026-10-31',
  canSeeCost: true,
  summary: {
    ordersCount: 4,
    deliveriesCompleted: 4,
    deliveriesTotal: 5,
    tripsCount: 2,
    doneTripsCount: 2,
    totalKm: '250.0',
    otdPct: '75.0',
    avgVehicleLoadPct: '70.0',
    totalCost: '15000.00',
    totalRevenue: '24000.00',
    margin: '9000.00',
    marginPct: '37.5',
    costPerOrder: '3750.00',
    costPerTrip: '7500.00',
    costPerKm: '60.00',
  },
  cost: {
    fuelCost: '6000.00',
    repairCost: '2000.00',
    finesCost: '500.00',
    driverPayCost: '4000.00',
    carrierCost: '1500.00',
    otherTripCost: '500.00',
    deliveryCost: '500.00',
    totalCost: '15000.00',
    totalRevenue: '24000.00',
    margin: '9000.00',
    marginPct: '37.5',
    costPerOrder: '3750.00',
    costPerTrip: '7500.00',
    costPerKm: '60.00',
  },
  byDay: [{ date: '2026-10-10', orders: 4, trips: 2, km: '250.0', cost: '15000.00', revenue: '24000.00' }],
  otd: {
    total: 2,
    onTime: 1,
    late: 1,
    failed: 0,
    noWindow: 0,
    otdPct: '50.0',
    byDay: [{ date: '2026-10-10', onTime: 1, late: 1, failed: 0, otdPct: '50.0' }],
    rows: [
      {
        id: 'd1',
        source: 'delivery',
        label: 'ЗК-2026-00001',
        documentId: 'doc-1',
        tripId: 't1',
        tripNumber: 'РС-2026-00001',
        courierName: 'Иван Водитель',
        targetDate: '2026-10-10',
        windowFrom: '09:00',
        windowTo: '12:00',
        actualDate: '2026-10-10',
        actualTime: '11:30',
        status: 'on_time',
        delayMinutes: 0,
      },
      {
        id: 'd2',
        source: 'delivery',
        label: 'ЗК-2026-00002',
        documentId: 'doc-2',
        tripId: 't1',
        tripNumber: 'РС-2026-00001',
        courierName: 'Иван Водитель',
        targetDate: '2026-10-10',
        windowFrom: '13:00',
        windowTo: '15:00',
        actualDate: '2026-10-10',
        actualTime: '15:45',
        status: 'late',
        delayMinutes: 45,
      },
    ],
  },
  vehicles: [
    {
      vehicleId: 'v1',
      plate: 'А100АА77',
      name: 'Газель Next',
      kind: 'van',
      tripsCount: 2,
      doneTripsCount: 2,
      activeDays: 2,
      periodDays: 31,
      timeUtilizationPct: '6.5',
      distanceKm: '250.0',
      fuelLiters: '35.0',
      capacityKg: '1500.000',
      avgWeightKg: '1050.0',
      weightUtilizationPct: '70.0',
      volumeM3: '10.000',
      avgVolumeM3: '6.00',
      volumeUtilizationPct: '60.0',
      pallets: 4,
      avgPallets: '3.0',
      palletsUtilizationPct: '75.0',
      overloadsCount: 0,
      fuelCost: '6000.00',
      repairCost: '2000.00',
      finesCost: '500.00',
      totalCost: '8500.00',
      costPerKm: '34.00',
    },
  ],
  drivers: [
    {
      memberId: 'm1',
      memberName: 'Иван Водитель',
      roles: ['driver', 'courier'],
      tripsCount: 2,
      doneTripsCount: 2,
      stopsDone: 4,
      deliveriesTotal: 5,
      deliveriesCompleted: 4,
      deliveriesFailed: 0,
      otdPct: '50.0',
      distanceKm: '250.0',
      payrollAmount: '3500.00',
      payrollCost: '4000.00',
      deliveryCost: '500.00',
      totalCost: '4500.00',
      costPerDelivery: '1125.00',
      costPerKm: '18.00',
    },
  ],
};

const render = (node: React.ReactNode) => renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>).replace(/\u00a0/g, ' ');

beforeAll(async () => {
  await loadLocale('ru');
  setLocale('ru');
});

describe('TransportAnalytics tabs', () => {
  test('renders CostTab, OtdTab, VehiclesTab and DriversTab with admin data and CSV export', () => {
    const costHtml = render(<CostTab data={sample} />);
    expect(costHtml).toContain('Структура затрат');
    expect(costHtml).toContain('Выгрузить CSV');
    expect(costHtml).toContain('6 000');

    const otdHtml = render(<OtdTab data={sample} />);
    expect(otdHtml).toContain('ЗК-2026-00001');
    expect(otdHtml).toContain('ЗК-2026-00002');
    expect(otdHtml).toContain('45 мин');
    expect(otdHtml).toContain('Вовремя');
    expect(otdHtml).toContain('Опоздание');

    const vehHtml = render(<VehiclesTab data={sample} />);
    expect(vehHtml).toContain('А100АА77');
    expect(vehHtml).toContain('Газель Next');
    expect(vehHtml).toContain('2/31');
    expect(vehHtml).toContain('70 %');

    const drvHtml = render(<DriversTab data={sample} />);
    expect(drvHtml).toContain('Иван Водитель');
    expect(drvHtml).toContain('Водитель, Курьер');
    expect(drvHtml).toContain('3 500');
  });

  test('hides financial columns when canSeeCost is false', () => {
    const masked = maskTransportAnalytics(sample, false);
    const costHtml = render(<CostTab data={masked} />);
    expect(costHtml).not.toContain('Структура затрат');
    expect(costHtml).toContain('Заказы и пробег по дням');

    const vehHtml = render(<VehiclesTab data={masked} />);
    expect(vehHtml).toContain('А100АА77');
    expect(vehHtml).not.toContain('8 500');

    const drvHtml = render(<DriversTab data={masked} />);
    expect(drvHtml).toContain('Иван Водитель');
    expect(drvHtml).not.toContain('3 500');
  });
});
