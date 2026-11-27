/* Прослеживаемость партий (задача 1253): чистый построитель дерева.
   Проверяем сборку цепочки, защиту от циклов, «ромб», ограничения глубины и числа узлов,
   отбрасывание дублей рёбер и отсутствие корня. */
import { describe, expect, test } from 'bun:test';
import {
  buildTraceTree,
  flattenTraceTree,
  traceTreeDepth,
  traceTreeSize,
  type TraceNodeSeed,
} from '../src/traceability';

const seed = (id: string, title = id): TraceNodeSeed => ({ id, kind: 'batch', title });
const seedsOf = (...ids: string[]) => new Map(ids.map(id => [id, seed(id)]));
const adj = (pairs: Record<string, string[]>) => new Map(Object.entries(pairs));

describe('buildTraceTree', () => {
  test('собирает цепочку A → B → C', () => {
    const tree = buildTraceTree('A', seedsOf('A', 'B', 'C'), adj({ A: ['B'], B: ['C'] }))!;
    expect(tree.id).toBe('A');
    expect(tree.children.map(c => c.id)).toEqual(['B']);
    expect(tree.children[0]!.children.map(c => c.id)).toEqual(['C']);
    expect(tree.children[0]!.children[0]!.children).toEqual([]);
    expect(traceTreeDepth(tree)).toBe(2);
    expect(traceTreeSize(tree)).toBe(3);
  });

  test('защита от цикла A → B → A не уходит в бесконечность', () => {
    const tree = buildTraceTree('A', seedsOf('A', 'B'), adj({ A: ['B'], B: ['A'] }))!;
    // корень A, ребёнок B; у B предок A уже в пути — ребро B→A отброшено
    expect(tree.children.map(c => c.id)).toEqual(['B']);
    expect(tree.children[0]!.children).toEqual([]);
    expect(traceTreeSize(tree)).toBe(2);
  });

  test('длиннее цикла: A → B → C → B обрывается на повторе предка', () => {
    const tree = buildTraceTree('A', seedsOf('A', 'B', 'C'), adj({ A: ['B'], B: ['C'], C: ['B'] }))!;
    expect(flattenTraceTree(tree).map(n => n.id)).toEqual(['A', 'B', 'C']);
  });

  test('«ромб» — не цикл: D достижим двумя ветвями', () => {
    const tree = buildTraceTree('A', seedsOf('A', 'B', 'C', 'D'), adj({ A: ['B', 'C'], B: ['D'], C: ['D'] }))!;
    expect(tree.children.map(c => c.id)).toEqual(['B', 'C']);
    expect(tree.children[0]!.children.map(c => c.id)).toEqual(['D']);
    expect(tree.children[1]!.children.map(c => c.id)).toEqual(['D']);
    // D встречается в двух ветвях (это не цикл): узлов A, B, C и два D — всего 5
    expect(traceTreeSize(tree)).toBe(5);
  });

  test('дубли рёбер у одного родителя отбрасываются', () => {
    const tree = buildTraceTree('A', seedsOf('A', 'B'), adj({ A: ['B', 'B', 'B'] }))!;
    expect(tree.children.map(c => c.id)).toEqual(['B']);
  });

  test('ограничение глубины', () => {
    const tree = buildTraceTree('A', seedsOf('A', 'B', 'C', 'D'), adj({ A: ['B'], B: ['C'], C: ['D'] }), { maxDepth: 2 })!;
    expect(flattenTraceTree(tree).map(n => n.id)).toEqual(['A', 'B', 'C']);
  });

  test('предохранитель по числу узлов', () => {
    const ids = ['A', 'B', 'C', 'D', 'E'];
    const tree = buildTraceTree('A', new Map(ids.map(id => [id, seed(id)])), adj({ A: ['B'], B: ['C'], C: ['D'], D: ['E'] }), { maxNodes: 3 })!;
    expect(traceTreeSize(tree)).toBeLessThanOrEqual(3);
  });

  test('лист без детей', () => {
    const tree = buildTraceTree('A', seedsOf('A'), adj({}))!;
    expect(tree.children).toEqual([]);
    expect(traceTreeDepth(tree)).toBe(0);
  });

  test('нет корня — null', () => {
    expect(buildTraceTree('X', seedsOf('A', 'B'), adj({ A: ['B'] }))).toBeNull();
  });

  test('ребёнок без узла пропускается, но остальные остаются', () => {
    const tree = buildTraceTree('A', seedsOf('A', 'C'), adj({ A: ['B', 'C'] }))!;
    expect(tree.children.map(c => c.id)).toEqual(['C']);
  });

  test('сохраняет поля узла и копирует их в дерево', () => {
    const seeds = new Map<string, TraceNodeSeed>([
      ['A', { id: 'A', kind: 'document', title: 'ПР-1', subtitle: 'Выпуск', documentType: 'production', qty: '10.000', meta: { status: 'ok' } }],
    ]);
    const tree = buildTraceTree('A', seeds, adj({}))!;
    expect(tree.kind).toBe('document');
    expect(tree.title).toBe('ПР-1');
    expect(tree.qty).toBe('10.000');
    expect(tree.meta).toEqual({ status: 'ok' });
  });
});
