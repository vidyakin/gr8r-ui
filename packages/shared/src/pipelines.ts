/* Воронки продаж (задача 1176, docs/architecture/pipelines.md): категории этапов, обязательные поля, шаблоны воронок и чистые правила.
   Без БД: код работает и на сервере, и в интерфейсе. Механизм этапов — как статусы лидов (leads.ts). */

export const DEAL_STAGE_CATEGORIES = ['in_progress', 'won', 'lost'] as const;
export type DealStageCategory = (typeof DEAL_STAGE_CATEGORIES)[number];
export const DEAL_STAGE_CATEGORY_LABELS: Record<DealStageCategory, string> = { in_progress: 'In progress', won: 'Won', lost: 'Lost' };

/** Встроенные обязательные поля этапа; поле конструктора записывается как `custom:<ключ>` */
export const DEAL_REQUIRED_BUILTINS = ['amount', 'closeDate', 'contact', 'source'] as const;
export type DealRequiredBuiltin = (typeof DEAL_REQUIRED_BUILTINS)[number];
export const DEAL_REQUIRED_CUSTOM_PREFIX = 'custom:';

export const isCustomRequired = (f: string) => f.startsWith(DEAL_REQUIRED_CUSTOM_PREFIX);
export const isValidRequiredField = (f: string) => (DEAL_REQUIRED_BUILTINS as readonly string[]).includes(f) || (isCustomRequired(f) && f.length > DEAL_REQUIRED_CUSTOM_PREFIX.length);

/** Старые стадии сделки (enum `deals.stage` до миграции 0056): ключ, категория, вероятность %, цвет, английское название */
export const LEGACY_DEAL_STAGES = [
  { key: 'lead', name: 'Lead', category: 'in_progress', probability: 10, color: 'gray' },
  { key: 'qualified', name: 'Qualified', category: 'in_progress', probability: 25, color: 'blue' },
  { key: 'proposal', name: 'Proposal', category: 'in_progress', probability: 50, color: 'violet' },
  { key: 'negotiation', name: 'Negotiation', category: 'in_progress', probability: 75, color: 'amber' },
  { key: 'won', name: 'Won', category: 'won', probability: 100, color: 'green' },
  { key: 'lost', name: 'Lost', category: 'lost', probability: 0, color: 'red' },
] as const satisfies readonly { key: string; name: string; category: DealStageCategory; probability: number; color: string }[];
export type LegacyDealStage = (typeof LEGACY_DEAL_STAGES)[number]['key'];

export interface StageTemplate {
  name: string;
  category: DealStageCategory;
  probability: number;
  color: string;
  slaDays?: number;
  requiredFields?: string[];
}
export interface PipelineTemplate {
  key: string;
  name: string;
  stages: StageTemplate[];
}

/** Шаблоны при создании воронки: набор этапов с категориями (названия русские; в настройках их можно править) */
export const PIPELINE_TEMPLATES: PipelineTemplate[] = [
  {
    key: 'sale',
    name: 'Продажи',
    stages: [
      { name: 'Лид', category: 'in_progress', probability: 10, color: 'gray' },
      { name: 'Квалифицирован', category: 'in_progress', probability: 25, color: 'blue' },
      { name: 'Предложение', category: 'in_progress', probability: 50, color: 'violet' },
      { name: 'Переговоры', category: 'in_progress', probability: 75, color: 'amber' },
      { name: 'Выиграна', category: 'won', probability: 100, color: 'green' },
      { name: 'Проиграна', category: 'lost', probability: 0, color: 'red' },
    ],
  },
  {
    key: 'service',
    name: 'Сервис',
    stages: [
      { name: 'Заявка', category: 'in_progress', probability: 20, color: 'gray' },
      { name: 'Диагностика', category: 'in_progress', probability: 40, color: 'blue' },
      { name: 'Согласование сметы', category: 'in_progress', probability: 60, color: 'violet' },
      { name: 'В работе', category: 'in_progress', probability: 80, color: 'amber' },
      { name: 'Выполнено', category: 'won', probability: 100, color: 'green' },
      { name: 'Отменено', category: 'lost', probability: 0, color: 'red' },
    ],
  },
  {
    key: 'repeat',
    name: 'Повторные продажи',
    stages: [
      { name: 'Напоминание', category: 'in_progress', probability: 30, color: 'gray' },
      { name: 'Предложение отправлено', category: 'in_progress', probability: 55, color: 'violet' },
      { name: 'Повторный заказ', category: 'won', probability: 100, color: 'green' },
      { name: 'Без повторного заказа', category: 'lost', probability: 0, color: 'red' },
    ],
  },
];

/** Значения сделки после изменения — для проверки обязательных полей этапа */
export interface DealRequiredValues {
  amount: string | number | null | undefined;
  closeDate: string | null | undefined;
  contactCount: number;
  sourceId: string | null | undefined;
  custom: Record<string, unknown> | null | undefined;
}

const emptyValue = (v: unknown) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);

/** Какие из обязательных полей не заполнены. Сумма считается заполненной, если она больше нуля */
export function missingRequiredFields(required: readonly string[], v: DealRequiredValues): string[] {
  const out: string[] = [];
  for (const f of required) {
    let ok: boolean;
    if (f === 'amount') ok = !emptyValue(v.amount) && Number(v.amount) > 0;
    else if (f === 'closeDate') ok = !emptyValue(v.closeDate);
    else if (f === 'contact') ok = v.contactCount > 0;
    else if (f === 'source') ok = !emptyValue(v.sourceId);
    else if (isCustomRequired(f)) ok = !emptyValue(v.custom?.[f.slice(DEAL_REQUIRED_CUSTOM_PREFIX.length)]);
    else ok = true;
    if (!ok) out.push(f);
  }
  return out;
}

const DAY_MS = 86_400_000;

/** Дней на этапе (дробное) */
export const daysOnStage = (enteredAt: Date | string | number, now: Date | number = new Date()) => (new Date(now).getTime() - new Date(enteredAt).getTime()) / DAY_MS;

/** Норматив этапа превышен: задан и времени на этапе больше норматива */
export function isStageOverdue(slaDays: number | null | undefined, enteredAt: Date | string | number, now: Date | number = new Date()): boolean {
  return slaDays != null && slaDays >= 0 && daysOnStage(enteredAt, now) > slaDays;
}

/** Взвешенная сумма: сумма × вероятность этапа (%) */
export const weightedAmount = (amount: number, probability: number) => (amount * probability) / 100;

/** Конверсия между соседними этапами, %: сколько сделок дошли до этапа / сколько дошли до предыдущего (null — не с чего считать) */
export function conversionPct(reachedNext: number, reachedPrev: number): number | null {
  return reachedPrev > 0 ? Math.round((reachedNext / reachedPrev) * 1000) / 10 : null;
}

/** Куда переходит конвертированный лид: второй открытый этап основной воронки («квалифицирован»), иначе первый */
export function qualifiedStageIndex(stages: readonly { category: DealStageCategory }[]): number {
  const open = stages.map((s, i) => [s, i] as const).filter(([s]) => s.category === 'in_progress');
  return (open[1] ?? open[0])?.[1] ?? 0;
}
