/* Форматирование денег для CRM (все суммы в USD) */
const full = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

/** $48,500 */
export const money = (n: number) => full.format(Math.round(n));

/** $48.5K, $1.2M — для шапок колонок и подписей на графиках */
export function moneyShort(n: number) {
  const a = Math.abs(n);
  if (a >= 1e6) return `$${+(n / 1e6).toFixed(a >= 1e7 ? 1 : 2)}M`;
  if (a >= 1e3) return `$${+(n / 1e3).toFixed(a >= 1e5 ? 0 : 1)}K`;
  return `$${Math.round(n)}`;
}

export const pct = (p: number) => `${Math.round(p * 100)}%`;
