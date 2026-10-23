import { describe, expect, test } from 'bun:test';
import { compileExpr, evalCondition, evalExpr, evalNumber, EXPR_MAX_DEPTH, EXPR_MAX_LENGTH, ExprError, exprIdentifiers, type ParamValues } from '../src';

/** Параметры демо-спецификации: окно 1200×1400 белого цвета */
const keys = ['width', 'height', 'color', 'glass', 'frames'];
const values = { width: 1.2, height: 1.4, color: 'white', glass: true, frames: 6 };

const err = (src: string, k: string[] = keys, v: ParamValues = values) => {
  try {
    compileExpr(src, k).run(v);
  } catch (e) {
    return e as ExprError;
  }
  throw new Error(`“${src}” was expected to fail`);
};

describe('expr: разбор и вычисление', () => {
  test('числа, скобки, унарный минус, приоритет операций', () => {
    expect(evalExpr('1 + 2 * 3', [], {})).toBe(7);
    expect(evalExpr('(1 + 2) * 3', [], {})).toBe(9);
    expect(evalExpr('10 - 4 - 3', [], {})).toBe(3);
    expect(evalExpr('100 / 10 / 2', [], {})).toBe(5);
    expect(evalExpr('-2 + 5', [], {})).toBe(3);
    expect(evalExpr('-(2 + 3)', [], {})).toBe(-5);
    expect(evalExpr('0.1 + 0.2', [], {})).toBe(0.3);
    expect(evalExpr('.5 * 4', [], {})).toBe(2);
  });

  test('сравнения и логика: приоритет not → сравнение → and → or', () => {
    expect(evalExpr('2 > 1 and 3 > 2', [], {})).toBe(true);
    expect(evalExpr('2 > 3 and 3 > 2', [], {})).toBe(false);
    expect(evalExpr('2 > 3 or 3 > 2', [], {})).toBe(true);
    expect(evalExpr('not 2 > 3', [], {})).toBe(true);
    expect(evalExpr('2 = 2 and not 2 <> 2', [], {})).toBe(true);
    expect(evalExpr('2 != 3', [], {})).toBe(true);
    expect(evalExpr('2 <= 2', [], {})).toBe(true);
    expect(evalExpr('2 >= 3', [], {})).toBe(false);
    expect(evalExpr("'red' = 'red'", [], {})).toBe(true);
    expect(evalExpr("'red' <> 'white'", [], {})).toBe(true);
  });

  test('and/or не вычисляют ненужную ветвь', () => {
    // во второй ветви параметра нет — короткое замыкание не даёт ошибки
    expect(evalExpr('false and missing > 1', ['missing'], {})).toBe(false);
    expect(evalExpr('true or missing > 1', ['missing'], {})).toBe(true);
    expect(evalExpr('if(true, 1, missing)', ['missing'], {})).toBe(1);
  });

  test('функции: if, round, ceil, floor, min, max, abs', () => {
    expect(evalExpr('if(1 = 1, 10, 20)', [], {})).toBe(10);
    expect(evalExpr('if(1 = 2, 10, 20)', [], {})).toBe(20);
    expect(evalExpr('round(2.567, 1)', [], {})).toBe(2.6);
    expect(evalExpr('round(2.5)', [], {})).toBe(3);
    expect(evalExpr('ceil(2.1)', [], {})).toBe(3);
    expect(evalExpr('floor(2.9)', [], {})).toBe(2);
    expect(evalExpr('ceil(-2.1)', [], {})).toBe(-2);
    expect(evalExpr('floor(-2.1)', [], {})).toBe(-3);
    expect(evalExpr('min(3, 1, 2)', [], {})).toBe(1);
    expect(evalExpr('max(3, 1, 2)', [], {})).toBe(3);
    expect(evalExpr('abs(-4.5)', [], {})).toBe(4.5);
  });

  test('параметры: число, строка, логический', () => {
    expect(evalExpr('width * height', keys, values)).toBeCloseTo(1.68, 6);
    expect(evalExpr("color = 'white'", keys, values)).toBe(true);
    expect(evalExpr("color = 'black'", keys, values)).toBe(false);
    expect(evalExpr('glass', keys, values)).toBe(true);
    expect(evalExpr('if(glass, 1.2 * 1.4 * 2, 0)', keys, values)).toBeCloseTo(3.36, 6);
  });

  test('вычисление количества и условия строки', () => {
    // метры → миллиметры площади: экспонента в записи числа
expect(evalNumber('width * height / 1e-6', ['width', 'height'], { width: 1.2, height: 1.4 })).toBe('1680000');
expect(evalNumber('round(width * height * 1.1, 2)', ['width', 'height'], { width: 1.2, height: 1.4 })).toBe('1.85');
    expect(evalCondition("color = 'white'", keys, values)).toBe(true);
    expect(() => evalCondition('width', keys, values)).toThrow('not true or false');
    expect(() => evalNumber("color = 'white'", keys, values)).toThrow('not a number');
  });
});

