import { z } from 'zod';
import { defineNode } from '../types';
import { triggerOutput } from './_util';

const params = z.object({ targetKind: z.enum(['any', 'document', 'contract']).default('any').meta({ title: 'Object' }) });

/** Этап согласования просрочен (задача 1199): событие `approval.step_overdue` пишет проход воркера один раз на задачу */
export default defineNode({
  type: 'trigger.approval_step_overdue',
  category: 'trigger',
  label: 'Approval step overdue',
  description: 'Starts once when an approver misses the deadline of an approval step.',
  icon: 'alarm-clock',
  params,
  match: (p, ev, h) => h.entity === 'approval' && h.action === 'step_overdue' && (p.targetKind === 'any' || (ev.payload as { targetKind?: string }).targetKind === p.targetKind),
  execute: async (_p, rt) => ({ output: triggerOutput(rt.ctx) }),
});
