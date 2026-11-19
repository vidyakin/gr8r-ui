/* Обращения клиентов (docs/architecture/cases.md): статусы, приоритеты, SLA и чистые правила без БД —
   код работает на сервере и в интерфейсе. Часы календарные: рабочего календаря пока нет. */

export const CASE_STATUSES = ['new', 'in_progress', 'waiting', 'resolved', 'closed'] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];
export const CASE_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type CasePriority = (typeof CASE_PRIORITIES)[number];
export const CASE_CHANNELS = ['email', 'manual', 'web_form'] as const;
export type CaseChannel = (typeof CASE_CHANNELS)[number];

export const CASE_STATUS_LABELS: Record<CaseStatus, string> = { new: 'New', in_progress: 'In progress', waiting: 'Waiting for customer', resolved: 'Resolved', closed: 'Closed' };
export const CASE_PRIORITY_LABELS: Record<CasePriority, string> = { low: 'Low', normal: 'Normal', high: 'High', urgent: 'Urgent' };
export const CASE_CHANNEL_LABELS: Record<CaseChannel, string> = { email: 'Email', manual: 'Manual', web_form: 'Web form' };

/** Решённое обращение открывается снова ответом клиента в течение этого срока; позже — новое обращение */
export const CASE_REOPEN_DAYS = 7;
/** Доля срока, при которой метка SLA становится жёлтой (осталось меньше 20 %) */
export const CASE_SLA_WARN_RATIO = 0.2;

export interface CaseSlaRule {
  firstResponseHours: number;
  resolveHours: number;
}
export type CaseSlaRules = Record<CasePriority, CaseSlaRule>;

/** Правила по умолчанию (часы на первый ответ / на решение) */
export const DEFAULT_CASE_SLA: CaseSlaRules = {
  urgent: { firstResponseHours: 1, resolveHours: 8 },
  high: { firstResponseHours: 4, resolveHours: 24 },
  normal: { firstResponseHours: 8, resolveHours: 72 },
  low: { firstResponseHours: 24, resolveHours: 168 },
};

/** Открытое обращение: ещё не решено и не закрыто */
export const isCaseOpen = (status: CaseStatus) => status !== 'resolved' && status !== 'closed';

const HOUR = 3_600_000;

/** Сроки от времени создания по правилу приоритета */
export function caseDueDates(createdAt: Date, priority: CasePriority, rules: CaseSlaRules = DEFAULT_CASE_SLA): { firstResponseDueAt: Date; resolveDueAt: Date } {
  const r = rules[priority] ?? DEFAULT_CASE_SLA[priority];
  return { firstResponseDueAt: new Date(createdAt.getTime() + r.firstResponseHours * HOUR), resolveDueAt: new Date(createdAt.getTime() + r.resolveHours * HOUR) };
}

export type SlaLevel = 'none' | 'ok' | 'warn' | 'breached';

export interface SlaCaseLike {
  status: CaseStatus;
  createdAt: Date | string;
  firstResponseDueAt: Date | string | null;
  resolveDueAt: Date | string | null;
  firstRespondedAt: Date | string | null;
  resolvedAt: Date | string | null;
}

const ms = (v: Date | string) => (v instanceof Date ? v : new Date(v)).getTime();

function level(createdAt: number, due: number, now: number): SlaLevel {
  if (now > due) return 'breached';
  const total = due - createdAt;
  return total > 0 && (due - now) / total < CASE_SLA_WARN_RATIO ? 'warn' : 'ok';
}

/** Состояние SLA открытого обращения: срок первого ответа (пока ответа нет), иначе срок решения. Решённое и закрытое — `none` */
export function caseSlaState(c: SlaCaseLike, now: Date = new Date()): { level: SlaLevel; kind: 'first_response' | 'resolve' | null; dueAt: Date | null } {
  if (!isCaseOpen(c.status)) return { level: 'none', kind: null, dueAt: null };
  const created = ms(c.createdAt);
  const candidates: { kind: 'first_response' | 'resolve'; due: number }[] = [];
  if (!c.firstRespondedAt && c.firstResponseDueAt) candidates.push({ kind: 'first_response', due: ms(c.firstResponseDueAt) });
  if (!c.resolvedAt && c.resolveDueAt) candidates.push({ kind: 'resolve', due: ms(c.resolveDueAt) });
  if (!candidates.length) return { level: 'none', kind: null, dueAt: null };
  // самый срочный срок: сначала нарушенные, иначе ближайший
  const rank = { breached: 0, warn: 1, ok: 2, none: 3 } as const;
  const scored = candidates.map(x => ({ ...x, level: level(created, x.due, now.getTime()) })).sort((a, b) => rank[a.level] - rank[b.level] || a.due - b.due);
  const top = scored[0]!;
  return { level: top.level, kind: top.kind, dueAt: new Date(top.due) };
}

/** Метка с номером в теме письма: «[ОБ-2026-00001]» */
export const CASE_NUMBER_RE = /ОБ-\d{4}-\d{5}/;
export const caseNumberTag = (number: string) => `[${number}]`;
/** Номер обращения из темы письма (ответ клиента сохраняет метку) */
export function caseNumberFromSubject(subject: string): string | null {
  const m = /\[(ОБ-\d{4}-\d{5})\]/.exec(subject);
  return m ? m[1]! : null;
}
/** Тема исходящего письма с меткой номера (без дублей) */
export function withCaseNumber(subject: string, number: string): string {
  return subject.includes(caseNumberTag(number)) ? subject : `${subject.trim()} ${caseNumberTag(number)}`.trim();
}

export const formatCaseNumber = (year: number, seq: number) => `ОБ-${year}-${String(seq).padStart(5, '0')}`;

/** Допустим ли переход статуса вручную: из closed — никуда; в closed можно из любого */
export function canChangeCaseStatus(from: CaseStatus, to: CaseStatus): boolean {
  return from !== 'closed' || to === 'closed';
}
