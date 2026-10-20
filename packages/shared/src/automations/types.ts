/* Модель узла автоматизации. Узел = один файл в `nodes/`: описание (тип, категория, выходы), zod-схема параметров
   (из неё интерфейс строит форму) и исполнитель. Исполнитель не знает про БД: он работает через порты `NodeRuntime`,
   которые реализует воркер (в контексте арендатора под RLS). Так узел можно целиком проверить в тесте с подставными портами. */
import type { z } from 'zod';
import type { FlowEvent } from './events';

export const NODE_CATEGORIES = ['trigger', 'condition', 'action', 'flow'] as const;
export type NodeCategory = (typeof NODE_CATEGORIES)[number];

export const NODE_CATEGORY_LABELS: Record<NodeCategory, string> = { trigger: 'Triggers', condition: 'Conditions', action: 'Actions', flow: 'Flow control' };

export interface OutputDef {
  /** Идентификатор выхода (sourceHandle связи): 'out', 'true', 'false', 'case_0' … */
  id: string;
  label: string;
}

/** Контекст подстановок `{{…}}`: что доступно шаблонам параметров */
export interface FlowContext {
  trigger: TriggerContext;
  /** Выходы выполненных узлов: `{{steps.<id узла>.field}}` */
  steps: Record<string, Record<string, unknown>>;
  flow: { id: string; name: string };
  run: { id: string };
  now: string;
}

export interface TriggerContext {
  /** event — событие журнала, schedule — расписание, manual — ручной запуск */
  kind: 'event' | 'schedule' | 'manual';
  event?: { id: string; type: string };
  entity?: string;
  recordId?: string;
  /** Запись на момент запуска (системные поля + `custom`; у пользовательской сущности значения лежат на верхнем уровне) */
  record?: Record<string, unknown>;
  /** Изменённые поля события: `{поле: {from, to}}` */
  changes?: Record<string, { from?: unknown; to?: unknown }>;
  /** Проект задачи — для «владельца проекта» (`{{trigger.project.leadId}}`) */
  project?: Record<string, unknown>;
  actorId?: string | null;
  scheduledFor?: string;
  firedAt: string;
}

export interface HttpRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}
export interface HttpResult {
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  /** Тело ответа текстом (обрезано) */
  body: string;
  /** Тело, разобранное как JSON (если ответ JSON) */
  json?: unknown;
}

/** Порты, через которые узел действует во внешнем мире. Реализация — воркер (apps/worker/src/flows/runtime.ts) */
export interface NodeRuntime {
  workspaceId: string;
  nodeId: string;
  ctx: FlowContext;
  /** Установить значение поля записи (встроенного или пользовательского) */
  updateField(a: { entity: string; recordId: string; field: string; value: unknown }): Promise<{ changed: boolean; before: unknown; after: unknown }>;
  createTask(a: { projectId: string; title: string; description?: string; assigneeId?: string | null; priority?: number | null; status?: string; dueDate?: string | null }): Promise<{ id: string; key: string }>;
  addComment(a: { entity: string; recordId: string; body: string }): Promise<{ id: string }>;
  notify(a: { memberId: string; text: string; snippet?: string; taskId?: string | null; projectId?: string | null }): Promise<{ id: string }>;
  http(req: HttpRequest): Promise<HttpResult>;
}

export interface NodeResult {
  /** Что узел «вернул»: показывается в журнале и доступно как `{{steps.<id>.…}}` */
  output?: Record<string, unknown>;
  /** Выход, по которому идти дальше (по умолчанию 'out') */
  next?: string;
  /** Приостановить запуск на столько миллисекунд (узел «Задержка»); дальше идёт по выходу 'out' */
  delayMs?: number;
}

/** Временная ошибка (сеть, 5xx, таймаут): шаг повторяется с паузой. Любая другая ошибка завершает запуск с ошибкой */
export class TransientError extends Error {
  override name = 'TransientError';
}

export interface NodeDef<P extends z.ZodType = z.ZodType> {
  /** Уникальный идентификатор, хранится в графе: 'action.update_field' */
  type: string;
  category: NodeCategory;
  label: string;
  description: string;
  /** Имя иконки lucide-react (kebab-case) */
  icon: string;
  /** Схема параметров. Подсказки интерфейса — в `.meta({ ui, … })`: см. `UiHint` */
  params: P;
  /** Выходы узла; зависят от параметров (например, ветвление по значениям). По умолчанию один выход 'out' */
  outputs?: OutputDef[] | ((params: z.output<P>) => OutputDef[]);
  /** Только у триггеров по событиям: подходит ли событие. Расписание и ручной запуск `match` не имеют */
  match?: (params: z.output<P>, ev: FlowEvent, helpers: { entity: string; action: string; changes: Record<string, { from?: unknown; to?: unknown }> }) => boolean;
  execute: (params: z.output<P>, rt: NodeRuntime) => Promise<NodeResult>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyNodeDef = NodeDef<any>;

export const defineNode = <P extends z.ZodType>(def: NodeDef<P>): AnyNodeDef => def as AnyNodeDef;

/** Подсказки для формы параметров (в `.meta()` схемы). Без подсказки строка — однострочное поле с подстановками */
export interface UiHint {
  /** entity — выбор сущности; field — поле сущности из параметра `dependsOn`; member — участник; project — проект;
      textarea — многострочный текст; value — значение поля выбранной сущности (`dependsOn` — параметр с полем);
      cron — расписание; url — адрес */
  ui?: 'entity' | 'field' | 'member' | 'project' | 'textarea' | 'value' | 'cron' | 'url';
  /** Имя соседнего параметра, от которого зависит выбор (сущность для поля, поле для значения) */
  dependsOn?: string;
  /** Для ui: 'field' — показывать только поля, которые можно менять */
  writableOnly?: boolean;
  placeholder?: string;
}
