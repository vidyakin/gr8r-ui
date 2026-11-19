import { z } from 'zod';
import { defineNode } from '../types';
import { triggerOutput } from './_util';

const params = z.object({
  mailboxId: z.union([z.literal(''), z.string().uuid()]).default('').meta({ title: 'Mailbox ID', description: 'Leave empty to receive emails from all mailboxes.' }),
});

/** Входящее письмо: trigger.record — связанная запись CRM, trigger.email — письмо вместе с ящиком и отправителем. */
export default defineNode({
  type: 'trigger.email_received',
  category: 'trigger',
  label: 'Email received',
  description: 'Starts when an incoming email is saved. Provides the linked CRM record, mailbox and sender.',
  icon: 'mail',
  params,
  match: (p, ev) => ev.entity === 'email' && ev.type === 'email.received' && (!p.mailboxId || ev.payload.mailboxId === p.mailboxId),
  execute: async (_p, rt) => ({ output: { ...triggerOutput(rt.ctx), emailId: rt.ctx.trigger.email?.id ?? null, mailboxId: rt.ctx.trigger.email?.mailboxId ?? null, fromEmail: rt.ctx.trigger.email?.fromEmail ?? null } }),
});
