/* Общие куски схем параметров. Подсказки для формы — `.meta()` в конце цепочки (после default/optional). */
import { z } from 'zod';
import type { UiHint } from '../types';

type Meta = UiHint & { title?: string; description?: string };

export const entityParam = (title = 'Entity', def = 'task') => z.string().min(1).max(64).default(def).meta({ title, ui: 'entity' } satisfies Meta);

export const recordIdParam = (title = 'Record ID') =>
  z.string().max(200).default('{{trigger.recordId}}').meta({ title, description: 'ID of the record. Supports {{…}} substitutions.' } satisfies Meta);

/** Компактный вывод триггера в журнал */
export const triggerOutput = (ctx: { trigger: { entity?: string; recordId?: string; changes?: Record<string, unknown> } }) => ({
  entity: ctx.trigger.entity ?? null,
  recordId: ctx.trigger.recordId ?? null,
  ...(ctx.trigger.changes ? { changes: ctx.trigger.changes } : {}),
});
