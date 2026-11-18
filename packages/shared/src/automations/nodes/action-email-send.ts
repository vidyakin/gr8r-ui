import { z } from 'zod';
import { EMAIL_MAX_RECIPIENTS, isEmailAddress, splitAddresses } from '../../email';
import { defineNode } from '../types';

const params = z.object({
  mailbox: z.enum(['shared', 'owner']).default('shared').meta({ title: 'Send from', description: 'Shared mailbox, or the personal mailbox of the record owner (falls back to the shared one).' }),
  to: z.string().min(1).max(2000).default('{{trigger.record.email}}').meta({ title: 'To', placeholder: '{{trigger.record.email}}', description: 'Addresses separated by commas; placeholders {{…}} work.' }),
  subject: z.string().min(1).max(500).default('{{trigger.record.title}}').meta({ title: 'Subject' }),
  text: z.string().min(1).max(100_000).default('').meta({ title: 'Message', ui: 'textarea' }),
  link: z.boolean().default(true).meta({ title: 'Attach to the trigger record', description: 'The message appears in the history of the lead, contact, company or deal.' }),
});

/** Записи, к истории которых привязывается письмо */
const LINK_FIELD: Record<string, 'leadId' | 'contactId' | 'companyId' | 'dealId' | 'documentId'> = { lead: 'leadId', contact: 'contactId', company: 'companyId', deal: 'dealId', document: 'documentId' };

export default defineNode({
  type: 'action.email_send',
  category: 'action',
  label: 'Send email',
  description: 'Queues an email from the workspace mailbox (Settings → Mail). The message is sent by the worker and recorded in the record history.',
  icon: 'mail',
  params,
  execute: async (p, rt) => {
    const to = splitAddresses(p.to);
    if (!to.length) throw new Error('Recipient is empty');
    const bad = to.find(a => !isEmailAddress(a));
    if (bad) throw new Error(`Invalid email address: ${bad.slice(0, 100)}`);
    if (to.length > EMAIL_MAX_RECIPIENTS) throw new Error('Too many recipients');
    if (!p.subject.trim()) throw new Error('Subject is empty');
    if (!p.text.trim()) throw new Error('Message is empty');
    const tr = rt.ctx.trigger;
    const field = p.link && tr.entity && tr.recordId ? LINK_FIELD[tr.entity] : undefined;
    const ownerId = typeof tr.record?.ownerId === 'string' ? tr.record.ownerId : null;
    const r = await rt.sendEmail({ mailbox: p.mailbox, ownerId, to, subject: p.subject.trim(), text: p.text, link: field ? { [field]: tr.recordId } : undefined });
    return { output: { emailId: r.id, mailboxId: r.mailboxId, to: to.join(', ') } };
  },
});
