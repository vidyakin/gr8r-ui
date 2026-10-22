/* Безопасный вычислитель выражений: свой токенизатор и парсер, без eval и Function.
   Выражения нужны параметрическим спецификациям: количество строки (`bom_lines.qty_expr`) и условие строки
   (`bom_lines.condition`). Числа — десятичные (decimal.ts, BigInt с масштабом 10^-6), поэтому
   `width * height / 1e6` считается без погрешности float, как и весь остальной код gr8r.

   Язык выражений (docs/architecture.md, «Производство: спецификации и себестоимость»):
     - числа: 12, 0.5, 1.2e3; строки в одинарных или двойных кавычках: 'white';
     - параметры — идентификаторы: width, height, color, color = 'white' и т. п.;
     - арифметика: + − * / , скобки, унарный минус;
     - сравнения: = <> != < <= > >= (строки сравниваются как строки; сравнивать строку с числом — ошибка типа);
     - логика: and, or, not (приоритет: not → сравнение → and → or);
     - функции: if(cond, a, b), round(x[, n]), ceil(x), floor(x), min(a, b, …), max(a, b, …), abs(x);
     - разделитель аргументов — запятая.

   Ограничения: не длиннее EXPR_MAX_LENGTH символов, вложенность не глубже EXPR_MAX_DEPTH, аргументов у функции
   не больше 8, кроме min/max. Идентификаторы вида `__proto__`, `constructor`, `prototype` запрещены. */
import { dec, div, fmt, mul, type Dec } from './decimal';

/** Предел длины выражения */
export const EXPR_MAX_LENGTH = 500;
/** Предел вложенности (скобки, вызовы функций, унарные операции) */
export const EXPR_MAX_DEPTH = 16;
/** Предел числа аргументов функции */
export const EXPR_MAX_ARGS = 8;

export type ExprErrorCode = 'empty' | 'too_long' | 'too_deep' | 'syntax' | 'reserved' | 'unknown_param' | 'missing_param' | 'type' | 'division_by_zero' | 'unknown_function' | 'arity' | 'domain';

/** Ошибка выражения: код + позиция в тексте (если разбор дошёл до неё) */
export class ExprError extends Error {
  constructor(
    public code: ExprErrorCode,
    message: string,
    public position?: number,
  ) {
    super(message);
    this.name = 'ExprError';
  }
}

export type ExprValue = number | string | boolean;
export type ParamValues = Record<string, ExprValue | null | undefined>;

/* ---------------- токенизатор ---------------- */

type TokKind = 'num' | 'str' | 'ident' | 'op' | 'eof';
interface Tok {
  kind: TokKind;
  value: string;
  pos: number;
}

const RESERVED = new Set(['__proto__', 'constructor', 'prototype']);
const OPS = ['<=', '>=', '<>', '!=', '=', '<', '>', '+', '-', '*', '/', '(', ')', ','];

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++;
      continue;
    }
    // число: 12, 0.5 или 1.2e3 (экспонента удобна для перевода единиц измерения: width * height / 1e-6)
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const start = i;
      while (i < src.length && /[0-9]/.test(src[i]!)) i++;
      if (src[i] === '.') {
        i++;
        while (i < src.length && /[0-9]/.test(src[i]!)) i++;
      }
      if (src[i] === 'e' || src[i] === 'E') {
        const mark = i;
        i++;
        if (src[i] === '+' || src[i] === '-') i++;
        if (!/[0-9]/.test(src[i] ?? '')) throw new ExprError('syntax', 'Exponent of the number has no digits', mark);
        while (i < src.length && /[0-9]/.test(src[i]!)) i++;
      }
      const value = src.slice(start, i);
      if (/^0[0-9]/.test(value)) throw new ExprError('syntax', `Number must not have leading zeros: “${value}”`, start);
      if (!Number.isFinite(Number(value))) throw new ExprError('domain', `Number “${value}” is out of range`, start);
      out.push({ kind: 'num', value, pos: start });
      continue;
    }
    // строка в кавычках: без escape-последовательностей (в выражении они не нужны)
    if (c === "'" || c === '"') {
      const start = i;
      const end = src.indexOf(c, i + 1);
      if (end < 0) throw new ExprError('syntax', 'String is not closed', start);
      out.push({ kind: 'str', value: src.slice(i + 1, end), pos: start });
      i = end + 1;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const start = i;
      while (i < src.length && /[A-Za-z0-9_]/.test(src[i]!)) i++;
      const value = src.slice(start, i);
      if (RESERVED.has(value)) throw new ExprError('reserved', `“${value}” is not allowed in an expression`, start);
      out.push({ kind: 'ident', value, pos: start });
      continue;
    }
    const op = OPS.find(o => src.startsWith(o, i));
    if (!op) throw new ExprError('syntax', `Unexpected character “${c}”`, i);
    out.push({ kind: 'op', value: op, pos: i });
    i += op.length;
  }
  out.push({ kind: 'eof', value: '', pos: src.length });
  return out;
}

