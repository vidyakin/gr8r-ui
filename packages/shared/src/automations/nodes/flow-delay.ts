import { z } from 'zod';
import { defineNode } from '../types';

export const DELAY_UNITS = { seconds: 1000, minutes: 60_000, hours: 3_600_000, days: 86_400_000 } as const;
/** Не больше 30 суток */
export const MAX_DELAY_MS = 30 * DELAY_UNITS.days;

const params = z
  .object({
    amount: z.number().int().min(1).max(100_000).default(5).meta({ title: 'Wait for' }),
    unit: z.enum(['seconds', 'minutes', 'hours', 'days']).default('minutes').meta({ title: 'Unit' }),
  })
  .refine(p => p.amount * DELAY_UNITS[p.unit] <= MAX_DELAY_MS, { message: 'The delay cannot exceed 30 days', path: ['amount'] });

export default defineNode({
  type: 'flow.delay',
  category: 'flow',
  label: 'Delay',
  description: 'Pauses the run, then continues. The wait does not occupy a worker.',
  icon: 'timer',
  params,
  execute: async p => ({ delayMs: p.amount * DELAY_UNITS[p.unit], output: { amount: p.amount, unit: p.unit } }),
});
