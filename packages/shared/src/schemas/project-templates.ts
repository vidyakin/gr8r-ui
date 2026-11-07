/* zod-схемы шаблонов проектов (docs/architecture/task-modules.md, «Шаблоны проектов»). */
import { z } from 'zod';
import { PROJECT_COLORS } from '../constants';
import type { TemplateSubtask } from '../project-templates';
import { isoDate, shortText, uuid } from './common';

const day = z.number().int().min(1).max(3650);

export const templateSubtaskSchema: z.ZodType<TemplateSubtask> = z.lazy(() =>
  z.object({
    title: z.string().max(500),
    note: z.string().max(10_000).optional(),
    dueDay: day.nullish(),
    positionId: uuid.nullish(),
    planHours: z.number().nonnegative().nullish(),
    subtasks: z.array(templateSubtaskSchema),
  }),
);

/** Сохранить проект как шаблон */
export const projectTemplateFromProject = z.object({
  projectId: uuid,
  name: shortText,
  description: z.string().max(10_000).optional(),
});

/** Переименование, описание, флаг «отключён» (скрыт из выбора при создании проекта) */
export const projectTemplateUpdate = z.object({
  name: shortText.optional(),
  description: z.string().max(10_000).optional(),
  disabled: z.boolean().optional(),
});

/** Создать проект из шаблона с датой старта */
export const projectFromTemplate = z.object({
  /** Ключ проекта; не указан — берётся из названия */
  key: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][A-Z0-9]{1,9}$/, 'Key: 2-10 chars, letters and digits, starts with a letter')
    .optional(),
  name: shortText,
  startDate: isoDate,
  description: z.string().max(10_000).optional(),
  icon: z.string().max(64).optional(),
  color: z.enum(PROJECT_COLORS).optional(),
  teamId: uuid.nullish(),
  leadId: uuid.nullish(),
});

export const projectTemplateQuery = z.object({
  /** По умолчанию — все; для выбора при создании проекта клиент просит enabled=true */
  enabled: z.enum(['true', 'false']).optional(),
});

export type ProjectTemplateFromProject = z.infer<typeof projectTemplateFromProject>;
export type ProjectTemplateUpdate = z.infer<typeof projectTemplateUpdate>;
export type ProjectFromTemplate = z.infer<typeof projectFromTemplate>;