/* ---------------- дерево разбора ---------------- */

type Node =
  | { t: 'num'; v: string; pos: number }
  | { t: 'str'; v: string; pos: number }
  | { t: 'lit'; v: boolean; pos: number }
  | { t: 'ref'; name: string; pos: number }
  | { t: 'neg'; e: Node; pos: number }
  | { t: 'bin'; op: string; l: Node; r: Node; pos: number }
  | { t: 'logic'; op: 'and' | 'or'; l: Node; r: Node; pos: number }
  | { t: 'not'; e: Node; pos: number }
  | { t: 'call'; name: string; args: Node[]; pos: number };

/** Функции выражений: имя и обязательность/предел аргументов */
export const EXPR_FUNCTIONS: Record<string, { min: number; max: number }> = {
  if: { min: 3, max: 3 },
  round: { min: 1, max: 2 },
  ceil: { min: 1, max: 1 },
  floor: { min: 1, max: 1 },
  min: { min: 2, max: EXPR_MAX_ARGS },
  max: { min: 2, max: EXPR_MAX_ARGS },
  abs: { min: 1, max: 1 },
};

const KEYWORDS = new Set(['and', 'or', 'not']);
const LITERALS = new Set(['true', 'false']);

class Parser {
  private i = 0;
  private depth = 0;

  constructor(private toks: Tok[]) {}

  private peek = (): Tok => this.toks[this.i]!;
  private next = (): Tok => this.toks[this.i++]!;
  private at = (v: string): boolean => {
    const t = this.peek();
    return (t.kind === 'op' || t.kind === 'ident') && t.value === v;
  };
  private eat = (v: string): boolean => {
    if (!this.at(v)) return false;
    this.i++;
    return true;
  };
  private expect = (v: string): Tok => {
    if (!this.at(v)) throw new ExprError('syntax', `Expected “${v}”`, this.peek().pos);
    return this.next();
  };
  /** Вложенность: скобки, вызовы и унарный минус ограничены EXPR_MAX_DEPTH */
  private enter(pos: number) {
    if (++this.depth > EXPR_MAX_DEPTH) throw new ExprError('too_deep', `Expression is nested deeper than ${EXPR_MAX_DEPTH}`, pos);
  }
  private leave = () => this.depth--;

  parse(): Node {
    if (this.peek().kind === 'eof') throw new ExprError('empty', 'Expression is empty');
    const node = this.or();
    const rest = this.peek();
    if (rest.kind !== 'eof') throw new ExprError('syntax', `Unexpected “${rest.value}”`, rest.pos);
    return node;
  }

  private or(): Node {
    let l = this.and();
    while (this.at('or')) {
      const pos = this.next().pos;
      l = { t: 'logic', op: 'or', l, r: this.and(), pos };
    }
    return l;
  }

  private and(): Node {
    let l = this.notExpr();
    while (this.at('and')) {
      const pos = this.next().pos;
      l = { t: 'logic', op: 'and', l, r: this.notExpr(), pos };
    }
    return l;
  }

  /** not — выше сравнения, но ниже and: `not 2 > 3` значит `not (2 > 3)` */
  private notExpr(): Node {
    if (this.at('not')) {
      const pos = this.next().pos;
      this.enter(pos);
      const e = this.notExpr();
      this.leave();
      return { t: 'not', e, pos };
    }
    return this.cmp();
  }

