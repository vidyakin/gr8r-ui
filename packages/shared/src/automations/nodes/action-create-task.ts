import { z } from 'zod';
import { defineNode } from '../types';

const params = z.object({
  projectId: z.string().min(1).max(200).meta({ title: 'Project', ui: 'project' }),
  title: z.string().min(1).max(500).default('Follow up').meta({ title: 'Title' }),
  description: z.string().max(5000).default('').meta({ title: 'Description', ui: 'textarea' }),
  assigneeId: z.string().max(200).default('').meta({ title: 'Assignee (optional)', ui: 'member' }),
  priority: z.string().max(20).default('').meta({ title: 'Priority 1–10 (optional)' }),
  status: z.string().max(64).default('todo').meta({ title: 'Status key' }),
  dueDate: z.string().max(20).default('').meta({ title: 'Due date YYYY-MM-DD (optional)' }),
});

export default defineNode({
  type: 'action.create_task',
  category: 'action',
  label: 'Create task',
  description: 'Creates a task in a project.',
  icon: 'list-plus',
  params,
  execute: async (p, rt) => {
    const priority = p.priority.trim() === '' ? null : Number(p.priority);
    if (priority !== null && (!Number.isInteger(priority) || priority < 1 || priority > 10)) throw new Error('Priority must be a whole number from 1 to 10');
    const t = await rt.createTask({
      projectId: p.projectId.trim(),
      title: p.title.trim(),
      description: p.description,
      assigneeId: p.assigneeId.trim() || null,
      priority,
      status: p.status.trim() || 'todo',
      dueDate: p.dueDate.trim() || null,
    });
    return { output: { taskId: t.id, key: t.key } };
  },
});
