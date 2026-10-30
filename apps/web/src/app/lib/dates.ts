/* Работа с датами — порт core/utils.js из gr8r-studio */
import type { IsoDate } from '../data/types';
import { DAY, dOff, iso, minsAgo, sod, today } from '@gr8r/shared/demo';
import { fmtDateTimeIntl, getFormatPrefs, t, weekdayShort } from '@/i18n';

/* Базовые помощники (DAY, sod, today, iso, dOff, minsAgo) живут в shared — их же используют сиды. */
export { DAY, dOff, iso, minsAgo, sod, today };

export const parse = (s: IsoDate) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};

/** Разница в днях a − b */
export const diffDays = (a: Date, b: Date) => Math.round((sod(a).getTime() - sod(b).getTime()) / DAY);

/** «Oct 30» / «30 окт.», с годом — если год не текущий (по языку интерфейса); личный числовой формат — «30/10», «10/30», «2026-10-30» */
export function fmtDate(s: IsoDate | Date, long = false) {
  if (!s) return '—'; // дата не задана (с сервера проект может прийти без сроков)
  const d = typeof s === 'string' ? parse(s) : s;
  const withYear = long || d.getFullYear() !== new Date().getFullYear();
  const f = getFormatPrefs().dateFmt;
  if (f !== 'MMM d') {
    // Личный числовой формат (Настройки → Дата и время)
    const dd = d.getDate();
    const mm = d.getMonth() + 1;
    if (f === 'yyyy-MM-dd') return `${d.getFullYear()}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
    const base = f === 'd/M' ? `${dd}/${mm}` : `${mm}/${dd}`;
    return withYear ? `${base}/${d.getFullYear()}` : base;
  }
  return fmtDateTimeIntl(d, { month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' } : {}) });
}

/** «Today», «Tomorrow», «Yesterday», день недели на ближайшую неделю, иначе дата */
export function relDate(s: IsoDate | Date) {
  if (!s) return '—';
  const d = typeof s === 'string' ? parse(s) : s;
  const n = diffDays(d, today());
  if (n === 0) return t('dates.today');
  if (n === 1) return t('dates.tomorrow');
  if (n === -1) return t('dates.yesterday');
  if (n > 1 && n < 7) return weekdayShort(d.getDay());
  return fmtDate(d);
}

/** «38m ago», «2h ago», «3d ago» */
export function ago(ts: number) {
  const m = Math.round((Date.now() - ts) / 6e4);
  if (m < 1) return t('dates.justNow');
  if (m < 60) return t('dates.minutesAgo', { n: m });
  const h = Math.round(m / 60);
  if (h < 24) return t('dates.hoursAgo', { n: h });
  const d = Math.round(h / 24);
  if (d < 7) return t('dates.daysAgo', { n: d });
  return fmtDate(new Date(ts));
}
