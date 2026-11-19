/* Почта (задача 1092, docs/architecture/email.md): ящики, исходящие и входящие письма.
   Общий ящик правит admin+, личный — только владелец; пароль принимается на запись и больше нигде не отдаётся (только `hasPassword`).
   Письмо ставится в очередь, SMTP делает воркер (задача `email.send`). */
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import {
  DomainError,
  classifyMailError,
  createMailbox,
  deleteMailbox,
  enqueueEmailSync,
  getEmail,
  getMailbox,
  linkEmail,
  listEmails,
  listMailboxes,
  mailboxForCheck,
  openTransport,
  probeImap,
  queueEmail,
  retryEmail,
  saveMailboxCheck,
  updateMailbox,
} from '@erp/db';
import { emailCreate, emailLink, emailQuery, idParam, mailboxCreate, mailboxUpdate, uuid } from '@erp/shared';
import { ctxOf, validationHook } from '../crud';
import { requireRole } from '../middleware';
import type { AppEnv } from '../types';

const write = requireRole('member');
const mailCtx = (c: ReturnType<typeof ctxOf>) => ({ workspaceId: c.workspaceId, memberId: c.memberId, role: c.role });

export const mailboxRoutes = new Hono<AppEnv>()
  .get('/', async c => c.json({ items: await listMailboxes(ctxOf(c).db, mailCtx(ctxOf(c))) }))
  .post('/', write, zValidator('json', mailboxCreate, validationHook), async c => c.json(await createMailbox(ctxOf(c).db, mailCtx(ctxOf(c)), c.req.valid('json')), 201))
  .get('/:id', zValidator('param', idParam, validationHook), async c => c.json(await getMailbox(ctxOf(c).db, mailCtx(ctxOf(c)), c.req.valid('param').id)))
  .patch('/:id', write, zValidator('param', idParam, validationHook), zValidator('json', mailboxUpdate, validationHook), async c =>
    c.json(await updateMailbox(ctxOf(c).db, mailCtx(ctxOf(c)), c.req.valid('param').id, c.req.valid('json'))),
  )
  .delete('/:id', write, zValidator('param', idParam, validationHook), async c => {
    await deleteMailbox(ctxOf(c).db, mailCtx(ctxOf(c)), c.req.valid('param').id);
    return c.json({ ok: true });
  })
  .post('/:id/sync', write, zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await enqueueEmailSync(ctx.db, mailCtx(ctx), c.req.valid('param').id), 202);
  })
  // Проверка подключения: вход по SMTP и, если заполнен, по IMAP. Результат записывается в ящик; сбой проверки — не ошибка запроса
  .post('/:id/check', write, zValidator('param', idParam, validationHook), async c => {
    const ctx = ctxOf(c);
    const mc = mailCtx(ctx);
    const { id } = c.req.valid('param');
    const { mailbox, password } = await mailboxForCheck(ctx.db, mc, id);
    if (!password) throw new DomainError(422, 'mailbox_password_missing', 'The mailbox has no password');
    let error: string | null = null;
    try {
      const t = await openTransport({ host: mailbox.smtpHost, port: mailbox.smtpPort, secure: mailbox.smtpSecure, user: mailbox.smtpUser, password });
      try {
        await t.verify();
      } finally {
        t.close();
      }
      if (mailbox.imapHost && mailbox.imapPort) await probeImap({ host: mailbox.imapHost, port: mailbox.imapPort, secure: mailbox.imapSecure ?? 'ssl', user: mailbox.imapUser || mailbox.smtpUser, password });
    } catch (e) {
      error = classifyMailError(e, password).message;
    }
    const saved = await saveMailboxCheck(ctx.db, mc, id, error);
    return c.json({ ok: !error, error, mailbox: saved });
  });

export const emailRoutes = new Hono<AppEnv>()
  .get('/', zValidator('query', emailQuery, validationHook), async c => {
    const ctx = ctxOf(c);
    const q = c.req.valid('query');
    const ids = q.ids ? q.ids.split(',').filter(s => uuid.safeParse(s).success) : undefined;
    const items = await listEmails(ctx.db, mailCtx(ctx), { ...q, ids }, q.limit, q.offset);
    return c.json({ items });
  })
  .post('/', write, zValidator('json', emailCreate, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await queueEmail(ctx.db, mailCtx(ctx), c.req.valid('json')), 202);
  })
  .get('/:id', zValidator('param', idParam, validationHook), async c => c.json(await getEmail(ctxOf(c).db, mailCtx(ctxOf(c)), c.req.valid('param').id)))
  .post('/:id/link', write, zValidator('param', idParam, validationHook), zValidator('json', emailLink, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await linkEmail(ctx.db, mailCtx(ctx), c.req.valid('param').id, c.req.valid('json')));
  })
  .post('/:id/retry', write, zValidator('param', z.object({ id: uuid }), validationHook), async c => c.json(await retryEmail(ctxOf(c).db, mailCtx(ctxOf(c)), c.req.valid('param').id), 202));
