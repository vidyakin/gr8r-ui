import { z } from 'zod';
import { defineNode } from '../types';
import { triggerOutput } from './_util';

const params = z.object({
  stage: z.enum(['any', 'started', 'completed']).default('any').meta({ title: 'When', description: 'The trip is sent, completed, or either.' }),
});

export default defineNode({
  type: 'trigger.trip_status',
  category: 'trigger',
  label: 'Trip sent or completed',
  description: 'Starts when a trip leaves (status "in transit") or is completed. The payload has the trip number, vehicle and driver.',
  icon: 'truck',
  params,
  match: (p, _ev, h) => {
    if (h.entity !== 'fleet_trip' || (h.action !== 'started' && h.action !== 'completed')) return false;
    return p.stage === 'any' || p.stage === h.action;
  },
  execute: async (_p, rt) => ({ output: triggerOutput(rt.ctx) }),
});
