import { z } from 'zod';
import { defineNode } from '../types';

export const CONDITION_OPERATORS = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains', 'empty', 'not_empty'] as const;
export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

const isNum = (s: string) => s.trim() !== '' && Number.isFinite(Number(s));

/** Сравнение двух подставленных значений: числа — как числа, остальное — как строки без учёта регистра */
export function compareValues(op: ConditionOperator, left: string, right: string): boolean {
  switch (op) {
    case 'empty':
      return left.trim() === '';
    case 'not_empty':
      return left.trim() !== '';
    case 'contains':
      return left.toLowerCase().includes(right.toLowerCase());
  }
  const numeric = isNum(left) && isNum(right);
  const c = numeric ? Math.sign(Number(left) - Number(right)) : left.toLowerCase().localeCompare(right.toLowerCase());
  switch (op) {
    case 'eq':
      return c === 0;
    case 'ne':
      return c !== 0;
    case 'gt':
      return c > 0;
    case 'gte':
      return c >= 0;
    case 'lt':
      return c < 0;
    case 'lte':
      return c <= 0;
  }
}

const params = z.object({
  left: z.string().max(2000).default('{{trigger.record.priority}}').meta({ title: 'Value', description: 'Usually a field of the record: {{trigger.record.status}}' }),
  operator: z.enum(CONDITION_OPERATORS).default('eq').meta({ title: 'Operator' }),
  right: z.string().max(2000).default('').meta({ title: 'Compare with' }),
});

export default defineNode({
  type: 'logic.condition',
  category: 'condition',
  label: 'Condition',
  description: 'Compares a value and continues down the “true” or “false” output.',
  icon: 'split',
  params,
  outputs: [
    { id: 'true', label: 'true' },
    { id: 'false', label: 'false' },
  ],
  execute: async p => {
    const result = compareValues(p.operator, p.left, p.right);
    return { output: { left: p.left, operator: p.operator, right: p.right, result }, next: result ? 'true' : 'false' };
  },
});
