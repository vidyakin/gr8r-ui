/* zod-схемы API автоматизаций: flow, публикация, ручной запуск, журнал запусков. */
import { z } from 'zod';
import { flowGraphSchema } from '../automations/graph';
import { listQuery, queryBool, shortText, uuid } from './common';

export const FLOW_RUN_STATUSES = ['queued', 'running', 'waiting', 'succeeded', 'failed', 'skipped'] as const;
export type FlowRunStatus = (typeof FLOW_RUN_STATUSES)[number];
export const FLOW_STEP_STATUSES = ['running', 'waiting', 'retrying', 'succeeded', 'failed'] as const;
export type FlowStepStatus = (typeof FLOW_STEP_STATUSES)[number];

export const flowCreate = z.object({
  name: shortText,
  description: z.string().trim().max(2000).default(''),
  graph: flowGraphSchema.default({ nodes: [], edges: [] }),
});

export const flowUpdate = z.object({
  name: shortText.optional(),
  description: z.string().trim().max(2000).optional(),
  /** Черновик. Структура проверяется всегда, полная проверка (триггер, висящие узлы) — при публикации */
  graph: flowGraphSchema.optional(),
  enabled: z.boolean().optional(),
});

export const flowQuery = listQuery.pick({ limit: true, offset: true, q: true });

export const flowPublish = z.object({
  /** Включить flow сразу после публикации */
  enable: z.boolean().optional(),
});

export const flowRunStart = z.object({
  /** Сущность и запись, на которых запускается flow (необязательно) */
  entity: z.string().min(1).max(64).optional(),
  recordId: uuid.optional(),
});

export const flowRunQuery = listQuery.pick({ limit: true, offset: true }).extend({
  status: z.enum(FLOW_RUN_STATUSES).optional(),
  flowId: uuid.optional(),
  /** Только с ошибками */
  failed: queryBool.optional(),
});
