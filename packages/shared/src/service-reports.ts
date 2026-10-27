/* Контроль услуг (задача 1097, docs/architecture/service-reports.md): чистые правила без БД — просрочка заказ-наряда
   и раскладка плановых часов назначения по дням. Серверный отчёт (packages/db/src/service-reports.ts) собирает данные
   и вызывает эти функции, тесты проверяют их через API. */
import { dec, fmt, type Dec } from './decimal';
import { addDays, zonedInstant, zonedParts } from './planning';

/** Категории состояния, в которых заказ-наряд не считается просроченным по сроку документа */
export const OVERDUE_EXEMPT_CATEGORIES = ['done', 'delivered', 'cancelled'] as const;

export type OverdueReason = 'due' | 'assignment';

export interface OverdueAssignment {
  /** Задача назначения в выполненном статусе */
  closed: boolean;
  /** Локальная дата конца назначения: end_at, иначе срок задачи; null — срока нет */
  endDate: string | null;
}

export interface OverdueResult {
  overdue: boolean;
  reasons: OverdueReason[];
  /** Наибольшая просрочка в днях по найденным причинам */
  days: number;
}

const diff = (a: string, b: string): number => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** Просрочка: срок документа прошёл, а категория не done|delivered|cancelled, либо есть незакрытое назначение,
    конец которого раньше «сегодня» (у отменённого заказ-наряда назначения не проверяются) */
export function orderOverdue(o: { category: string | null; dueDate: string | null; assignments: OverdueAssignment[]; today: string }): OverdueResult {
  const reasons: OverdueReason[] = [];
  let days = 0;
  const cancelled = o.category === 'cancelled';
  const exempt = !!o.category && (OVERDUE_EXEMPT_CATEGORIES as readonly string[]).includes(o.category);
  if (!exempt && o.dueDate && o.dueDate < o.today) {
    reasons.push('due');
    days = Math.max(days, diff(o.dueDate, o.today));
  }
  if (!cancelled) {
    for (const a of o.assignments) {
      if (a.closed || !a.endDate || a.endDate >= o.today) continue;
      if (!reasons.includes('assignment')) reasons.push('assignment');
      days = Math.max(days, diff(a.endDate, o.today));
    }
  }
  return { overdue: reasons.length > 0, reasons, days };
}

export interface PlanDay {
  /** Локальная дата; null — «без даты» */
  date: string | null;
  hours: string;
}

/** Раскладка плановых часов назначения по дням в поясе воркспейса.
    Интервал start..end — пропорционально длительности в каждом локальном дне (в том числе через полночь);
    без интервала — в день срока задачи, иначе срока документа; без дат — одна строка «без даты».
    Сумма по дням равна плановым часам: остаток округления получает последний день */
export function spreadPlan(a: { hours: string; startAt: Date | null; endAt: Date | null; taskDue: string | null; docDue: string | null; timeZone: string }): PlanDay[] {
  const total = dec(a.hours);
  if (a.startAt && a.endAt && a.endAt > a.startAt) {
    const first = zonedParts(a.startAt, a.timeZone).date;
    // конец ровно в полночь принадлежит предыдущему дню
    const last = zonedParts(new Date(a.endAt.getTime() - 1), a.timeZone).date;
    const totalMs = a.endAt.getTime() - a.startAt.getTime();
    const out: PlanDay[] = [];
    let given: Dec = 0n;
    for (let d = first; d <= last; d = addDays(d, 1)) {
      const from = Math.max(a.startAt.getTime(), zonedInstant(d, 0, 0, a.timeZone).getTime());
      const to = Math.min(a.endAt.getTime(), zonedInstant(addDays(d, 1), 0, 0, a.timeZone).getTime());
      const seg = Math.max(to - from, 0);
      const h = d === last ? total - given : (total * BigInt(seg)) / BigInt(totalMs);
      given += h;
      out.push({ date: d, hours: fmt(h, 3) });
    }
    return out;
  }
  return [{ date: a.taskDue ?? a.docDue ?? null, hours: fmt(total, 3) }];
}
