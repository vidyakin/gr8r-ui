/* Должности сотрудников и виды номенклатуры (задача 1172, docs/architecture/positions.md): функции должностей,
   разделы меню и чистые правила «видимые разделы участника», «участники с функцией», «виды номенклатуры специалиста». */
import type { Role } from './constants';

/** Функции должности: по ним фильтруются списки выбора сотрудников */
export const POSITION_FUNCTIONS = ['appointments_specialist', 'courier', 'production_worker', 'work_order_executor', 'sales_manager', 'driver', 'support_agent'] as const;
export type PositionFunction = (typeof POSITION_FUNCTIONS)[number];

/** Разделы меню, доступные должности (группы навигации). Всегда видны: главная, входящие, уведомления, поиск, участники, настройки */
export const POSITION_SECTIONS = ['crm', 'trade', 'stock', 'services', 'deliveries', 'production', 'finance', 'projects', 'catalog', 'automations', 'transport'] as const;
export type PositionSection = (typeof POSITION_SECTIONS)[number];

/** Корневые пути API, которые принадлежат только одному разделу (их не вызывают экраны других разделов). Сервер закрывает их
    участнику, у которого раздел скрыт должностями (apps/api, requireSection). Общие пути (документы, товары, контрагенты, сделки
    и оплаты — их читают карточки и документы других разделов) не ограничиваются: это видимость меню, а не права.
    docs/architecture/positions.md, «Проверка на сервере». */
export const SECTION_OF_API_PATH: ReadonlyMap<string, PositionSection> = new Map<string, PositionSection>([
  ['/flows', 'automations'],
  ['/flow-runs', 'automations'],
  ['/payroll', 'finance'],
  ['/investments', 'finance'],
  ['/payment-calendar', 'finance'],
  ['/cash-flow-items', 'finance'],
  ['/cash-registers', 'finance'],
  ['/bank-import', 'finance'],
  ['/opening-balances', 'finance'],
  ['/deal-funnel', 'crm'],
  ['/ad-campaigns', 'crm'],
  ['/ad-expenses', 'crm'],
  ['/ad-report', 'crm'],
  ['/sales-plan', 'crm'],
  ['/cases', 'crm'],
  ['/case-forms', 'crm'],
  ['/case-sla-rules', 'crm'],
  ['/ai-chats', 'crm'],
  ['/crm', 'crm'],
  ['/production-plans', 'production'],
  ['/bom-lines', 'production'],
  ['/whiteboards', 'projects'],
  ['/chats', 'projects'],
]);

/** Тип вида номенклатуры совпадает с видом товара каталога */
export const PRODUCT_KIND_TYPES = ['goods', 'service', 'work'] as const;
export type ProductKindType = (typeof PRODUCT_KIND_TYPES)[number];

/** Область видимости записей CRM для должности: все / подразделение и дочерние / только свои */
export const RECORD_SCOPES = ['all', 'department', 'own'] as const;
export type RecordScope = (typeof RECORD_SCOPES)[number];

/** Ключи чувствительных системных полей, которые можно скрывать на уровне должности */
export const SENSITIVE_FIELD_KEYS = [
  'deal.amount',
  'deal.probability',
  'contact.phone',
  'contact.email',
  'lead.phone',
  'lead.email',
  'company.requisites',
  'company.bankAccounts',
  'document.total',
] as const;
export type SensitiveFieldKey = (typeof SENSITIVE_FIELD_KEYS)[number];

export interface PositionDef {
  id: string;
  functions: readonly string[];
  /** Пусто — все разделы */
  sections: readonly string[];
  productKindIds?: readonly string[];
  recordScope?: RecordScope;
  hiddenFields?: readonly string[];
}

export interface MemberPositionLink {
  memberId: string;
  positionId: string;
}

const isAdminRole = (role: Role | string | undefined) => role === 'owner' || role === 'admin';