  private cmp(): Node {
    const l = this.sum();
    const t = this.peek();
    if (t.kind === 'op' && ['=', '<>', '!=', '<', '<=', '>', '>='].includes(t.value)) {
      this.i++;
      return { t: 'bin', op: t.value === '!=' ? '<>' : t.value, l, r: this.sum(), pos: t.pos };
    }
    return l;
  }

  private sum(): Node {
    let l = this.term();
    while (this.at('+') || this.at('-')) {
      const t = this.next();
      l = { t: 'bin', op: t.value, l, r: this.term(), pos: t.pos };
    }
    return l;
  }

  private term(): Node {
    let l = this.unary();
    while (this.at('*') || this.at('/')) {
      const t = this.next();
      l = { t: 'bin', op: t.value, l, r: this.unary(), pos: t.pos };
    }
    return l;
  }

  private unary(): Node {
    if (this.at('-')) {
      const pos = this.next().pos;
      this.enter(pos);
      const e = this.unary();
      this.leave();
      return { t: 'neg', e, pos };
    }
    if (this.at('+')) {
      const pos = this.next().pos;
      this.enter(pos);
      const e = this.unary();
      this.leave();
      return e;
    }
    return this.primary();
  }

  private primary(): Node {
    const t = this.peek();
    if (t.kind === 'num') {
      this.i++;
      return { t: 'num', v: t.value, pos: t.pos };
    }
    if (t.kind === 'str') {
      this.i++;
      return { t: 'str', v: t.value, pos: t.pos };
    }
    if (t.kind === 'ident') {
      this.i++;
      // логические константы
      if (LITERALS.has(t.value)) return { t: 'lit', v: t.value === 'true', pos: t.pos };
      if (KEYWORDS.has(t.value)) throw new ExprError('syntax', `Keyword “${t.value}” needs an operand`, t.pos);
      if (!this.at('(')) return { t: 'ref', name: t.value, pos: t.pos };
      // вызов функции: только из белого списка
      const fn = EXPR_FUNCTIONS[t.value];
      if (!fn) throw new ExprError('unknown_function', `Unknown function “${t.value}”`, t.pos);
      const args: Node[] = [];
      this.expect('(');
      this.enter(t.pos);
      if (!this.at(')')) {
        args.push(this.or());
        while (this.eat(',')) args.push(this.or());
      }
      this.expect(')');
      this.leave();
      if (args.length < fn.min || args.length > fn.max)
        throw new ExprError('arity', `“${t.value}” takes ${fn.min === fn.max ? fn.min : `${fn.min} to ${fn.max}`} argument${fn.max === 1 ? '' : 's'}, got ${args.length}`, t.pos);
      return { t: 'call', name: t.value, args, pos: t.pos };
    }
    if (t.kind === 'op' && t.value === '(') {
      this.i++;
      this.enter(t.pos);
      const e = this.or();
      this.expect(')');
      this.leave();
      return e;
    }
    throw new ExprError('syntax', t.kind === 'eof' ? 'Expression is incomplete' : `Unexpected “${t.value}”`, t.pos);
  }
}

/** Разбор выражения в дерево. Бросает ExprError на любой ошибке текста */
export function parseExpr(source: string): Node {
  if (source.length > EXPR_MAX_LENGTH) throw new ExprError('too_long', `Expression is longer than ${EXPR_MAX_LENGTH} characters`, EXPR_MAX_LENGTH);
  if (!source.trim()) throw new ExprError('empty', 'Expression is empty');
  return new Parser(tokenize(source)).parse();
}

/** Идентификаторы (параметры), встречающиеся в выражении, — в порядке первого появления */
export function exprIdentifiers(source: string): string[] {
  const out: string[] = [];
  const walk = (n: Node): void => {
    switch (n.t) {
      case 'ref':
        if (!out.includes(n.name)) out.push(n.name);
        return;
      case 'neg':
        return walk(n.e);
      case 'not':
        return walk(n.e);
      case 'bin':
      case 'logic':
        walk(n.l);
        walk(n.r);
        return;
      case 'call':
        for (const a of n.args) walk(a);
        return;
      default:
    }
  };
  walk(parseExpr(source));
  return out;
}

/* ---------------- вычисление ---------------- */

