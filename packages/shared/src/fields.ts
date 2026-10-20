/* Конструктор сущностей: типы полей и сборка zod-схемы значений из описания полей.
   Одна и та же схема проверяет запись на сервере (перед записью в jsonb) и в формах клиента. */
import { z } from 'zod';

/** Типы полей. file и formula — позже (нужны хранилище файлов и язык выражений) */
export const FIELD_TYPES = ['text', 'long_text', 'number', 'money', 'percent', 'date', 'datetime', 'boolean', 'select', 'multi_select', 'user', 'ref', 'refs', 'url', 'email', 'phone'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: 'Text',
  long_text: 'Long text',
  number: 'Number',
  money: 'Money',
  percent: 'Percent',
  date: 'Date',
  datetime: 'Date & time',
  boolean: 'Checkbox',
  select: 'Select',
  multi_select: 'Multi-select',
  user: 'Member',
  ref: 'Reference',
  refs: 'References',
  url: 'URL',
  email: 'Email',
  phone: 'Phone',
};

/** Цвета вариантов select (токены интерфейса) */
export const CHOICE_COLORS = ['gray', 'indigo', 'blue', 'violet', 'teal', 'green', 'amber', 'orange', 'rose'] as const;
export type ChoiceColor = (typeof CHOICE_COLORS)[number];

export interface FieldChoice {
  /** Хранимое значение */
  value: string;
  label: string;
  color: string;
}

export interface FieldOptions {
  /** select / multi_select */
  choices?: FieldChoice[];
  /** ref / refs: ключ сущности, на записи которой ссылается поле (системная или пользовательская) */
  refEntity?: string;
  /** number / money / percent */
  min?: number;
  max?: number;
  /** text / long_text */
  maxLength?: number;
  /** money */
  currency?: string;
}

/** Поле так, как его видят схема и клиент (подмножество строки таблицы fields) */
export interface FieldDef {
  id?: string;
  key: string;
  name: string;
  type: FieldType;
  required: boolean;
  unique?: boolean;
  filterable?: boolean;
  options: FieldOptions;
  sortOrder?: number;
  archivedAt?: string | null;
}

export const FIELD_KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;
export const ENTITY_KEY_RE = /^[a-z][a-z0-9_]{1,31}$/;

/** Ключ из названия: «Story points» → story_points */
export function keyFromName(name: string, fallback = 'field'): string {
  const k = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^[^a-z]+/, '')
    .slice(0, 32);
  return k || fallback;
}

/** Типы, у которых значение — число (хранится числом в jsonb, индекс и сортировка — через ::numeric) */
export const NUMERIC_TYPES: FieldType[] = ['number', 'money', 'percent'];
export const isNumericType = (t: FieldType) => NUMERIC_TYPES.includes(t);
/** Типы, у которых значение — массив */
export const isMultiType = (t: FieldType) => t === 'multi_select' || t === 'refs';
/** Типы, по которым работает текстовый поиск ?q= */
export const SEARCHABLE_TYPES: FieldType[] = ['text', 'long_text', 'email', 'url', 'phone', 'select'];

/* ---------------- схема значения одного поля ---------------- */

const DECIMAL = /^-?\d+(\.\d+)?$/;
const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected date in YYYY-MM-DD format').refine(s => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s), 'Not a valid date');

function numberSchema(f: Pick<FieldDef, 'type' | 'options'>) {
  const min = f.options.min ?? (f.type === 'percent' ? 0 : undefined);
  const max = f.options.max ?? (f.type === 'percent' ? 100 : undefined);
  let n = z.number().finite();
  if (min !== undefined) n = n.min(min, `Must be at least ${min}`);
  if (max !== undefined) n = n.max(max, `Must be at most ${max}`);
  const input = z.union([z.number(), z.string().regex(DECIMAL, 'Expected a number').transform(Number)], { message: 'Expected a number' });
  return input.pipe(n).transform(v => (f.type === 'money' ? Math.round(v * 100) / 100 : v));
}

