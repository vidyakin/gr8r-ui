/* Форматирование денег для CRM (все суммы в USD), разделители — по языку интерфейса */
import { fmtCurrency } from '@/i18n';

/** $48,500 / 48 500 $ */
export const money = (n: number) => fmtCurrency(Math.round(n), 'USD', { maximumFractionDigits: 0 });

/** $48.5K, $1.2M / 48,5 тыс. $ — для шапок колонок и подписей на графиках */
export function moneyShort(n: number) {
  const a = Math.abs(n);
  if (a < 1e3) return fmtCurrency(Math.round(n), 'USD', { maximumFractionDigits: 0 });
  return fmtCurrency(n, 'USD', { notation: 'compact', maximumFractionDigits: a >= 1e7 || (a >= 1e5 && a < 1e6) ? 1 : 2, minimumFractionDigits: 0 });
}

export const pct = (p: number) => `${Math.round(p * 100)}%`;
