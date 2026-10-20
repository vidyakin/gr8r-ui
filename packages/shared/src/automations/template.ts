/* Безопасный шаблонизатор значений параметров узлов: «{{trigger.record.title}}». Без eval и без выражений: только путь
   по контексту (ключи через точку, индексы массивов — числом). Доступны лишь собственные свойства объектов, прототипы закрыты.
   Результат подстановки всегда строка (объекты — JSON); приведение к нужному типу делает узел по схеме поля. */

const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);
const PLACEHOLDER = /\{\{\s*([^{}]*?)\s*\}\}/g;
const PATH = /^[A-Za-z_][A-Za-z0-9_-]*(\.[A-Za-z0-9_-]+)*$/;

export const TEMPLATE_MAX_LENGTH = 100_000;

/** Значение по пути «a.b.0.c»; отсутствующее → undefined. Цепочка не выходит за собственные свойства */
export function getPath(ctx: unknown, path: string): unknown {
  if (!PATH.test(path)) return undefined;
  let cur: unknown = ctx;
  for (const seg of path.split('.')) {
    if (FORBIDDEN.has(seg) || cur === null || typeof cur !== 'object') return undefined;
    if (Array.isArray(cur)) {
      if (!/^\d+$/.test(seg)) return undefined;
      cur = cur[Number(seg)];
    } else {
      if (!Object.hasOwn(cur, seg)) return undefined;
      cur = (cur as Record<string, unknown>)[seg];
    }
  }
  return cur;
}

export function stringifyValue(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v);
  if (v instanceof Date) return v.toISOString();
  try {
    return JSON.stringify(v) ?? '';
  } catch {
    return '';
  }
}

/** Подставляет значения в строку. Неверное выражение остаётся в тексте как есть; недостающее значение даёт пустую строку */
export function renderTemplate(input: string, ctx: unknown): string {
  if (!input.includes('{{')) return input;
  const out = input.replace(PLACEHOLDER, (whole, expr: string) => (PATH.test(expr) ? stringifyValue(getPath(ctx, expr)) : whole));
  return out.length > TEMPLATE_MAX_LENGTH ? out.slice(0, TEMPLATE_MAX_LENGTH) : out;
}

/** Подстановки во всех строках значения (вложенные объекты и массивы обходятся рекурсивно) */
export function resolveTemplates<T>(value: T, ctx: unknown, depth = 0): T {
  if (depth > 8) return value;
  if (typeof value === 'string') return renderTemplate(value, ctx) as T;
  if (Array.isArray(value)) return value.map(v => resolveTemplates(v, ctx, depth + 1)) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = resolveTemplates(v, ctx, depth + 1);
    return out as T;
  }
  return value;
}
