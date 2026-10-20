import { z } from 'zod';
import { isValidCron } from '../cron';
import { defineNode } from '../types';

const params = z.object({
  cron: z
    .string()
    .trim()
    .default('0 9 * * 1-5')
    .refine(isValidCron, 'Expected 5 cron fields: minute hour day-of-month month day-of-week')
    .meta({ title: 'Schedule (cron, UTC)', description: 'Minute, hour, day of month, month, day of week. Example: 0 9 * * 1-5 — weekdays at 09:00 UTC.', ui: 'cron' }),
});

export default defineNode({
  type: 'trigger.schedule',
  category: 'trigger',
  label: 'Schedule',
  description: 'Starts on a cron schedule (UTC, checked once a minute).',
  icon: 'clock',
  params,
  execute: async (_p, rt) => ({ output: { scheduledFor: rt.ctx.trigger.scheduledFor ?? null } }),
});
