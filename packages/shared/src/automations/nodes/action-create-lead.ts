import { z } from 'zod';
import { defineNode } from '../types';

const params = z.object({
  name: z.string().min(1).max(200).default('New lead').meta({ title: 'Name' }),
  companyName: z.string().max(200).default('').meta({ title: 'Company (optional)' }),
  phone: z.string().max(50).default('').meta({ title: 'Phone (optional)' }),
  email: z.string().max(254).default('').meta({ title: 'Email (optional)' }),
  comment: z.string().max(5000).default('').meta({ title: 'Comment', ui: 'textarea' }),
  source: z.string().max(200).default('Automation').meta({ title: 'Source' }),
  ownerId: z.string().max(200).default('').meta({ title: 'Owner (optional)', ui: 'member' }),
});

export default defineNode({
  type: 'action.create_lead',
  category: 'action',
  label: 'Create lead',
  description: 'Creates a lead in the first status of the "new" category.',
  icon: 'user-round-plus',
  params,
  execute: async (p, rt) => {
    const l = await rt.createLead({ name: p.name.trim(), companyName: p.companyName, phone: p.phone, email: p.email, comment: p.comment, source: p.source, ownerId: p.ownerId.trim() || null });
    return { output: { leadId: l.id } };
  },
});
