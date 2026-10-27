import { z } from 'zod';
import { defineNode } from '../types';
import { triggerOutput } from './_util';

/** Оплата проведена (ПКО, РКО, поступление на счёт, списание со счёта, авансовый отчёт). Событие `document.payment_posted` */
export default defineNode({
  type: 'trigger.payment_posted',
  category: 'trigger',
  label: 'Payment posted',
  description: 'Starts when a cash or bank payment document is posted.',
  icon: 'banknote',
  params: z.object({}),
  match: (_p, ev, h) => h.entity === 'document' && h.action === 'payment_posted' && ev.type === 'document.payment_posted',
  execute: async (_p, rt) => ({ output: triggerOutput(rt.ctx) }),
});
