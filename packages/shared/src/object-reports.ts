/* Сводка о ходе объекта (задача 1277, docs/architecture/construction.md).
   Чистые типы и правила расписания без БД: и сервер (воркер и API), и интерфейс считают одинаково.
   Сводка собирается на получателя: процент выполнения (1272), вехи, объём за неделю (1271), акты и оплаты (1273)
   видят все участники — это цена заказчику; перерасход бюджета (1270) и прогноз прибыли (1275) — только owner/admin.
   Деньги — строками decimal (dec/fmt), без float. */
import type { ObjectCostCategory } from './constants';
import type { ObjectMilestonesSummary, ObjectProgressBase, ObjectProgressMode } from './object-progress';

/** Дни недели расписания сводки: 1 — понедельник … 7 — воскресенье (как ISO) */
export const REPORT_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;
export type ReportWeekday = (typeof REPORT_WEEKDAYS)[number];

/** Время отправки: «HH:MM» в часовом поясе воркспейса */
export const REPORT_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/** «09:00» → минуты от начала суток; неверный формат — null */
export function reportTimeMinutes(time: string): number | null {
  if (!REPORT_TIME_RE.test(time)) return null;
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

/** Настройка сводки в карточке объекта (у объекта одна запись расписания) */
export interface ObjectReportScheduleView {
  objectId: string;
  enabled: boolean;
  /** День недели: 1 — понедельник … 7 — воскресенье */
  weekday: ReportWeekday;
  /** Время отправки «HH:MM» в часовом поясе воркспейса */
  time: string;
  /** Получатели — участники воркспейса; по умолчанию ответственный и прорабы объекта */
  recipientIds: string[];
  /** Последняя отправка; null — ещё не отправляли */
  lastSentAt: string | null;
  /** Часовой пояс воркспейса — по нему считается день и время */
  timezone: string;
}

/** Позиция недели: сколько сделано по позиции сметы за период (подтверждённые смены прораба) */
export interface ObjectReportVolumeRow {
  estimateItemId: string;
  name: string;
  unitCode: string;
  unitSymbol: string;
  qty: string;
}

/** Выполненный объём за неделю: подтверждённые смены объекта */
export interface ObjectReportWeek {
  /** Начало и конец периода (локальные даты воркспейса, включительно) */
  from: string;
  to: string;
  /** Подтверждённых смен в периоде */
  shifts: number;
  /** Часы подтверждённых смен */
  hours: string;
  volumes: ObjectReportVolumeRow[];
}

/** Веха в сводке: срок прошёл, а веха не выполнена — просрочена */
export interface ObjectReportMilestoneRow {
  id: string;
  name: string;
  kind: string;
  dueDate: string | null;
  doneAt: string | null;
  acceptedAt: string | null;
  overdue: boolean;
  /** Сумма вехи (цена заказчику); null — у процента нет стоимости договора */
  value: string | null;
}

export interface ObjectReportMilestones {
  done: number;
  accepted: number;
  overdue: number;
  total: number;
  items: ObjectReportMilestoneRow[];
  summary: ObjectMilestonesSummary;
}

/** Акты и деньги выручки: цена заказчику, её видят все участники */
export interface ObjectReportActs {
  acts: number;
  signed: number;
  /** Выполнено по согласованной смете */
  done: string | null;
  accepted: string;
  invoiced: string;
  paid: string;
}

/** Перерасход бюджета по категории — только owner/admin */
export interface ObjectReportBudgetOverrun {
  category: ObjectCostCategory;
  budget: string;
  fact: string;
  rest: string;
}

/** Прогноз прибыли — только owner/admin */
export interface ObjectReportProfit {
  contractValue: string | null;
  forecastCost: string | null;
  profit: string | null;
  marginPct: string | null;
}

/** Сводка о ходе объекта для одного получателя */
export interface ObjectDigest {
  objectId: string;
  number: string;
  name: string;
  customerName: string | null;
  address: string;
  status: string;
  /** Момент расчёта сводки */
  computedAt: string;
  progress: {
    mode: ObjectProgressMode;
    percent: string | null;
    base: ObjectProgressBase;
  };
  milestones: ObjectReportMilestones;
  week: ObjectReportWeek;
  acts: ObjectReportActs;
  /** Категории с перерасходом; null — нет права видеть себестоимость */
  budgetOverruns: ObjectReportBudgetOverrun[] | null;
  /** Прогноз прибыли; null — нет права видеть себестоимость */
  profit: ObjectReportProfit | null;
}

/** Краткий текст сводки для уведомления: собран из тех же чисел, что и карточка, и не содержит себестоимости */
export function objectDigestSummary(digest: ObjectDigest): string {
  const parts: string[] = [];
  parts.push(digest.progress.percent === null ? 'готовность не определена' : `готовность ${digest.progress.percent}%`);
  const m = digest.milestones;
  parts.push(`вехи: выполнено ${m.done} из ${m.total}, принято ${m.accepted}` + (m.overdue ? `, просрочено ${m.overdue}` : ''));
  if (digest.week.shifts) parts.push(`за неделю: ${digest.week.shifts} смен(ы), ${digest.week.hours} ч`);
  parts.push(`акты: принято ${digest.acts.accepted}, оплачено ${digest.acts.paid}`);
  // прибыль — только тем, кому она видна
  if (digest.profit?.profit != null) parts.push(`прогноз прибыли ${digest.profit.profit}`);
  return parts.join('; ');
}
