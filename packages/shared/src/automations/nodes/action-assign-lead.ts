import { z } from 'zod';
import { defineNode } from '../types';
import { recordIdParam } from './_util';

const params = z.object({
  leadId: recordIdParam('Lead ID'),
  mode: z.enum(['round_robin', 'manual']).default('round_robin').meta({ title: 'Assign', description: 'round_robin: in turn among members whose position has the sales manager function; manual: the member below.' }),
  memberId: z.string().max(200).default('').meta({ title: 'Member (for manual)', ui: 'member' }),
});

export default defineNode({
  type: 'action.assign_lead',
  category: 'action',
  label: 'Assign lead owner',
  description: 'Sets the responsible member of a lead: manually or in turn among sales managers.',
  icon: 'user-check',
  params,
  execute: async (p, rt) => {
    if (p.mode === 'manual' && !p.memberId.trim()) throw new Error('Member is required for manual assignment');
    const r = await rt.assignLead({ leadId: p.leadId.trim(), mode: p.mode, memberId: p.memberId.trim() || null });
    return { output: { leadId: p.leadId.trim(), ownerId: r.ownerId, changed: r.changed } };
  },
});
