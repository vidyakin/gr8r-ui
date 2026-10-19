/* Работа с датами — порт core/utils.js из gr8r-studio */
import type { IsoDate } from '../data/types';

export const DAY = 864e5;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const sod = (d: Date | number) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};
export const today = () => sod(new Date());

export const iso = (d: Date): IsoDate => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const parse = (s: IsoDate) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};

/** Дата через n дней от сегодня */
export const dOff = (n: number): IsoDate => {
  const x = today();
  x.setDate(x.getDate() + n);
  return iso(x);
};

/** Разница в днях a − b */
export const diffDays = (a: Date, b: Date) => Math.round((sod(a).getTime() - sod(b).getTime()) / DAY);

/** «Oct 30», с годом — если год не текущий */
export function fmtDate(s: IsoDate | Date, long = false) {
  const d = typeof s === 'string' ? parse(s) : s;
  return `${MON[d.getMonth()]} ${d.getDate()}${long || d.getFullYear() !== new Date().getFullYear() ? ', ' + d.getFullYear() : ''}`;
}

/** «Today», «Tomorrow», «Yesterday», день недели на ближайшую неделю, иначе дата */
export function relDate(s: IsoDate | Date) {
  const d = typeof s === 'string' ? parse(s) : s;
  const n = diffDays(d, today());
  if (n === 0) return 'Today';
  if (n === 1) return 'Tomorrow';
  if (n === -1) return 'Yesterday';
  if (n > 1 && n < 7) return WD[d.getDay()];
  return fmtDate(d);
}

/** «38m ago», «2h ago», «3d ago» */
export function ago(ts: number) {
  const m = Math.round((Date.now() - ts) / 6e4);
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm ago';
  const h = Math.round(m / 60);
  if (h < 24) return h + 'h ago';
  const d = Math.round(h / 24);
  if (d < 7) return d + 'd ago';
  return fmtDate(new Date(ts));
}

export const minsAgo = (m: number) => Date.now() - m * 6e4;
