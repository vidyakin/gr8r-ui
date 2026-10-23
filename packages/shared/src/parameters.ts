/* Параметры спецификации и варианты товара.
   У спецификации (`manufactured_items.params`) свой список параметров — те же описания полей, что у характеристик
   категории (FieldDef), но у каждого есть флажок «разрез склада» (`stockDimension`): комбинация только таких параметров
   даёт отдельный вариант товара (строка products с parent_product_id и variant_values). К параметрам спецификации
   добавляются характеристики категории её товара (с унаследованными) — значения проверяет buildRecordSchema.

   Вариант — обычная складская позиция: склад, резервы, цены и документы работают по products.id и не меняются.
   Создаётся лениво при первом заказе комбинации или заранее генератором «все комбинации». */
import type { FieldDef, FieldOptions, FieldType } from './fields';
import { isBlank } from './fields';
import { PARAM_TYPES, VARIANT_MAX_COMBINATIONS } from './constants';

/** Описание параметра спецификации: поле значения + признак «разрез склада» */
export interface SpecParamDef {
  key: string;
  name: string;
  type: FieldType;
  required?: boolean;
  options?: FieldOptions;
  /** Разрез склада: по этому параметру товар имеет варианты (цвет, размер; замер ширины — нет) */
  stockDimension?: boolean;
}

/** Значения параметров строки: ключ — параметр, значение — число / строка варианта / истина */
export type ParamValuesRecord = Record<string, unknown>;

export const isParamType = (t: string): boolean => (PARAM_TYPES as readonly string[]).includes(t);

/** Ключ параметра приводится к ключу поля (строчные латинские буквы, цифры, «_») — по нему же строятся формулы */
export const PARAM_KEY_RE = /^[a-z][a-z0-9_]{0,39}$/;

/** Ключ из названия параметра: «Ширина, мм» → width_mm */
export function paramKeyFromName(name: string, fallback = 'param'): string {
  const k = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^[^a-z]+/, '')
    .slice(0, 32);
  return k || fallback;
}

/** Параметр как описание поля — значения проверяет buildRecordSchema, интерфейс рисует теми же FieldInput */
export const paramField = (p: SpecParamDef): FieldDef => ({ key: p.key, name: p.name, type: p.type, required: p.required ?? false, options: p.options ?? {} });

/** Все параметры как описания полей */
export const paramFields = (params: SpecParamDef[]): FieldDef[] => params.map(paramField);

/** Ключи параметров, доступные в формулах количества и условия */
export const paramKeys = (params: SpecParamDef[]): string[] => params.map(p => p.key);

/** Ключи параметров, дающих вариант товара (с флажком «разрез склада») */
export const dimensionKeys = (params: SpecParamDef[]): string[] => params.filter(p => p.stockDimension).map(p => p.key);

/** Ключ характеристики категории пересекается с ключом параметра спецификации — такое сочетание запрещено (422) */
export const paramKeyClash = (params: SpecParamDef[], attrs: FieldDef[]): string | null => params.map(p => p.key).find(k => attrs.some(a => a.key === k)) ?? null;

/** Значения параметров, из которых получается вариант товара: только параметры с флажком «разрез склада».
    Пусто — замеры, варианта нет */
export function variantValuesOf(params: SpecParamDef[], values: ParamValuesRecord | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of params) {
    if (!p.stockDimension) continue;
    const v = values?.[p.key];
    if (isBlank(v)) continue;
    out[p.key] = typeof v === 'boolean' ? String(v) : String(v);
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

/** Подпись значения параметра: вариант select — его название, истина — «Yes» */
export function paramValueLabel(p: SpecParamDef, value: unknown): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return p.options?.choices?.find(c => c.value === value)?.label ?? String(value ?? '');
}

/** Название варианта: «Товар (Красный, L)» — родитель и значения по порядку описания */
export function variantName(parentName: string, params: SpecParamDef[], values: Record<string, string>): string {
  const parts = params.filter(p => p.stockDimension && values[p.key] !== undefined).map(p => paramValueLabel(p, values[p.key]));
  return parts.length ? `${parentName} (${parts.join(', ')})` : parentName;
}

/** Артикул варианта: артикул родителя + суффикс по значениям (у родителя без артикула — пусто) */
export function variantSku(parentSku: string, values: Record<string, string>): string {
  if (!parentSku) return '';
  // значения через «-»: без разделителя {a:'1', b:'23'} и {a:'12', b:'3'} давали бы один артикул
  const suffix = Object.values(values)
    .map(v => v.replace(/[^A-Za-zА-Яа-я0-9]+/g, ''))
    .join('-')
    .slice(0, 40);
  return suffix ? `${parentSku}-${suffix}`.slice(0, 64) : parentSku;
}

/** Число комбинаций по select-параметрам с флажком «разрез склада» */
export function combinationCount(params: SpecParamDef[]): number {
  return params.filter(p => p.stockDimension && p.type === 'select').reduce((n, p) => n * Math.max((p.options?.choices ?? []).length, 1), 1);
}

/**
 * Все комбинации значений параметров с флажком «разрез склада» (декартово произведение вариантов select).
 * Возвращает `null`, если комбинаций больше VARIANT_MAX_COMBINATIONS — генератор их не создаёт (422 у вызывающего).
 */
export function variantCombinations(params: SpecParamDef[]): Record<string, string>[] | null {
  const dims = params.filter(p => p.stockDimension && p.type === 'select');
  if (!dims.length) return [];
  const total = combinationCount(params);
  if (total > VARIANT_MAX_COMBINATIONS) return null;
  let acc: Record<string, string>[] = [{}];
  for (const p of dims) {
    const next: Record<string, string>[] = [];
    for (const base of acc) for (const c of p.options?.choices ?? []) next.push({ ...base, [p.key]: c.value });
    acc = next;
  }
  return acc;
}

/** Сравнение значений варианта: два набора равны, если совпадают ключи и значения (порядок ключей не важен) */
export const sameVariant = (a: Record<string, string>, b: Record<string, string>): boolean => {
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && a[k] === b[k]);
};