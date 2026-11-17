import { z } from 'zod';
import { defineNode } from '../types';
import { triggerOutput } from './_util';

const params = z.object({
  result: z.enum(['any', 'approved', 'rejected']).default('any').meta({ title: 'Result', description: 'Approved, rejected or both. A withdrawn process does not start the flow.' }),
  targetKind: z.enum(['any', 'document', 'contract']).default('any').meta({ title: 'Object' }),
});

/** Процесс согласования завершён (задача 1199). Событие `approval.completed`: payload.result = approved | rejected, targetKind, documentId / contractId.
    Контекст запуска: `trigger.record` — строка согласования (documentId, contractId, routeName, round) */
export default defineNode({
  type: 'trigger.approval_completed',
  category: 'trigger',
  label: 'Approval completed',
  description: 'Starts when an approval process of a document or contract finishes: approved or rejected.',
  icon: 'badge-check',
  params,
  match: (p, ev, h) => {
    if (h.entity !== 'approval' || h.action !== 'completed') return false;
    const pl = ev.payload as { result?: string; targetKind?: string };
    return (p.result === 'any' || pl.result === p.result) && (p.targetKind === 'any' || pl.targetKind === p.targetKind);
  },
  execute: async (_p, rt) => ({ output: triggerOutput(rt.ctx) }),
});
