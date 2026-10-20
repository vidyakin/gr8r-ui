import { z } from 'zod';
import { defineNode } from '../types';
import { entityParam, recordIdParam } from './_util';

const params = z.object({
  entity: entityParam('Entity'),
  recordId: recordIdParam(),
  field: z.string().min(1).max(64).meta({ title: 'Field', ui: 'field', dependsOn: 'entity', writableOnly: true }),
  value: z.string().max(5000).default('').meta({ title: 'New value', ui: 'value', dependsOn: 'field', description: 'Empty clears the field. Supports {{…}} substitutions.' }),
});

export default defineNode({
  type: 'action.update_field',
  category: 'action',
  label: 'Update field',
  description: 'Sets the value of a field of a record (the value is validated like in the entity builder).',
  icon: 'square-pen',
  params,
  execute: async (p, rt) => {
    const r = await rt.updateField({ entity: p.entity, recordId: p.recordId.trim(), field: p.field, value: p.value });
    return { output: { entity: p.entity, recordId: p.recordId.trim(), field: p.field, before: r.before ?? null, after: r.after ?? null, changed: r.changed } };
  },
});
