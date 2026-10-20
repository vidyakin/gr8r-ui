import { z } from 'zod';
import { defineNode } from '../types';
import { entityParam, triggerOutput } from './_util';

const params = z.object({ entity: entityParam('Entity') });

export default defineNode({
  type: 'trigger.record_created',
  category: 'trigger',
  label: 'Record created',
  description: 'Starts when a record of the chosen entity is created.',
  icon: 'plus-circle',
  params,
  match: (p, _ev, h) => h.action === 'created' && h.entity === p.entity,
  execute: async (_p, rt) => ({ output: triggerOutput(rt.ctx) }),
});
