import { z } from 'zod';
import { defineNode } from '../types';
import { recordIdParam } from './_util';

const params = z.object({
  dealId: recordIdParam('Deal ID'),
  pipelineId: z.string().max(64).default('').meta({ title: 'Pipeline (optional)', ui: 'deal_pipeline', description: 'Empty — the pipeline of the deal. A different pipeline moves the deal to its first stage unless a stage is chosen.' }),
  stageId: z.string().max(64).default('').meta({ title: 'Stage (optional)', ui: 'deal_stage', dependsOn: 'pipelineId' }),
  lostReason: z.string().max(200).default('').meta({ title: 'Lost reason (for a "lost" stage)', description: 'Name from the lost reasons list.' }),
});

export default defineNode({
  type: 'action.move_deal',
  category: 'action',
  label: 'Move deal to a stage',
  description: 'Moves a deal to a stage (or to the first stage of another pipeline). Required fields of the stage are checked.',
  icon: 'move-right',
  params,
  execute: async (p, rt) => {
    if (!p.stageId.trim() && !p.pipelineId.trim()) throw new Error('Choose a stage or a pipeline');
    const r = await rt.moveDeal({ dealId: p.dealId.trim(), pipelineId: p.pipelineId.trim() || null, stageId: p.stageId.trim() || null, lostReason: p.lostReason.trim() || null });
    return { output: { dealId: p.dealId.trim(), changed: r.changed, stageId: r.stageId } };
  },
});
