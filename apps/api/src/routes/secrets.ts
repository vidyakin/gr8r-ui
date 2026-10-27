/* Хранилище секретов (задача 1174а, docs/architecture/secrets.md). Всё только для admin и owner; значение принимается на запись
   и больше нигде не отдаётся: список — имя, дата, автор + признак, что на сервере задан SECRETS_KEY. */
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { deleteSecret, listSecrets, secretsAvailable, setSecret } from '@gr8r/db';
import { secretKeyParam, secretSet } from '@gr8r/shared';
import { ctxOf, validationHook } from '../crud';
import { requireRole } from '../middleware';
import type { AppEnv } from '../types';

const admin = requireRole('admin');
const docCtx = (c: ReturnType<typeof ctxOf>) => ({ workspaceId: c.workspaceId, memberId: c.memberId, role: c.role });

export const secretRoutes = new Hono<AppEnv>()
  .get('/', admin, async c => c.json({ available: secretsAvailable(), items: await listSecrets(ctxOf(c).db) }))
  .put('/:key', admin, zValidator('param', secretKeyParam, validationHook), zValidator('json', secretSet, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await setSecret(ctx.db, docCtx(ctx), c.req.valid('param').key, c.req.valid('json').value));
  })
  .delete('/:key', admin, zValidator('param', secretKeyParam, validationHook), async c => {
    const ctx = ctxOf(c);
    await deleteSecret(ctx.db, docCtx(ctx), c.req.valid('param').key);
    return c.json({ ok: true });
  });
