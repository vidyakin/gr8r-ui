import { z } from 'zod';
import { defineNode } from '../types';

const params = z.object({
  recipientId: z.string().min(1).max(200).meta({ title: 'Recipient', ui: 'member', description: 'A member, or a substitution such as {{trigger.project.leadId}} (project lead).' }),
  text: z.string().min(1).max(500).default('Automation: attention needed').meta({ title: 'Message' }),
  snippet: z.string().max(500).default('{{trigger.record.title}}').meta({ title: 'Details (optional)' }),
  taskId: z.string().max(200).default('').meta({ title: 'Link to task (optional)', description: 'Task ID, e.g. {{trigger.recordId}} for task triggers.' }),
});

export default defineNode({
  type: 'action.notify',
  category: 'action',
  label: 'Notify member',
  description: 'Sends an in-app notification to a workspace member.',
  icon: 'bell',
  params,
  execute: async (p, rt) => {
    const n = await rt.notify({ memberId: p.recipientId.trim(), text: p.text, snippet: p.snippet, taskId: p.taskId.trim() || null });
    return { output: { notificationId: n.id, recipientId: p.recipientId.trim() } };
  },
});
