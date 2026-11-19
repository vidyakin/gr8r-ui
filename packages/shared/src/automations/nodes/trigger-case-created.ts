import { z } from 'zod';
import { defineNode } from '../types';
import { triggerOutput } from './_util';

export default defineNode({
  type: 'trigger.case_created',
  category: 'trigger',
  label: 'Case created',
  description: 'Starts when a customer case is created: manually, from an email or by a website form.',
  icon: 'life-buoy',
  params: z.object({}),
  match: (_p, _ev, h) => h.action === 'created' && h.entity === 'case',
  execute: async (_p, rt) => ({ output: triggerOutput(rt.ctx) }),
});
