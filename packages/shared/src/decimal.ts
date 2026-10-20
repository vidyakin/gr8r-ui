/* Десятичная арифметика без float: числа — BigInt с масштабом 10^-6. Деньги и количества ходят строками (numeric в БД),
   считаем целыми, поэтому 0.1 + 0.2 равно 0.3, а результат одинаков на сервере и в интерфейсе. */

export type Dec = bigint;

const SCALE = 6;
const ONE = 10n ** BigInt(SCALE);

/** Строка или число → Dec. Пустое/некорректное значение — 0 */
export function dec(v: string | number | null | undefined): Dec {
  if (v === null || v === undefined || v === '') return 0n;
  const s = typeof v === 'number' ? (Number.isFinite(v) ? v.toFixed(SCALE) : '0') : v.trim();
  const m = /^(-?)(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m || (m[2] === '' && !m[3])) return 0n;
  const frac = (m[3] ?? '').padEnd(SCALE + 1, '0');
  let n = BigInt(m[2] || '0') * ONE + BigInt(frac.slice(0, SCALE));
  if (Number(frac[SCALE]) >= 5) n += 1n; // округление половины вверх по модулю
  return m[1] ? -n : n;
}

/** Деление целых с округлением половины от нуля */
function roundDiv(a: bigint, b: bigint): bigint {
  if (b === 0n) throw new RangeError('Division by zero');
  const neg = a < 0n !== b < 0n;
  const x = a < 0n ? -a : a;
  const y = b < 0n ? -b : b;
  const q = (x * 2n + y) / (y * 2n);
  return neg ? -q : q;
}

export const add = (a: Dec, b: Dec): Dec => a + b;
export const mul = (a: Dec, b: Dec): Dec => roundDiv(a * b, ONE);
export const div = (a: Dec, b: Dec): Dec => roundDiv(a * ONE, b);
/** a × (1 + pct/100) */
export const withPct = (a: Dec, pct: Dec): Dec => a + roundDiv(a * pct, 100n * ONE);
/** pct процентов от a */
export const pctOf = (a: Dec, pct: Dec): Dec => roundDiv(a * pct, 100n * ONE);

/** Dec → строка с фиксированным числом знаков (округление половины от нуля) */
export function fmt(a: Dec, dp = 4): string {
  const neg = a < 0n;
  const abs = neg ? -a : a;
  const r = dp >= SCALE ? abs * 10n ** BigInt(dp - SCALE) : roundDiv(abs, 10n ** BigInt(SCALE - dp));
  const s = r.toString().padStart(dp + 1, '0');
  const out = dp ? `${s.slice(0, -dp)}.${s.slice(-dp)}` : s;
  return neg && r !== 0n ? `-${out}` : out;
}
