import { z } from 'zod';
import { COMMENTABLE_ENTITIES } from '../entities';
import { defineNode } from '../types';
import { recordIdParam } from './_util';

const params = z.object({
  entity: z.enum(COMMENTABLE_ENTITIES).default('task').meta({ title: 'Comment on' }),
  recordId: recordIdParam(),
  body: z.string().min(1).max(5000).default('Automation: {{flow.name}}').meta({ title: 'Comment', ui: 'textarea' }),
});

export default defineNode({
  type: 'action.add_comment',
  category: 'action',
  label: 'Add comment',
  description: 'Writes a comment on a task, or a note on a deal.',
  icon: 'message-square-plus',
  params,
  execute: async (p, rt) => {
    const c = await rt.addComment({ entity: p.entity, recordId: p.recordId.trim(), body: p.body });
    return { output: { commentId: c.id } };
  },
});
