/* Базовые помощники дат для демо-данных. Вынесены из фронтенда, чтобы сиды API и браузера считали даты одинаково. */
import type { IsoDate } from '../domain';

export const DAY = 864e5;

export const sod = (d: Date | number) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};
export const today = () => sod(new Date());

export const iso = (d: Date): IsoDate => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Дата через n дней от сегодня */
export const dOff = (n: number): IsoDate => {
  const x = today();
  x.setDate(x.getDate() + n);
  return iso(x);
};

export const minsAgo = (m: number) => Date.now() - m * 6e4;
