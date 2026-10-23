/* Хелперы локализации для CRM: динамические ключи (этап, тип активности, отрасль, размер, причина) */
import { t, tEnum } from '@/i18n';
import { INDUSTRIES, SIZES } from './stages';

/** Имя этапа — через общий словарь enums.stage */
export function stageName(id: string, fallback: string): string {
  return tEnum('stage', id, fallback);
}

const ACTIVITY_KEYS: Record<string, string> = {
  call: 'call',
  email: 'email',
  meeting: 'meeting',
  note: 'note',
  task: 'task',
};

/** Тип активности: name/plural/verb */
export function activityName(id: string, fallback: string): string {
  const k = ACTIVITY_KEYS[id];
  return k ? t(`crm.deals.activityTypes.${k}.name` as any) || fallback : fallback;
}
export function activityPlural(id: string, fallback: string): string {
  const k = ACTIVITY_KEYS[id];
  return k ? t(`crm.deals.activityTypes.${k}.plural` as any) || fallback : fallback;
}
export function activityVerb(id: string, fallback: string): string {
  const k = ACTIVITY_KEYS[id];
  return k ? t(`crm.deals.activityTypes.${k}.verb` as any) || fallback : fallback;
}

/** Отрасли/размеры — словарь с индексными ключами i0..iN */
function indexKey(arr: readonly string[], value: string): string | null {
  const idx = arr.indexOf(value as any);
  return idx >= 0 ? `i${idx}` : null;
}

export function industryName(value: string, fallback: string): string {
  const k = indexKey(INDUSTRIES, value);
  return k ? t(`crm.companies.industries.${k}` as any) || fallback : fallback;
}

export function sizeName(value: string, fallback: string): string {
  const k = indexKey(SIZES, value);
  return k ? t(`crm.companies.sizes.${k}` as any) || fallback : fallback;
}

const REASON_KEYS: Record<string, string> = {
  'Price too high': 'price',
  'Chose a competitor': 'competitor',
  'No budget': 'noBudget',
  'No decision': 'noDecision',
  'Bad timing': 'badTiming',
  'Requirements changed': 'requirementsChanged',
};

/** Причина проигрыша — по предопределённому маппингу (LOST_REASONS — английские значения из демо-данных) */
export function lostReasonName(value: string, fallback: string): string {
  const k = REASON_KEYS[value];
  return k ? t(`crm.deals.reasons.${k}` as any) || fallback : fallback;
}

/** Имя пункта группировки для сделок/компаний/контактов (через словари group.*) */
export function dealGroupName(id: string, fallback: string): string {
  return t(`crm.deals.group.${id}` as any) || fallback;
}
export function companyGroupName(id: string, fallback: string): string {
  return t(`crm.companies.group.${id}` as any) || fallback;
}
export function contactGroupName(id: string, fallback: string): string {
  return t(`crm.contacts.group.${id}` as any) || fallback;
}
