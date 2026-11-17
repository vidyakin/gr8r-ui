import { z } from 'zod';
import { defineNode } from '../types';
import { recordIdParam } from './_util';

const params = z.object({
  targetKind: z.enum(['document', 'contract']).default('document').meta({ title: 'Object' }),
  objectId: recordIdParam('Document or contract ID'),
});

/** Отправляет черновик документа или договор на согласование по подходящему маршруту (задача 1199). Автор процесса — автор flow */
export default defineNode({
  type: 'action.submit_approval',
  category: 'action',
  label: 'Submit for approval',
  description: 'Sends a draft document or a contract to approval along the matching route. Fails if no route matches or the process is already running.',
  icon: 'send',
  params,
  execute: async (p, rt) => {
    const id = p.objectId.trim();
    if (!id) throw new Error('Object ID is empty');
    const r = await rt.submitApproval({ targetKind: p.targetKind, objectId: id });
    return { output: { approvalId: r.approvalId, targetKind: p.targetKind, objectId: id } };
  },
});
