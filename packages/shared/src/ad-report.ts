/* Отчёт по каналам привлечения (задача 1177): конверсия, цена лида (CPL) и окупаемость рекламы (ROMI).
   Чистый расчёт на decimal.ts — один и тот же на сервере и в тестах. */
import { add, dec, div, fmt, type Dec } from './decimal';

/** Тип источника (как в 1С:ERP): канал; партнёр (контрагент) или контактное лицо — у записи указывается, кто привёл */
export const LEAD_SOURCE_KINDS = ['channel', 'partner', 'contact'] as const;
export type LeadSourceKind = (typeof LEAD_SOURCE_KINDS)[number];

/** Сырые показатели строки отчёта (источник или кампания; key = null — «без источника») */
export interface AdReportInput {
  key: string | null;
  leads: number;
  converted: number;
  newClients: number;
  wonDeals: number;
  /** Сумма выигранных сделок */
  revenue: string;
  /** Расходы на рекламу */
  expense: string;
}

export interface AdReportRow extends AdReportInput {
  /** Конверсия лидов в клиентов, %; null — лидов нет */
  conversion: string | null;
  /** Цена лида = расход / лиды; null — лидов нет */
  cpl: string | null;
  /** Цена клиента = расход / новые клиенты; null — клиентов нет */
  cac: string | null;
  /** ROMI = (выручка − расход) / расход × 100 %; null — расходов нет */
  romi: string | null;
}

const ratio = (a: Dec, b: Dec, dp: number) => (b === 0n ? null : fmt(div(a, b), dp));

export function adReportRow(r: AdReportInput): AdReportRow {
  const expense = dec(r.expense);
  const revenue = dec(r.revenue);
  return {
    ...r,
    revenue: fmt(revenue, 2),
    expense: fmt(expense, 2),
    conversion: ratio(dec(r.converted) * 100n, dec(r.leads), 1),
    cpl: ratio(expense, dec(r.leads), 2),
    cac: ratio(expense, dec(r.newClients), 2),
    romi: expense === 0n ? null : fmt(div((revenue - expense) * 100n, expense), 1),
  };
}

/** Строки отчёта и итог (итоговые показатели считаются от сумм, а не усредняются) */
export function buildAdReport(rows: AdReportInput[]): { rows: AdReportRow[]; total: AdReportRow } {
  const t = rows.reduce(
    (s, r) => ({ leads: s.leads + r.leads, converted: s.converted + r.converted, newClients: s.newClients + r.newClients, wonDeals: s.wonDeals + r.wonDeals, revenue: add(s.revenue, dec(r.revenue)), expense: add(s.expense, dec(r.expense)) }),
    { leads: 0, converted: 0, newClients: 0, wonDeals: 0, revenue: 0n as Dec, expense: 0n as Dec },
  );
  return {
    rows: rows.map(adReportRow),
    total: adReportRow({ key: null, leads: t.leads, converted: t.converted, newClients: t.newClients, wonDeals: t.wonDeals, revenue: fmt(t.revenue, 2), expense: fmt(t.expense, 2) }),
  };
}
