import { z } from 'zod';
import { defineNode } from '../types';
import { triggerOutput } from './_util';

export default defineNode({
  type: 'trigger.lead_created',
  category: 'trigger',
  label: 'Lead created',
  description: 'Starts when a lead is created: manually, by a website form or by an automation.',
  icon: 'user-plus',
  params: z.object({}),
  match: (_p, _ev, h) => h.action === 'created' && h.entity === 'lead',
  execute: async (_p, rt) => ({ output: triggerOutput(rt.ctx) }),
});