/** Позиции участника по связям */
export function positionsOfMember(memberId: string, positions: readonly PositionDef[], links: readonly MemberPositionLink[]): PositionDef[] {
  const ids = new Set(links.filter(l => l.memberId === memberId).map(l => l.positionId));
  return positions.filter(p => ids.has(p.id));
}

/** Видимые разделы меню: admin/owner и участник без должностей видят всё; иначе — объединение разделов его должностей
    (должность с пустым набором разделов открывает все). Меню скрывает разделы, сервер закрывает пути SECTION_OF_API_PATH. */
export function visibleSections(role: Role | string | undefined, memberPositions: readonly Pick<PositionDef, 'sections'>[]): PositionSection[] {
  const all = [...POSITION_SECTIONS];
  if (isAdminRole(role) || !memberPositions.length) return all;
  if (memberPositions.some(p => p.sections.length === 0)) return all;
  const set = new Set<string>(memberPositions.flatMap(p => [...p.sections]));
  return all.filter(s => set.has(s));
}

/** Участники с функцией. Если во всём воркспейсе нет ни одной должности с этой функцией — все участники (как до появления должностей) */
export function membersWithFunction<M extends { id: string }>(members: readonly M[], positions: readonly PositionDef[], links: readonly MemberPositionLink[], fn: PositionFunction): M[] {
  const withFn = new Set(positions.filter(p => p.functions.includes(fn)).map(p => p.id));
  if (!withFn.size) return [...members];
  const ids = new Set(links.filter(l => withFn.has(l.positionId)).map(l => l.memberId));
  return members.filter(m => ids.has(m.id));
}

/** Виды номенклатуры, которые оказывает специалист записи: объединение видов его должностей с функцией
    appointments_specialist. null — ограничения нет (нет такой должности или у должностей не заданы виды): доступны все услуги. */
export function specialistProductKindIds(memberId: string, positions: readonly PositionDef[], links: readonly MemberPositionLink[]): string[] | null {
  const mine = positionsOfMember(memberId, positions, links).filter(p => p.functions.includes('appointments_specialist'));
  const ids = new Set(mine.flatMap(p => [...(p.productKindIds ?? [])]));
  return ids.size ? [...ids] : null;
}

/** Подходит ли товар специалисту: без ограничения — любой; иначе его вид должен входить в список (товар без вида не подходит) */
export function productFitsSpecialist(productKindId: string | null | undefined, allowed: readonly string[] | null): boolean {
  return allowed === null || (!!productKindId && allowed.includes(productKindId));
}

/** Самая широкая область видимости среди нескольких должностей: all > department > own. Пустой список — all */
export function widestRecordScope(scopes: readonly (RecordScope | string | undefined)[]): RecordScope {
  if (!scopes.length) return 'all';
  if (scopes.includes('all')) return 'all';
  if (scopes.includes('department')) return 'department';
  if (scopes.includes('own')) return 'own';
  return 'all';
}

/** Итоговая область видимости записей участника: owner/admin и участник без должностей видят всё */
export function effectiveRecordScope(role: Role | string | undefined, memberPositions: readonly Pick<PositionDef, 'recordScope'>[]): RecordScope {
  if (isAdminRole(role) || !memberPositions.length) return 'all';
  return widestRecordScope(memberPositions.map(p => p.recordScope ?? 'all'));
}

/** Итоговый список скрытых полей участника: owner/admin и участник без должностей видят всё; при нескольких должностях — пересечение (самый широкий доступ) */
export function effectiveHiddenFields(role: Role | string | undefined, memberPositions: readonly Pick<PositionDef, 'hiddenFields'>[]): string[] {
  if (isAdminRole(role) || !memberPositions.length) return [];
  const sets = memberPositions.map(p => new Set(p.hiddenFields ?? []));
  const first = sets[0];
  if (!first || !first.size) return [];
  return [...first].filter(k => sets.every(s => s.has(k)));
}