export interface CompiledExpr {
  source: string;
  /** Идентификаторы, которые выражение читает */
  identifiers: string[];
  /** Вычислить: значения параметров → число, строка или истина/ложь */
  run: (values?: ParamValues) => ExprValue;
}

const asNumber = (v: ExprValue, what: string): Dec => {
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new ExprError('type', `${what} is not a finite number`);
    return dec(v);
  }
  if (typeof v === 'boolean') return v ? 1n : 0n;
  if (/^-?\d+(\.\d+)?$/.test(v)) return dec(v);
  throw new ExprError('type', `${what} is not a number`);
};

/** Сравнение: обе части одного вида (число с числом, строка со строкой, истина с истиной); смешанные типы — ошибка.
    Лексикографика строк даёт `color = 'white'` и `color < 'm'` одинаково осмысленный смысл */
const compare = (l: ExprValue, r: ExprValue): number => {
  const lt = typeof l === 'boolean' ? 'bool' : typeof l;
  const rt = typeof r === 'boolean' ? 'bool' : typeof r;
  if (lt !== rt) throw new ExprError('type', `Cannot compare ${lt === 'number' ? 'a number' : lt === 'string' ? 'a string' : 'true/false'} with ${rt === 'number' ? 'a number' : rt === 'string' ? 'a string' : 'true/false'}`);
  if (lt === 'string') {
    const ls = String(l);
    const rs = String(r);
    return ls === rs ? 0 : ls < rs ? -1 : 1;
  }
  const a = asNumber(l, 'Left side of the comparison');
  const b = asNumber(r, 'Right side of the comparison');
  return a === b ? 0 : a < b ? -1 : 1;
};

/** Истинность значения: истина/ложь — как есть, число — не ноль, строка — непустая */
export const exprTruthy = (v: ExprValue): boolean => (typeof v === 'boolean' ? v : typeof v === 'number' ? v !== 0 : v !== '');

/** Целочисленное деление вверх / вниз (деление BigInt усекает к нулю, поэтому остаток корректируется) */
const ONE = 10n ** 6n;
const ceilDiv = (a: bigint): bigint => {
  const q = a / ONE;
  return a % ONE > 0n ? q + 1n : q;
};
const floorDiv = (a: bigint): bigint => {
  const q = a / ONE;
  return a % ONE < 0n ? q - 1n : q;
};

/** Dec → число (значение уже посчитано, поэтому деление точное) */
const num = (d: Dec): number => Number(d) / 1e6;

const call = (name: string, args: ExprValue[]): ExprValue => {
  switch (name) {
    case 'if':
      return exprTruthy(args[0]!) ? args[1]! : args[2]!;
    case 'round': {
      const dp = args.length > 1 ? num(asNumber(args[1]!, 'Digits argument of round()')) : 0;
      if (!Number.isInteger(dp) || dp < 0 || dp > 6) throw new ExprError('domain', 'round(): the second argument is the number of decimals, from 0 to 6');
      return Number(fmt(asNumber(args[0]!, 'round() argument'), dp));
    }
    case 'ceil':
      return Number(ceilDiv(asNumber(args[0]!, 'ceil() argument')));
    case 'floor':
      return Number(floorDiv(asNumber(args[0]!, 'floor() argument')));
    case 'abs': {
      const v = asNumber(args[0]!, 'abs() argument');
      return num(v < 0n ? -v : v);
    }
    case 'min':
    case 'max': {
      let acc = asNumber(args[0]!, `${name}() argument`);
      for (const a of args.slice(1)) {
        const v = asNumber(a, `${name}() argument`);
        acc = name === 'min' ? (v < acc ? v : acc) : v > acc ? v : acc;
      }
      return num(acc);
    }
    default:
      throw new ExprError('unknown_function', `Unknown function “${name}”`);
  }
};

/**
 * Проверка выражения при сохранении: разбор + сверка идентификаторов со списком параметров спецификации.
 * Неизвестный параметр — ошибка `unknown_param`, поэтому ссылку на несуществующий параметр не сохранить.
 */
