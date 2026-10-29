import { z } from 'zod';
import { defineNode } from '../types';
import { triggerOutput } from './_util';

const params = z.object({
  pipelineId: z.string().max(64).default('').meta({ title: 'Pipeline (optional)', ui: 'deal_pipeline', description: 'Empty — any pipeline.' }),
});

export default defineNode({
  type: 'trigger.deal_won',
  category: 'trigger',
  label: 'Deal won',
  description: 'Starts when a deal moves to a stage of the "won" category.',
  icon: 'trophy',
  params,
  match: (p, ev, h) => {
    if (h.action !== 'stage_changed' || h.entity !== 'deal') return false;
    const st = (ev.payload as { stage?: { toCategory?: string; toPipelineId?: string } }).stage;
    return st?.toCategory === 'won' && (!p.pipelineId || st.toPipelineId === p.pipelineId);
  },
  execute: async (_p, rt) => ({ output: triggerOutput(rt.ctx) }),
});
