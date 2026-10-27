/* Лиды (задача 1175, docs/architecture/leads.md): категории статусов и чистые правила — нормализация телефона и email,
   выбор следующего менеджера «по кругу». Без БД: код работает и на сервере, и в интерфейсе. */

export const LEAD_STATUS_CATEGORIES = ['new', 'in_progress', 'converted', 'rejected'] as const;
export type LeadStatusCategory = (typeof LEAD_STATUS_CATEGORIES)[number];
export const LEAD_STATUS_CATEGORY_LABELS: Record<LeadStatusCategory, string> = { new: 'New', in_progress: 'In progress', converted: 'Converted', rejected: 'Rejected' };

/** Цвета статусов — те же токены, что у проектов */
export const LEAD_STATUS_COLORS = ['gray', 'blue', 'amber', 'violet', 'green', 'red', 'teal', 'rose'] as const;

/** Телефон → E.164. Российские форматы (8 …, 7 …, 10 цифр без кода) приводятся к +7; номер с «+» и 8–15 цифрами берётся как есть;
    остальное с 7+ цифрами получает «+». Короче 7 цифр или мусор — пустая строка (дубли по такому не ищем) */
export function normalizePhone(raw: string | null | undefined): string {
  const s = (raw ?? '').trim();
  if (!s) return '';
  const plus = s.startsWith('+');
  const digits = s.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return '';
  if (plus) return digits.length >= 8 ? `+${digits}` : '';
  if (digits.length === 11 && (digits[0] === '8' || digits[0] === '7')) return `+7${digits.slice(1)}`;
  if (digits.length === 10) return `+7${digits}`;
  return `+${digits}`;
}

/** Ключ для сравнения телефонов в SQL и в коде: последние 10 цифр (или все, если их меньше) — одинаково для +7…, 8… и без кода */
export function phoneKey(raw: string | null | undefined): string {
  const digits = (raw ?? '').replace(/\D/g, '');
  if (digits.length < 7) return '';
  return digits.length > 10 ? digits.slice(-10) : digits;
}

/** Email в нижнем регистре; негодный адрес — пустая строка */
export function normalizeEmail(raw: string | null | undefined): string {
  const s = (raw ?? '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : '';
}

/** Следующий по кругу: участники упорядочены по id, берётся первый после `lastId` (после последнего — снова первый).
    `lastId` вне списка (участника убрали) — начинаем с первого. Пустой список — null */
export function nextRoundRobin(memberIds: readonly string[], lastId: string | null | undefined): string | null {
  if (!memberIds.length) return null;
  const sorted = [...memberIds].sort();
  if (!lastId) return sorted[0]!;
  const next = sorted.find(id => id > lastId);
  return next ?? sorted[0]!;
}

/** Параметры UTM из полей формы: utm_source, utm_medium … (другие поля отбрасываются), значения ≤ 300 символов */
export function pickUtm(fields: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (!/^utm_[a-z0-9_]{1,40}$/i.test(k) || (typeof v !== 'string' && typeof v !== 'number')) continue;
    const s = String(v).trim().slice(0, 300);
    if (s) out[k.toLowerCase()] = s;
  }
  return out;
}