describe('expr: ошибки', () => {
  test('синтаксис', () => {
    expect(err('1 +').code).toBe('syntax');
    expect(err('(1 + 2').code).toBe('syntax');
    expect(err('1 ? 2').code).toBe('syntax');
    expect(err("'white").code).toBe('syntax');
    expect(err('').code).toBe('empty');
    expect(err('   ').code).toBe('empty');
  });

  test('деление на ноль', () => {
    expect(err('1 / (width - 1.2)').code).toBe('division_by_zero');
    expect(err('width / (width - 1.2)').code).toBe('division_by_zero');
  });

  test('неизвестный параметр отклоняется при сохранении', () => {
    const e = err('width * depth', keys, values);
    expect(e.code).toBe('unknown_param');
    expect(e.message).toContain('depth');
  });

  test('незаполненный параметр при вычислении', () => {
    expect(err('width * 2', keys, { height: 1.4 }).code).toBe('missing_param');
    expect(err("color = 'white'", keys, {}).code).toBe('missing_param');
  });

  test('тип: строки не складываются и не сравниваются как числа', () => {
    expect(err('color * 2', keys, values).code).toBe('type');
    expect(err('color + 1', keys, values).code).toBe('type');
    expect(err('1 < color', keys, values).code).toBe('type');
  });

  test('неизвестная функция и число аргументов', () => {
    expect(err('sqrt(4)', keys, values).code).toBe('unknown_function');
    expect(err('round(1, 2, 3)', keys, values).code).toBe('arity');
    expect(err('if(1)', keys, values).code).toBe('arity');
    expect(err('min(1)', keys, values).code).toBe('arity');
  });

  test('лимиты: длина и глубина', () => {
    expect(err('1 + '.repeat(10) + '1'.repeat(EXPR_MAX_LENGTH)).code).toBe('too_long');
    const deep = '('.repeat(EXPR_MAX_DEPTH + 1) + '1' + ')'.repeat(EXPR_MAX_DEPTH + 1);
    expect(err(deep).code).toBe('too_deep');
  });

  test('попытки инъекции: служебные имена и вызовы', () => {
    expect(err('constructor').code).toBe('reserved');
    expect(err('__proto__').code).toBe('reserved');
    expect(err('width.__proto__').code).toBe('syntax');
    expect(err('globalThis').code).toBe('unknown_param');
    expect(err('process.exit(1)').code).toBe('syntax');
    expect(err('require("fs")').code).toBe('unknown_function');
    expect(err('eval("1+1")').code).toBe('unknown_function');
    expect(err('width; drop table products', ['width'], values).code).toBe('syntax');
    expect(err('width[0]', ['width'], values).code).toBe('syntax');
    expect(err('width === 1', ['width'], values).code).toBe('syntax');
  });
});

describe('expr: идентификаторы и скомпилированное выражение', () => {
  test('список параметров в порядке первого появления, без повторов', () => {
    expect(exprIdentifiers('width * height + width')).toEqual(['width', 'height']);
    expect(exprIdentifiers("if(color = 'white', width, 0)")).toEqual(['color', 'width']);
    expect(exprIdentifiers('round(1.5, 2)')).toEqual([]);
  });

  test('скомпилированное выражение переиспользуется с разными значениями', () => {
    const c = compileExpr('round(width * height * 1.1, 2)', ['width', 'height']);
    expect(c.identifiers).toEqual(['width', 'height']);
    expect(c.run({ width: 1.2, height: 1.4 })).toBe(1.85);
    expect(c.run({ width: 1, height: 1 })).toBe(1.1);
  });
});