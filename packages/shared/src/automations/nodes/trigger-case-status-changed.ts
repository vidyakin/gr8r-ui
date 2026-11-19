import { z } from 'zod';
import { CASE_STATUSES } from '../../cases';
import { stringifyValue } from '../template';
import { defineNode } from '../types';
import { triggerOutput } from './_util';

const params = z.object({
  status: z.enum(['', ...CASE_STATUSES]).default('').meta({ title: 'New status (optional)', description: 'Empty — any status change.' }),
});

export default defineNode({
  type: 'trigger.case_status_changed',
  category: 'trigger',
  label: 'Case status changed',
  description: 'Starts when the status of a customer case changes, optionally to a specific status.',
  icon: 'git-compare-arrows',
  params,
  match: (p, _ev, h) => {
    if (h.action !== 'updated' || h.entity !== 'case') return false;
    const ch = h.changes.status;
    if (!ch) return false;
    return !p.status || stringifyValue(ch.to) === p.status;
  },
  execute: async (_p, rt) => ({ output: triggerOutput(rt.ctx) }),
});
