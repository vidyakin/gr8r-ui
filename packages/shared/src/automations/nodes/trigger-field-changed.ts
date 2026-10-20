import { z } from 'zod';
import { stringifyValue } from '../template';
import { defineNode } from '../types';
import { entityParam, triggerOutput } from './_util';

const params = z.object({
  entity: entityParam('Entity'),
  field: z.string().min(1).max(64).meta({ title: 'Field', ui: 'field', dependsOn: 'entity' }),
  from: z.string().max(200).optional().meta({ title: 'Changed from (optional)', ui: 'value', dependsOn: 'field' }),
  to: z.string().max(200).optional().meta({ title: 'Changed to (optional)', ui: 'value', dependsOn: 'field' }),
});

export default defineNode({
  type: 'trigger.field_changed',
  category: 'trigger',
  label: 'Field changed',
  description: 'Starts when a field of a record changes, optionally to a specific value.',
  icon: 'pencil-line',
  params,
  match: (p, _ev, h) => {
    if (h.action !== 'updated' || h.entity !== p.entity) return false;
    const ch = h.changes[p.field];
    if (!ch) return false;
    if (p.to !== undefined && p.to !== '' && stringifyValue(ch.to) !== p.to) return false;
    if (p.from !== undefined && p.from !== '' && stringifyValue(ch.from) !== p.from) return false;
    return true;
  },
  execute: async (_p, rt) => ({ output: triggerOutput(rt.ctx) }),
});
