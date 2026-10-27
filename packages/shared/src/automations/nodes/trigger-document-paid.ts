import { z } from 'zod';
import { defineNode } from '../types';
import { triggerOutput } from './_util';

/** Документ расчётов (заказ, счёт, реализация…) получил оплату. Событие `document.paid` несёт `changes.remaining` — остаток к оплате:
    условие по нему («остаток = 0» — оплачен полностью) строится узлом «Условие» или триггером «Поле изменилось» */
export default defineNode({
  type: 'trigger.document_paid',
  category: 'trigger',
  label: 'Document paid',
  description: 'Starts when a payment is applied to a document. Check the remaining amount to react to full payment.',
  icon: 'wallet',
  params: z.object({ onlyFullyPaid: z.boolean().default(false).meta({ title: 'Only when fully paid' }) }),
  match: (p, ev, h) => h.entity === 'document' && h.action === 'paid' && (!p.onlyFullyPaid || ev.payload.paid === true),
  execute: async (_p, rt) => ({ output: triggerOutput(rt.ctx) }),
});
