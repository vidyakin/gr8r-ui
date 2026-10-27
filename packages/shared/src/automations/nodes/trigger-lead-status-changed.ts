import { z } from 'zod';
import { stringifyValue } from '../template';
import { defineNode } from '../types';
import { triggerOutput } from './_util';

const params = z.object({
  statusId: z.string().max(64).default('').meta({ title: 'New status (optional)', ui: 'lead_status', description: 'Empty — any status change.' }),
});

export default defineNode({
  type: 'trigger.lead_status_changed',
  category: 'trigger',
  label: 'Lead status changed',
  description: 'Starts when the status of a lead changes, optionally to a specific status.',
  icon: 'git-compare-arrows',
  params,
  match: (p, _ev, h) => {
    if (h.action !== 'updated' || h.entity !== 'lead') return false;
    const ch = h.changes.statusId;
    if (!ch) return false;
    return !p.statusId || stringifyValue(ch.to) === p.statusId;
  },
  execute: async (_p, rt) => ({ output: triggerOutput(rt.ctx) }),
});
