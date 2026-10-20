import { z } from 'zod';
import { defineNode } from '../types';
import { entityParam, triggerOutput } from './_util';

const params = z.object({ entity: entityParam('Entity') });

export default defineNode({
  type: 'trigger.record_updated',
  category: 'trigger',
  label: 'Record updated',
  description: 'Starts when any field of a record of the chosen entity changes.',
  icon: 'pencil',
  params,
  match: (p, _ev, h) => h.action === 'updated' && h.entity === p.entity,
  execute: async (_p, rt) => ({ output: triggerOutput(rt.ctx) }),
});
