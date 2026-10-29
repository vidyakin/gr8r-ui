/* Форматирование чисел, денег и дат по текущему языку. Только для показа: ru-RU даёт запятую и неразрывные пробелы,
   поэтому значения input, CSV и печатные формы так не форматируются. Форматтеры Intl кешируются по локали и опциям */
import { getLocale, intlLocale } from './locale';

const numCache = new Map<string, Intl.NumberFormat>();
const dateCache = new Map<string, Intl.DateTimeFormat>();

function numFmt(opts: Intl.NumberFormatOptions = {}) {
  const k = getLocale() + JSON.stringify(opts);
  let f = numCache.get(k);
  if (!f) numCache.set(k, (f = new Intl.NumberFormat(intlLocale(), opts)));
  return f;
}

function dateFmt(opts: Intl.DateTimeFormatOptions) {
  const k = getLocale() + JSON.stringify(opts);
  let f = dateCache.get(k);
  if (!f) dateCache.set(k, (f = new Intl.DateTimeFormat(intlLocale(), opts)));
  return f;
}

/** 1,234.5 / 1 234,5 */
export const fmtNumber = (n: number | string | null | undefined, opts?: Intl.NumberFormatOptions) => numFmt(opts).format(Number(n ?? 0));

/** Сумма с двумя знаками без символа валюты: 1,234.50 / 1 234,50 */
export const fmtAmount = (n: number | string | null | undefined) => fmtNumber(n, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Сумма с валютой: $1,234.50 / 1 234,50 $ */
export const fmtCurrency = (n: number | string | null | undefined, currency = 'USD', opts?: Intl.NumberFormatOptions) =>
  fmtNumber(n, { style: 'currency', currency, ...opts });

/** Сокращённая запись: 48.5K / 48,5 тыс. */
export const fmtCompact = (n: number, opts?: Intl.NumberFormatOptions) => fmtNumber(n, { notation: 'compact', maximumFractionDigits: 1, ...opts });

export const fmtDateTimeIntl = (d: Date | string | number, opts: Intl.DateTimeFormatOptions) => dateFmt(opts).format(new Date(d));

/** Дата и время: «Oct 23, 2026, 2:30 PM» / «23 окт. 2026 г., 14:30» */
export const fmtDateTime = (d: Date | string | number) => fmtDateTimeIntl(d, { dateStyle: 'medium', timeStyle: 'short' });

/** Разбор числа, введённого по правилам языка: en «50,000.5» → 50000.5, ru «50 000,5» → 50000.5 */
export function parseNumber(s: string): number {
  const v = getLocale() === 'ru' ? s.replace(/[\s\u00a0\u202f]/g, '').replace(',', '.') : s.replace(/,/g, '');
  return Number(v.replace(/[^0-9.-]/g, ''));
}

/** Короткое имя месяца (0–11) */
export const monthShort = (m: number) => fmtDateTimeIntl(new Date(2000, m, 1), { month: 'short' }).replace('.', '');

/** Короткое имя дня недели (0 — воскресенье) */
export const weekdayShort = (wd: number) => fmtDateTimeIntl(new Date(2000, 0, 2 + wd), { weekday: 'short' });

/** Месяц с годом из «2026-10»: «October 2026» / «октябрь 2026» (без «г.», который ru-RU добавляет к году) */
export function fmtMonthYear(month: string) {
  const [y, m] = month.split('-').map(Number);
  if (!y || !m) return month;
  return `${fmtDateTimeIntl(new Date(y, m - 1, 1), { month: 'long' })} ${y}`;
}
