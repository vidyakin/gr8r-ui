import { z } from 'zod';
import { FLEET_DOC_KIND_LIST } from '../../fleet';
import { defineNode } from '../types';
import { triggerOutput } from './_util';

const params = z.object({
  documentKind: z.enum(['', ...FLEET_DOC_KIND_LIST]).default('').meta({ title: 'Document kind (optional)', description: 'Empty — any document of a vehicle or a driver.' }),
  stage: z.enum(['any', 'expiring', 'expired']).default('any').meta({ title: 'When', description: 'Expiring soon, already expired, or both.' }),
});

export default defineNode({
  type: 'trigger.fleet_document_expiring',
  category: 'trigger',
  label: 'Vehicle or driver document expires',
  description: 'Starts once when the term of a fleet document (insurance, inspection, driver license, medical certificate…) is about to end or has ended (checked daily).',
  icon: 'alarm-clock',
  params,
  match: (p, ev, h) => {
    if (h.entity !== 'fleet_document' || (h.action !== 'expiring' && h.action !== 'expired')) return false;
    if (p.stage !== 'any' && p.stage !== h.action) return false;
    const kind = (ev.payload as { documentKind?: string }).documentKind;
    return !p.documentKind || kind === p.documentKind;
  },
  execute: async (_p, rt) => ({ output: triggerOutput(rt.ctx) }),
});