export function compileExpr(source: string, keys: string[]): CompiledExpr {
  const node = parseExpr(source);
  const identifiers = exprIdentifiers(source);
  const allowed = new Set(keys);
  for (const id of identifiers) {
    if (!allowed.has(id)) throw new ExprError('unknown_param', `Unknown parameter “${id}”`, source.indexOf(id));
  }
  const run = (values: ParamValues = {}): ExprValue => {
    const evalNode = (n: Node, depth: number): ExprValue => {
      if (depth > EXPR_MAX_DEPTH) throw new ExprError('too_deep', `Expression is nested deeper than ${EXPR_MAX_DEPTH}`);
      switch (n.t) {
        case 'num':
          return Number(n.v);
        case 'lit':
          return n.v;
        case 'str':
          return n.v;
        case 'ref': {
          if (!(n.name in values)) throw new ExprError('missing_param', `Value of the parameter “${n.name}” is not filled`, n.pos);
          const v = values[n.name];
          if (v === null || v === undefined) throw new ExprError('missing_param', `Value of the parameter “${n.name}” is not filled`, n.pos);
          return v;
        }
        case 'neg':
          return num(-asNumber(evalNode(n.e, depth + 1), 'Operand of unary minus'));
        case 'not':
          return !exprTruthy(evalNode(n.e, depth + 1));
        case 'logic': {
          const l = exprTruthy(evalNode(n.l, depth + 1));
          // короткое замыкание: and/or не вычисляют вторую часть, если она не нужна (как в 1С и SQL)
          if (n.op === 'and') return l ? exprTruthy(evalNode(n.r, depth + 1)) : false;
          return l ? true : exprTruthy(evalNode(n.r, depth + 1));
        }
        case 'bin': {
          const l = evalNode(n.l, depth + 1);
          const r = evalNode(n.r, depth + 1);
          if (n.op === '=' || n.op === '<>' || n.op === '<' || n.op === '<=' || n.op === '>' || n.op === '>=') {
            const c = compare(l, r);
            return n.op === '=' ? c === 0 : n.op === '<>' ? c !== 0 : n.op === '<' ? c < 0 : n.op === '<=' ? c <= 0 : n.op === '>' ? c > 0 : c >= 0;
          }
          const a = asNumber(l, 'Left operand');
          const b = asNumber(r, 'Right operand');
          if (n.op === '+') return num(a + b);
          if (n.op === '-') return num(a - b);
          if (n.op === '*') return num(mul(a, b));
          if (b === 0n) throw new ExprError('division_by_zero', 'Division by zero', n.pos);
          return num(div(a, b));
        }
        case 'call': {
          // if() вычисляет только нужную ветвь — условие может опираться на параметры второй ветви
          if (n.name === 'if') {
            const cond = evalNode(n.args[0]!, depth + 1);
            if (typeof cond !== 'boolean' && typeof cond !== 'number') throw new ExprError('type', 'if(): the first argument must be a condition', n.pos);
            return evalNode(exprTruthy(cond) ? n.args[1]! : n.args[2]!, depth + 1);
          }
          return call(n.name, n.args.map(a => evalNode(a, depth + 1)));
        }
      }
    };
    return evalNode(node, 0);
  };
  return { source, identifiers, run };
}

/** Разбор + вычисление одним вызовом (тесты, разовые проверки) */
export function evalExpr(source: string, keys: string[], values: ParamValues = {}): ExprValue {
  return compileExpr(source, keys).run(values);
}

/** Вычисление числа: нечисловой результат — ошибка типа (например, условие в qtyExpr) */
export function evalNumber(source: string, keys: string[], values: ParamValues = {}): string {
  const v = compileExpr(source, keys).run(values);
  if (typeof v === 'boolean' || typeof v === 'string') throw new ExprError('type', `Expression “${source}” is not a number`);
  return trimNum(fmt(dec(v), 6));
}

/** «1.850000» → «1.85»: результат формулы без лишних нулей */
export const trimNum = (v: string): string => (v.includes('.') ? v.replace(/0+$/, '').replace(/\.$/, '') : v);

/** Проверка условия строки: не логическое значение — ошибка типа */
export function evalCondition(source: string, keys: string[], values: ParamValues = {}): boolean {
  const v = compileExpr(source, keys).run(values);
  if (typeof v !== 'boolean') throw new ExprError('type', `Condition “${source}” is not true or false`);
  return v;
}