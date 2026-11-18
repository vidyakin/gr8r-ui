/* Хранилище секретов (задача 1174а, docs/architecture/secrets.md). Всё только для admin и owner; значение принимается на запись
   и больше нигде не отдаётся: список — имя, дата, автор + признак, что на сервере задан SECRETS_KEY. */
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { DomainError, deleteSecret, listSecrets, readSecret, secretsAvailable, setSecret } from '@erp/db';
import { TELEGRAM_TOKEN_SECRET, secretKeyParam, secretSet, telegramGetMe } from '@erp/shared';
import { ctxOf, validationHook } from '../crud';
import { requireRole } from '../middleware';
import type { AppEnv } from '../types';

const admin = requireRole('admin');
const docCtx = (c: ReturnType<typeof ctxOf>) => ({ workspaceId: c.workspaceId, memberId: c.memberId, role: c.role });

export const secretRoutes = new Hono<AppEnv>()
  .get('/', admin, async c => c.json({ available: secretsAvailable(), items: await listSecrets(ctxOf(c).db) }))
  // Проверка токена бота: getMe. В ответе только имя бота, токен не возвращается
  .post('/telegram/check', admin, async c => {
    const ctx = ctxOf(c);
    const token = await readSecret(ctx.db, ctx.workspaceId, TELEGRAM_TOKEN_SECRET);
    if (!token) throw new DomainError(422, 'telegram_token_missing', 'Telegram bot token is not set');
    try {
      return c.json(await telegramGetMe(token));
    } catch (e) {
      throw new DomainError(422, 'telegram_check_failed', (e as Error).message);
    }
  })
  .put('/:key', admin, zValidator('param', secretKeyParam, validationHook), zValidator('json', secretSet, validationHook), async c => {
    const ctx = ctxOf(c);
    return c.json(await setSecret(ctx.db, docCtx(ctx), c.req.valid('param').key, c.req.valid('json').value));
  })
  .delete('/:key', admin, zValidator('param', secretKeyParam, validationHook), async c => {
    const ctx = ctxOf(c);
    await deleteSecret(ctx.db, docCtx(ctx), c.req.valid('param').key);
    return c.json({ ok: true });
  });
