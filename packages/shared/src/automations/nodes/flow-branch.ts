import { z } from 'zod';
import { defineNode, type OutputDef } from '../types';

export const MAX_BRANCH_CASES = 8;

/** Варианты ветвления: по одному значению на строку */
export const branchCases = (cases: string): string[] =>
  cases
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean)
    .slice(0, MAX_BRANCH_CASES);

const params = z.object({
  value: z.string().max(2000).default('{{trigger.record.status}}').meta({ title: 'Value to switch on' }),
  cases: z.string().max(2000).default('todo\nreview').meta({ title: 'Cases (one value per line)', ui: 'textarea', description: 'Each line becomes an output. Anything else goes to “else”.' }),
});

export default defineNode({
  type: 'flow.branch',
  category: 'flow',
  label: 'Branch',
  description: 'Chooses one of several paths by the value (like a switch).',
  icon: 'git-fork',
  params,
  outputs: (p): OutputDef[] => [...branchCases(p.cases).map((c, i) => ({ id: `case_${i}`, label: c })), { id: 'else', label: 'else' }],
  execute: async p => {
    const cases = branchCases(p.cases);
    const i = cases.findIndex(c => c.toLowerCase() === p.value.trim().toLowerCase());
    return { output: { value: p.value, matched: i >= 0 ? cases[i] : null }, next: i >= 0 ? `case_${i}` : 'else' };
  },
});
