import { z } from 'zod';
import { defineNode } from '../types';
import { triggerOutput } from './_util';

const params = z.object({
  pipelineId: z.string().max(64).default('').meta({ title: 'Pipeline (optional)', ui: 'deal_pipeline', description: 'Empty — any pipeline.' }),
  stageId: z.string().max(64).default('').meta({ title: 'New stage (optional)', ui: 'deal_stage', dependsOn: 'pipelineId', description: 'Empty — any stage.' }),
});

export default defineNode({
  type: 'trigger.deal_stage_changed',
  category: 'trigger',
  label: 'Deal moved to a stage',
  description: 'Starts when a deal moves to another stage or pipeline, optionally to a specific pipeline or stage.',
  icon: 'git-compare-arrows',
  params,
  match: (p, ev, h) => {
    if (h.action !== 'stage_changed' || h.entity !== 'deal') return false;
    const st = (ev.payload as { stage?: { toId?: string; toPipelineId?: string } }).stage;
    if (!st) return false;
    return (!p.pipelineId || st.toPipelineId === p.pipelineId) && (!p.stageId || st.toId === p.stageId);
  },
  execute: async (_p, rt) => ({ output: triggerOutput(rt.ctx) }),
});