function valueSchema(f: Pick<FieldDef, 'type' | 'options'>): z.ZodType {
  const o = f.options;
  switch (f.type) {
    case 'text':
      return z.string().trim().max(o.maxLength ?? 500);
    case 'long_text':
      return z.string().max(o.maxLength ?? 20_000);
    case 'number':
    case 'money':
    case 'percent':
      return numberSchema(f);
    case 'date':
      return isoDay;
    case 'datetime':
      return z.iso.datetime({ offset: true, message: 'Expected an ISO date and time' });
    case 'boolean':
      return z.boolean();
    case 'select': {
      const allowed = new Set((o.choices ?? []).map(c => c.value));
      return z.string().refine(v => allowed.has(v), 'Not one of the allowed options');
    }
    case 'multi_select': {
      const allowed = new Set((o.choices ?? []).map(c => c.value));
      return z
        .array(z.string().refine(v => allowed.has(v), 'Not one of the allowed options'))
        .max(100)
        .transform(a => [...new Set(a)]);
    }
    case 'user':
    case 'ref':
      return z.uuid();
    case 'refs':
      return z
        .array(z.uuid())
        .max(200)
        .transform(a => [...new Set(a)]);
    case 'url':
      return z
        .string()
        .trim()
        .max(2000)
        .refine(v => {
          try {
            const u = new URL(v);
            return u.protocol === 'http:' || u.protocol === 'https:';
          } catch {
            return false;
          }
        }, 'Expected a URL starting with http:// or https://');
    case 'email':
      return z.string().trim().max(254).pipe(z.email('Expected an email address'));
    case 'phone':
      return z
        .string()
        .trim()
        .regex(/^[+()\-.\s\d]{3,32}$/, 'Expected a phone number')
        .refine(v => (v.match(/\d/g) ?? []).length >= 3, 'Expected a phone number');
  }
}

/** Пустое значение: null, undefined, '' и пустой массив означают «не заполнено» */
export const isBlank = (v: unknown) => v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);

export type RecordMode = 'create' | 'patch';

/**
 * Схема данных записи из описания полей.
 *  - create: обязательные поля должны быть заполнены; пустые значения не попадают в результат;
 *  - patch: проверяются только присланные ключи; null — «очистить» (для обязательного поля — ошибка).
 * Лишние ключи (в том числе удалённых полей) отклоняются.
 */
export function buildRecordSchema(fieldDefs: Pick<FieldDef, 'key' | 'name' | 'type' | 'required' | 'options'>[], mode: RecordMode = 'create') {
  const shape: Record<string, z.ZodType> = {};
  for (const f of fieldDefs) {
    const inner = valueSchema(f);
    const norm = (v: unknown) => ((isBlank(v) || (typeof v === 'string' && v.trim() === '')) && v !== undefined ? null : v);
    if (mode === 'create') {
      const filled = f.required ? inner.nullable().refine(v => v !== null, `${f.name} is required`) : inner.nullable();
      shape[f.key] = z.preprocess(v => (v === undefined ? null : norm(v)), filled);
    } else {
      const filled = f.required ? inner.nullable().refine(v => v !== null, `${f.name} is required`) : inner.nullable();
      shape[f.key] = z.preprocess(norm, filled).optional();
    }
  }
  const obj = z.object(shape).strict();
  // create: пустые значения отбрасываются, чтобы в jsonb лежали только заполненные поля
  return mode === 'create' ? obj.transform(o => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined))) : obj;
}

export type RecordData = Record<string, unknown>;

/** Проверка без исключений: данные или список ошибок по ключам полей (для форм клиента) */
export function validateRecord(fieldDefs: Parameters<typeof buildRecordSchema>[0], input: unknown, mode: RecordMode = 'create'): { ok: true; data: RecordData } | { ok: false; errors: Record<string, string> } {
  const r = buildRecordSchema(fieldDefs, mode).safeParse(input);
  if (r.success) return { ok: true, data: r.data as RecordData };
  const errors: Record<string, string> = {};
  for (const i of r.error.issues) {
    const key = i.code === 'unrecognized_keys' ? (i.keys[0] ?? '') : String(i.path[0] ?? '');
    errors[key] ??= i.code === 'unrecognized_keys' ? `Unknown field "${key}"` : i.message;
  }
  return { ok: false, errors };
}

/** Строка для ячейки и поиска: значение поля → текст (select — подпись варианта; ссылки показывает интерфейс сам) */
export function plainValue(f: Pick<FieldDef, 'type' | 'options'>, v: unknown): string {
  if (isBlank(v)) return '';
  const label = (x: unknown) => f.options.choices?.find(c => c.value === x)?.label ?? String(x);
  if (Array.isArray(v)) return v.map(label).join(', ');
  if (f.type === 'select') return label(v);
  if (f.type === 'boolean') return v ? 'Yes' : 'No';
  return String(v);
}
