/* Публичные вебхуки без сессии (задача 1175). `POST /hooks/leads/:token` — заявка с формы сайта.
   Токен = `<workspace_id>.<секрет формы>`: воркспейс нужен для контекста RLS (данные пишутся под ним, роль app_user), секрет
   сверяется с активной формой воркспейса. Любая ошибка токена — один и тот же 404, ответ успеха не содержит данных воркспейса.
   Защита: лимит частоты по IP и по форме (таблица rate_limits), размер тела ≤ 32 КБ, CORS для форм любых сайтов. */
import { sql as dsql } from 'drizzle-orm';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { campaignByUtm, enqueueYooPayment, findEnabledForm, insertLead, isUuid, parseFormToken, parsePriceToken, pickRoundRobin, publicPriceList, rateLimits, withContext, type Sql } from '@gr8r/db';
import { leadWebhookBody, pickUtm, yooWebhookBody } from '@gr8r/shared';
import { AppError } from '../errors';
import { isYooKassaIp } from '../yookassa-ip';
import type { AppEnv } from '../types';

const MAX_BODY = 32 * 1024;

/** Учитывает обращение и возвращает false, если лимит окна исчерпан (счётчик коммитится отдельной транзакцией) */
async function allow(sql: Sql, key: string, max: number, windowSec: number): Promise<boolean> {
  const hits = await withContext(sql, {}, async db => {
    const [r] = await db
      .insert(rateLimits)
      .values({ key, hits: 1 })
      .onConflictDoUpdate({
        target: rateLimits.key,
        set: {
          hits: dsql`case when ${rateLimits.windowStart} < now() - make_interval(secs => ${windowSec}) then 1 else ${rateLimits.hits} + 1 end`,
          windowStart: dsql`case when ${rateLimits.windowStart} < now() - make_interval(secs => ${windowSec}) then now() else ${rateLimits.windowStart} end`,
        },
      })
      .returning({ hits: rateLimits.hits });
    return r!.hits;
  });
  return hits <= max;
}

const notFound = () => new AppError(404, 'not_found', 'Not found');

