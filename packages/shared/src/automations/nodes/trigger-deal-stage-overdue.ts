import { z } from 'zod';
import { defineNode } from '../types';
import { triggerOutput } from './_util';

const params = z.object({
  pipelineId: z.string().max(64).default('').meta({ title: 'Pipeline (optional)', ui: 'deal_pipeline', description: 'Empty — any pipeline.' }),
  stageId: z.string().max(64).default('').meta({ title: 'Stage (optional)', ui: 'deal_stage', dependsOn: 'pipelineId', description: 'Empty — any stage.' }),
});

export default defineNode({
  type: 'trigger.deal_stage_overdue',
  category: 'trigger',
  label: 'Deal exceeded the stage time limit',
  description: 'Starts once, when a deal has stayed on a stage longer than the stage time limit (checked on a schedule).',
  icon: 'alarm-clock',
  params,
  match: (p, ev, h) => {
    if (h.action !== 'stage_overdue' || h.entity !== 'deal') return false;
    const st = (ev.payload as { stage?: { toId?: string; toPipelineId?: string } }).stage;
    if (!st) return false;
    return (!p.pipelineId || st.toPipelineId === p.pipelineId) && (!p.stageId || st.toId === p.stageId);
  },
  execute: async (_p, rt) => ({ output: triggerOutput(rt.ctx) }),
});
