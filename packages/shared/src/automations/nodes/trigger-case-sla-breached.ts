import { z } from 'zod';
import { defineNode } from '../types';
import { triggerOutput } from './_util';

const params = z.object({
  kind: z.enum(['', 'first_response', 'resolve']).default('').meta({ title: 'Deadline (optional)', description: 'First response, resolution, or empty for either.' }),
});

export default defineNode({
  type: 'trigger.case_sla_breached',
  category: 'trigger',
  label: 'Case deadline breached',
  description: 'Starts once when the first-response or resolution deadline of an open case passes.',
  icon: 'alarm-clock',
  params,
  match: (p, ev, h) => {
    if (h.action !== 'sla_breached' || h.entity !== 'case') return false;
    const kind = (ev.payload as { kind?: unknown } | null)?.kind;
    return !p.kind || kind === p.kind;
  },
  execute: async (_p, rt) => ({ output: triggerOutput(rt.ctx) }),
});
