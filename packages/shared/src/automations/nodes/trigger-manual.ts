import { z } from 'zod';
import { defineNode } from '../types';

const params = z.object({
  entity: z.string().max(64).optional().meta({ title: 'Entity of the record to run on (optional)', ui: 'entity' }),
});

export default defineNode({
  type: 'trigger.manual',
  category: 'trigger',
  label: 'Manual run',
  description: 'Starts when someone runs the flow by hand (optionally on a chosen record).',
  icon: 'play',
  params,
  execute: async (_p, rt) => ({ output: { entity: rt.ctx.trigger.entity ?? null, recordId: rt.ctx.trigger.recordId ?? null } }),
});
