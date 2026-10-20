/* zod-схемы API конструктора сущностей: сущности, поля, записи, поиск. */
import { z } from 'zod';
import { CHOICE_COLORS, ENTITY_KEY_RE, FIELD_KEY_RE, FIELD_TYPES, type FieldType } from '../fields';
import { clientId, listQuery, shortText, uuid } from './common';

const choice = z.object({
  value: z.string().trim().min(1).max(64),
  label: z.string().trim().min(1).max(100),
  color: z.enum(CHOICE_COLORS).default('gray'),
});

export const fieldOptions = z
  .object({
    choices: z.array(choice).max(100).optional(),
    refEntity: z.string().regex(ENTITY_KEY_RE).optional(),
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
    maxLength: z.number().int().min(1).max(100_000).optional(),
    currency: z.string().length(3).toUpperCase().optional(),
  })
  .strict();

/** Согласованность типа и параметров: у select — варианты, у ref — целевая сущность */
function checkOptions(type: FieldType | undefined, options: z.infer<typeof fieldOptions> | undefined, ctx: z.RefinementCtx) {
  if (!type || !options) return;
  if (type === 'select' || type === 'multi_select') {
    const list = options.choices ?? [];
    if (!list.length) ctx.addIssue({ code: 'custom', path: ['options', 'choices'], message: 'Add at least one option' });
    const seen = new Set<string>();
    for (const c of list) {
      if (seen.has(c.value)) ctx.addIssue({ code: 'custom', path: ['options', 'choices'], message: `Duplicate option value "${c.value}"` });
      seen.add(c.value);
    }
  }
  if ((type === 'ref' || type === 'refs') && !options.refEntity) ctx.addIssue({ code: 'custom', path: ['options', 'refEntity'], message: 'Choose the entity this field refers to' });
  if (options.min !== undefined && options.max !== undefined && options.min > options.max) ctx.addIssue({ code: 'custom', path: ['options', 'min'], message: 'Minimum is greater than maximum' });
}

export const fieldCreate = z
  .object({
    id: clientId,
    key: z.string().trim().regex(FIELD_KEY_RE, 'Key: lowercase letters, digits and underscore, starts with a letter').optional(),
    name: shortText,
    type: z.enum(FIELD_TYPES),
    required: z.boolean().default(false),
    unique: z.boolean().default(false),
    filterable: z.boolean().default(false),
    options: fieldOptions.default({}),
  })
  .superRefine((v, ctx) => checkOptions(v.type, v.options, ctx));

/** Ключ и тип поля не меняются: от них зависят уже записанные данные */
export const fieldUpdate = z
  .object({
    name: shortText.optional(),
    required: z.boolean().optional(),
    unique: z.boolean().optional(),
    filterable: z.boolean().optional(),
    options: fieldOptions.optional(),
  })
  .strict();

export const fieldsReorder = z.object({ ids: z.array(uuid).min(1).max(500) });

export const entityCreate = z.object({
  id: clientId,
  key: z.string().trim().regex(ENTITY_KEY_RE, 'Key: lowercase letters, digits and underscore, 2–32 chars, starts with a letter').optional(),
  name: shortText,
  icon: z.string().trim().min(1).max(64).default('database'),
  /** Название поля-заголовка: создаётся вместе с сущностью (text, обязательное) */
  titleFieldName: z.string().trim().min(1).max(100).default('Name'),
});

export const entityUpdate = z
  .object({
    name: shortText.optional(),
    icon: z.string().trim().min(1).max(64).optional(),
    /** Ключ существующего поля типа text */
    titleField: z.string().regex(FIELD_KEY_RE).optional(),
    settings: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const entityQuery = z.object({ archived: z.enum(['exclude', 'include', 'only']).default('exclude') });

/** Подтверждение необратимых действий: DELETE …?confirm=<ключ>[&purge=true] */
export const destroyQuery = z.object({
  confirm: z.string().max(64).optional(),
  purge: z.enum(['true', 'false', '1', '0']).optional(),
});

/** filter=ключ:оператор:значение, повторяется */
export const FILTER_OPS = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'contains', 'empty', 'notempty'] as const;
export type FilterOp = (typeof FILTER_OPS)[number];

export const recordQuery = listQuery.extend({
  filter: z
    .union([z.string().max(300), z.array(z.string().max(300)).max(20)])
    .optional()
    .transform(v => (v === undefined ? [] : Array.isArray(v) ? v : [v])),
});

export const recordCreate = z.object({ id: clientId, data: z.record(z.string(), z.unknown()).default({}) });
export const recordUpdate = z.object({ data: z.record(z.string(), z.unknown()) });

export const dataSearchQuery = z.object({ q: z.string().trim().min(1).max(200), limit: z.coerce.number().int().min(1).max(50).default(5) });

/** Значения custom у записи системной сущности (задача, сделка…): при PATCH сливаются с имеющимися, null удаляет ключ */
export const customData = z.record(z.string(), z.unknown());
