/* Аналитика транспорта (задача 1216): типы отчёта, чистые расчёты OTD, загрузки, удельных затрат и маскирование финансовых полей. */
import { dec, div, fmt, mul } from './decimal';

export type OtdStatus = 'on_time' | 'late' | 'failed' | 'no_window';

export interface TransportAnalyticsSummary {
  ordersCount: number;
  deliveriesCompleted: number;
  deliveriesTotal: number;
  tripsCount: number;
  doneTripsCount: number;
  totalKm: string;
  otdPct: string | null;
  avgVehicleLoadPct: string | null;
  /** Финансовые поля доступны только admin и owner (иначе null) */
  totalCost: string | null;
  totalRevenue: string | null;
  margin: string | null;
  marginPct: string | null;
  costPerOrder: string | null;
  costPerTrip: string | null;
  costPerKm: string | null;
}

export interface TransportCostBreakdown {
  fuelCost: string | null;
  repairCost: string | null;
  finesCost: string | null;
  driverPayCost: string | null;
  carrierCost: string | null;
  otherTripCost: string | null;
  deliveryCost: string | null;
  totalCost: string | null;
  totalRevenue: string | null;
  margin: string | null;
  marginPct: string | null;
  costPerOrder: string | null;
  costPerTrip: string | null;
  costPerKm: string | null;
}

export interface TransportCostDayRow {
  date: string;
  orders: number;
  trips: number;
  km: string;
  cost: string | null;
  revenue: string | null;
}

export interface TransportOtdRow {
  id: string;
  source: 'delivery' | 'trip_stop';
  label: string;
  documentId: string | null;
  tripId: string | null;
  tripNumber: string | null;
  courierName: string | null;
  targetDate: string | null;
  windowFrom: string | null;
  windowTo: string | null;
  actualDate: string | null;
  actualTime: string | null;
  status: OtdStatus;
  delayMinutes: number | null;
}

export interface TransportOtdDayRow {
  date: string;
  onTime: number;
  late: number;
  failed: number;
  otdPct: string | null;
}

export interface TransportOtdReport {
  total: number;
  onTime: number;
  late: number;
  failed: number;
  noWindow: number;
  otdPct: string | null;
  byDay: TransportOtdDayRow[];
  rows: TransportOtdRow[];
}

export interface TransportVehicleUtilizationRow {
  vehicleId: string;
  plate: string;
  name: string;
  kind: string;
  tripsCount: number;
  doneTripsCount: number;
  activeDays: number;
  periodDays: number;
  timeUtilizationPct: string;
  distanceKm: string;
  fuelLiters: string;
  capacityKg: string | null;
  avgWeightKg: string;
  weightUtilizationPct: string | null;
  volumeM3: string | null;
  avgVolumeM3: string;
  volumeUtilizationPct: string | null;
  pallets: number | null;
  avgPallets: string;
  palletsUtilizationPct: string | null;
  overloadsCount: number;
  fuelCost: string | null;
  repairCost: string | null;
  finesCost: string | null;
  totalCost: string | null;
  costPerKm: string | null;
}

export interface TransportDriverOutputRow {
  memberId: string;
  memberName: string;
  roles: ('driver' | 'courier')[];
  tripsCount: number;
  doneTripsCount: number;
  stopsDone: number;
  deliveriesTotal: number;
  deliveriesCompleted: number;
  deliveriesFailed: number;
  otdPct: string | null;
  distanceKm: string;
  payrollAmount: string | null;
  payrollCost: string | null;
  deliveryCost: string | null;
  totalCost: string | null;
  costPerDelivery: string | null;
  costPerKm: string | null;
}

export interface TransportAnalyticsReport {
  from: string;
  to: string;
  canSeeCost: boolean;
  summary: TransportAnalyticsSummary;
  cost: TransportCostBreakdown;
  byDay: TransportCostDayRow[];
  otd: TransportOtdReport;
  vehicles: TransportVehicleUtilizationRow[];
  drivers: TransportDriverOutputRow[];
}

const toMin = (hhmm: string): number => {
  const [h, m] = hhmm.slice(0, 5).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

const dayDiff = (from: string, to: string): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** Оценка доставки вовремя (OTD): сравнивает фактическую дату и время с плановой датой и концом окна */
export function evaluateOnTime(input: {
  status: string;
  targetDate: string | null;
  windowTo: string | null;
  actualDate: string | null;
  actualTime: string | null;
}): { status: OtdStatus; delayMinutes: number | null } {
  if (input.status === 'failed') return { status: 'failed', delayMinutes: null };
  if (!input.targetDate || !input.actualDate) return { status: 'no_window', delayMinutes: null };
  const targetWin = input.windowTo ? input.windowTo.slice(0, 5) : null;
  const actualTime = input.actualTime ? input.actualTime.slice(0, 5) : null;
  if (input.actualDate > input.targetDate) {
    const days = dayDiff(input.targetDate, input.actualDate);
    const extraMin = targetWin && actualTime ? toMin(actualTime) - toMin(targetWin) : 0;
    return { status: 'late', delayMinutes: Math.max(1, days * 1440 + extraMin) };
  }
  if (input.actualDate < input.targetDate) return { status: 'on_time', delayMinutes: 0 };
  if (targetWin && actualTime) {
    const delta = toMin(actualTime) - toMin(targetWin);
    return delta <= 0 ? { status: 'on_time', delayMinutes: 0 } : { status: 'late', delayMinutes: delta };
  }
  return { status: 'on_time', delayMinutes: 0 };
}

/** Отношение a / b с заданной точностью; null при делении на 0 */
export function computeRatio(numerator: string, denominator: string, scale = 2): string | null {
  const b = dec(denominator);
  if (b <= 0n) return null;
  return fmt(div(dec(numerator), b), scale);
}

/** Процент загрузки/использования: used / capacity × 100; null если лимит не задан или <= 0 */
export function computeUtilizationPct(used: string | number, capacity: string | number | null | undefined, scale = 1): string | null {
  if (capacity === null || capacity === undefined || capacity === '') return null;
  const cap = dec(capacity);
  if (cap <= 0n) return null;
  return fmt(div(mul(dec(used), dec(100)), cap), scale);
}

/** Скрывает финансовые и зарплатные поля от не-администраторов */
export function maskTransportAnalytics(r: TransportAnalyticsReport, seeCost: boolean): TransportAnalyticsReport {
  if (seeCost) return { ...r, canSeeCost: true };
  return {
    ...r,
    canSeeCost: false,
    summary: {
      ...r.summary,
      totalCost: null,
      totalRevenue: null,
      margin: null,
      marginPct: null,
      costPerOrder: null,
      costPerTrip: null,
      costPerKm: null,
    },
    cost: {
      fuelCost: null,
      repairCost: null,
      finesCost: null,
      driverPayCost: null,
      carrierCost: null,
      otherTripCost: null,
      deliveryCost: null,
      totalCost: null,
      totalRevenue: null,
      margin: null,
      marginPct: null,
      costPerOrder: null,
      costPerTrip: null,
      costPerKm: null,
    },
    byDay: r.byDay.map(d => ({ ...d, cost: null, revenue: null })),
    vehicles: r.vehicles.map(v => ({
      ...v,
      fuelCost: null,
      repairCost: null,
      finesCost: null,
      totalCost: null,
      costPerKm: null,
    })),
    drivers: r.drivers.map(d => ({
      ...d,
      payrollAmount: null,
      payrollCost: null,
      deliveryCost: null,
      totalCost: null,
      costPerDelivery: null,
      costPerKm: null,
    })),
  };
}