export const hookRoutes = new Hono<AppEnv>()
  // Публичный прайс-лист по ссылке (задача 1178): без сессии, данные — только разрешённые ссылкой (виды цен без закупочных, без остатков).
  // Любая причина отказа — один и тот же 404; лимит частоты по IP (до разбора токена) и по ссылке
  .get('/prices/:token', async c => {
    const cfg = c.get('config');
    const sql = c.get('sql');
    const windowSec = Math.ceil(cfg.leadHookRateLimitWindowMs / 1000);
    if (!(await allow(sql, `price-hook:ip:${c.get('ip')}`, cfg.leadHookRateLimitMax, windowSec))) throw new AppError(429, 'rate_limited', 'Too many requests. Try again later.', { retryAfterSeconds: windowSec });
    const parsed = parsePriceToken(c.req.param('token'));
    if (!parsed) throw notFound();
    if (!(await allow(sql, `price-hook:link:${parsed.secret.slice(0, 16)}`, cfg.leadHookRateLimitMax * 10, windowSec))) throw new AppError(429, 'rate_limited', 'Too many requests. Try again later.', { retryAfterSeconds: windowSec });
    const q = c.req.query('q')?.trim().slice(0, 100);
    const limit = Math.min(500, Math.max(1, Number(c.req.query('limit')) || 200));
    const offset = Math.max(0, Number(c.req.query('offset')) || 0);
    const data = await withContext(sql, { workspaceId: parsed.workspaceId }, db => publicPriceList(db, parsed.workspaceId, parsed.secret, { q, limit, offset }));
    if (!data) throw notFound();
    c.header('Cache-Control', 'no-store');
    c.header('X-Content-Type-Options', 'nosniff');
    return c.json(data);
  })
  .use('/leads/*', cors({ origin: '*', allowMethods: ['POST', 'OPTIONS'], allowHeaders: ['Content-Type'], maxAge: 86400 }))
  .post('/leads/:token', async c => {
    const cfg = c.get('config');
    const sql = c.get('sql');
    const windowSec = Math.ceil(cfg.leadHookRateLimitWindowMs / 1000);
    // лимит по IP — до разбора токена, чтобы перебор токенов упирался в него
    if (!(await allow(sql, `lead-hook:ip:${c.get('ip')}`, cfg.leadHookRateLimitMax, windowSec))) throw new AppError(429, 'rate_limited', 'Too many requests. Try again later.', { retryAfterSeconds: windowSec });

    const parsed = parseFormToken(c.req.param('token'));
    if (!parsed) throw notFound();
    if (!(await allow(sql, `lead-hook:form:${parsed.secret.slice(0, 16)}`, cfg.leadHookRateLimitMax * 10, windowSec))) throw new AppError(429, 'rate_limited', 'Too many requests. Try again later.', { retryAfterSeconds: windowSec });

    if (Number(c.req.header('content-length') ?? 0) > MAX_BODY) throw new AppError(400, 'payload_too_large', 'Request body is too large');
    const ctype = c.req.header('content-type') ?? '';
    let raw: Record<string, unknown>;
    try {
      if (ctype.includes('application/json')) {
        const text = await c.req.text();
        if (text.length > MAX_BODY) throw new Error('large');
        const j = JSON.parse(text) as unknown;
        raw = j && typeof j === 'object' && !Array.isArray(j) ? (j as Record<string, unknown>) : {};
      } else {
        raw = (await c.req.parseBody()) as Record<string, unknown>;
      }
    } catch {
      throw new AppError(400, 'validation_error', 'Request body must be JSON or a form');
    }
    const body = leadWebhookBody.safeParse(raw);
    if (!body.success) throw new AppError(400, 'validation_error', 'Invalid fields');
    const b = body.data;
    if (!b.name && !b.phone && !b.email) throw new AppError(422, 'validation_error', 'Provide at least a name, a phone or an email');

    await withContext(sql, { workspaceId: parsed.workspaceId }, async db => {
      const form = await findEnabledForm(db, parsed.secret);
      if (!form) throw notFound();
      const ownerId = form.defaultOwnerId ?? (await pickRoundRobin(db, parsed.workspaceId));
      const custom = pickUtm(b as Record<string, unknown>);
      // атрибуция (задача 1177): кампания по utm_campaign, иначе кампания / источник формы, иначе название источника формы
      const byUtm = typeof custom.utm_campaign === 'string' ? await campaignByUtm(db, custom.utm_campaign) : null;
      const attr = byUtm ? { campaignId: byUtm.id } : form.campaignId ? { campaignId: form.campaignId } : form.sourceId ? { sourceId: form.sourceId } : { source: form.source || form.name };
      await insertLead(
        db,
        { workspaceId: parsed.workspaceId, memberId: null },
        { name: b.name || b.phone || b.email, companyName: b.company, phone: b.phone, email: b.email, comment: b.comment, ...attr, ownerId, formId: form.id, custom },
      );
    });
    return c.json({ ok: true as const }, 201);
  })
  // Вебхук ЮКассы. Телу не верим: берём только id платежа, воркер перепроверяет статус запросом к API ЮКассы. Ответ всегда один и тот же —
  // не раскрывает, есть ли такой платёж и воркспейс; ЮКасса повторяет запрос, пока не получит 200
  .post('/yookassa/:workspaceId', async c => {
    const cfg = c.get('config');
    const sql = c.get('sql');
    const windowSec = Math.ceil(cfg.leadHookRateLimitWindowMs / 1000);
    // отправитель — только адреса ЮКассы (за прокси адрес берётся из X-Forwarded-For при TRUST_PROXY); остальным один и тот же отказ
    if (cfg.yookassaIpCheck && !isYooKassaIp(c.get('ip'))) throw new AppError(403, 'forbidden', 'Forbidden');
    if (!(await allow(sql, `yookassa-hook:ip:${c.get('ip')}`, cfg.leadHookRateLimitMax * 10, windowSec))) throw new AppError(429, 'rate_limited', 'Too many requests. Try again later.', { retryAfterSeconds: windowSec });
    const workspaceId = c.req.param('workspaceId');
    if (!isUuid(workspaceId)) throw notFound();
    if (Number(c.req.header('content-length') ?? 0) > MAX_BODY) throw new AppError(400, 'payload_too_large', 'Request body is too large');
    let raw: unknown;
    try {
      const text = await c.req.text();
      if (text.length > MAX_BODY) throw new Error('large');
      raw = JSON.parse(text);
    } catch {
      throw new AppError(400, 'validation_error', 'Request body must be JSON');
    }
    const body = yooWebhookBody.safeParse(raw);
    if (!body.success) throw new AppError(400, 'validation_error', 'Invalid notification');
    if (body.data.event === 'payment.succeeded' || body.data.event === 'payment.canceled') {
      const paymentId = body.data.object.id;
      await withContext(sql, { workspaceId }, db => enqueueYooPayment(db, workspaceId, paymentId));
    }
    return c.json({ ok: true as const });
  });
