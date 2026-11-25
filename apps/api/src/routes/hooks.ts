/* Публичные вебхуки без сессии (задача 1175). `POST /hooks/leads/:token` — заявка с формы сайта.
   Поле-ловушка формы (`honeypot_field`) заполнено — ответ успеха без записи.
   Токен = `<workspace_id>.<секрет формы>`: воркспейс нужен для контекста RLS (данные пишутся под ним, роль app_user), секрет
   сверяется с активной формой воркспейса. Любая ошибка токена — один и тот же 404, ответ успеха не содержит данных воркспейса.
   Защита: лимит частоты по IP и по форме (таблица rate_limits), размер тела ≤ 32 КБ, CORS для форм любых сайтов. */
import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { z } from 'zod';
import { campaignByUtm, enqueueYooPayment, findEnabledCaseForm, findEnabledForm, insertLead, isUuid, parseFormToken, parsePriceToken, pickRoundRobin, publicPriceList, readMyModules, readMyReadableModules, submitCaseForm, withContext } from '@erp/db';
import { caseWebhookBody, isHoneypotHit, leadWebhookBody, pickUtm, yooWebhookBody } from '@erp/shared';
import { AppError } from '../errors';
import { allowPublicRequest as allow } from '../public-rate-limit';
import { callLandingLlm, honeypotReply, landingChatBody, parseStageDirective, readSessionScriptState, saveLandingChatTurn } from '../landing-ai/chat';
import { buildWidgetSystemPrompt, type LandingLocale } from '../landing-ai/knowledge';
import { DEFAULT_AI_CHAT_SETTINGS, readWorkspaceAiChatSettings } from '../landing-ai/settings';
import { createWidgetHandoffChat, isOriginAllowed, resolveWidgetWorkspace } from '../landing-ai/widget-handoff';
import { isYooKassaIp } from '../yookassa-ip';
import type { AppEnv } from '../types';

const widgetHandoffBody = z.object({
  sessionId: z.string().uuid().optional(),
  visitorName: z.string().trim().max(80).optional(),
  pageUrl: z.string().trim().max(300).optional(),
  locale: z.enum(['ru', 'en', 'es']).default('ru'),
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().trim().min(1).max(2000),
      }),
    )
    .max(10)
    .optional(),
});

const MAX_BODY = 32 * 1024;
const CHAT_MAX_BODY = 16 * 1024;

const notFound = () => new AppError(404, 'not_found', 'Not found');

/** Тело вебхука формы: JSON или form-urlencoded, не больше MAX_BODY */
async function readHookBody(c: Context<AppEnv>): Promise<Record<string, unknown>> {
  if (Number(c.req.header('content-length') ?? 0) > MAX_BODY) throw new AppError(400, 'payload_too_large', 'Request body is too large');
  const ctype = c.req.header('content-type') ?? '';
  try {
    if (ctype.includes('application/json')) {
      const text = await c.req.text();
      if (text.length > MAX_BODY) throw new Error('large');
      const j = JSON.parse(text) as unknown;
      return j && typeof j === 'object' && !Array.isArray(j) ? (j as Record<string, unknown>) : {};
    }
    return (await c.req.parseBody()) as Record<string, unknown>;
  } catch {
    throw new AppError(400, 'validation_error', 'Request body must be JSON or a form');
  }
}


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
    const data = await withContext(sql, { workspaceId: parsed.workspaceId }, async db => {
      if (!(await readMyReadableModules(db)).has('trade')) return null; // модуль выключен: как несуществующая ссылка
      return publicPriceList(db, parsed.workspaceId, parsed.secret, { q, limit, offset });
    });
    if (!data) throw notFound();
    c.header('Cache-Control', 'no-store');
    c.header('X-Content-Type-Options', 'nosniff');
    return c.json(data);
  })
  .use('/cases/*', cors({ origin: '*', allowMethods: ['POST', 'OPTIONS'], allowHeaders: ['Content-Type'], maxAge: 86400 }))
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

    const raw = await readHookBody(c);

    await withContext(sql, { workspaceId: parsed.workspaceId }, async db => {
      if (!(await readMyModules(db)).has('crm')) throw notFound(); // модуль выключен: как несуществующая форма
      const form = await findEnabledForm(db, parsed.secret);
      if (!form) throw notFound();
      // ловушка для ботов — до проверки полей: бот получает обычный успех и не узнаёт, что заявка отброшена
      if (isHoneypotHit(raw, form.honeypotField)) return;
      const body = leadWebhookBody.safeParse(raw);
      if (!body.success) throw new AppError(400, 'validation_error', 'Invalid fields');
      const b = body.data;
      if (!b.name && !b.phone && !b.email) throw new AppError(422, 'validation_error', 'Provide at least a name, a phone or an email');
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
  // Форма обращений на сайте (docs/architecture/cases.md): токен и защита те же, что у форм лидов
  .post('/cases/:token', async c => {
    const cfg = c.get('config');
    const sql = c.get('sql');
    const windowSec = Math.ceil(cfg.leadHookRateLimitWindowMs / 1000);
    if (!(await allow(sql, `case-hook:ip:${c.get('ip')}`, cfg.leadHookRateLimitMax, windowSec))) throw new AppError(429, 'rate_limited', 'Too many requests. Try again later.', { retryAfterSeconds: windowSec });
    const parsed = parseFormToken(c.req.param('token'));
    if (!parsed) throw notFound();
    if (!(await allow(sql, `case-hook:form:${parsed.secret.slice(0, 16)}`, cfg.leadHookRateLimitMax * 10, windowSec))) throw new AppError(429, 'rate_limited', 'Too many requests. Try again later.', { retryAfterSeconds: windowSec });
    const raw = await readHookBody(c);
    await withContext(sql, { workspaceId: parsed.workspaceId }, async db => {
      if (!(await readMyModules(db)).has('crm')) throw notFound(); // модуль выключен: как несуществующая форма
      const form = await findEnabledCaseForm(db, parsed.secret);
      if (!form) throw notFound();
      if (isHoneypotHit(raw, form.honeypotField)) return; // ловушка для ботов: обычный успех без записи
      const body = caseWebhookBody.safeParse(raw);
      if (!body.success) throw new AppError(400, 'validation_error', 'Invalid fields');
      const b = body.data;
      if (!b.subject && !b.message) throw new AppError(422, 'validation_error', 'Provide a subject or a message');
      if (!b.email && !b.phone && !b.name) throw new AppError(422, 'validation_error', 'Provide a name, an email or a phone');
      await submitCaseForm(db, parsed.workspaceId, form, b);
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
      await withContext(sql, { workspaceId }, async db => {
        if ((await readMyModules(db)).has('integrations')) await enqueueYooPayment(db, workspaceId, paymentId); // модуль выключен: платёж не обрабатываем, ответ прежний
      });
    }
    return c.json({ ok: true as const });
  })
  // Публичный ИИ-консультант лендинга: строгий CORS, 16 КБ, honeypot, тройной rate-limit (IP 10м/сутки + общий) и OpenAI SSE/JSON
  .use('/chat/*', async (c, next) => {
    const allowed = c.get('config').landingAi.origins;
    return cors({
      origin: origin => (allowed.includes(origin) ? origin : null),
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: ['Content-Type'],
      maxAge: 86400,
    })(c, next);
  })
  .get('/chat/config', async c => {
    const rawLocale = c.req.query('locale');
    const locale: LandingLocale = rawLocale === 'en' || rawLocale === 'es' ? rawLocale : 'ru';
    const ai = c.get('config').landingAi;
    const sql = c.get('sql');
    let greeting: string | null = null;
    if (ai.workspaceId && sql) {
      const settings = await readWorkspaceAiChatSettings(sql, ai.workspaceId).catch(() => DEFAULT_AI_CHAT_SETTINGS);
      greeting = settings.greeting[locale] || null;
    }
    c.header('Cache-Control', 'public, max-age=60');
    return c.json({ greeting });
  })
  .post('/chat', async c => {
    const cfg = c.get('config');
    const ai = cfg.landingAi;
    const origin = c.req.header('origin');
    if (origin !== undefined && !ai.origins.includes(origin)) {
      throw new AppError(403, 'forbidden_origin', 'Origin is not allowed');
    }
    if (Number(c.req.header('content-length') ?? 0) > CHAT_MAX_BODY) {
      throw new AppError(413, 'payload_too_large', 'Request body is too large');
    }
    let raw: unknown;
    try {
      const text = await c.req.text();
      if (Buffer.byteLength(text, 'utf8') > CHAT_MAX_BODY) {
        throw new AppError(413, 'payload_too_large', 'Request body is too large');
      }
      raw = JSON.parse(text);
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError(400, 'validation_error', 'Request body must be JSON');
    }
    const body = landingChatBody.safeParse(raw);
    if (!body.success) throw new AppError(400, 'validation_error', 'Invalid chat request');
    const { sessionId, visitorName, pageUrl, locale, messages, stream, website } = body.data;

    if (website && website.trim().length > 0) {
      const reply = honeypotReply(locale);
      if (stream) {
        return new Response(`data: ${JSON.stringify({ delta: reply })}\n\ndata: [DONE]\n\n`, {
          headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform' },
        });
      }
      return c.json({ reply });
    }

    if (!ai.baseUrl || !ai.model || !ai.apiKey) {
      throw new AppError(503, 'ai_not_configured', 'AI assistant is not configured');
    }

    const sql = c.get('sql');
    const ip = c.get('ip');
    if (!(await allow(sql, `chat-hook:ip10m:${ip}`, ai.rateIp10m, 600))) {
      throw new AppError(429, 'rate_limited', 'Too many requests. Try again later.', { retryAfter: 600, retryAfterSeconds: 600 });
    }
    if (!(await allow(sql, `chat-hook:ipday:${ip}`, ai.rateIpDay, 86400))) {
      throw new AppError(429, 'rate_limited', 'Daily limit reached. Try again tomorrow.', { retryAfter: 86400, retryAfterSeconds: 86400 });
    }
    if (!(await allow(sql, 'chat-hook:global:day', ai.rateGlobalDay, 86400))) {
      throw new AppError(429, 'rate_limited', 'Service daily quota reached. Try again later.', { retryAfter: 86400, retryAfterSeconds: 86400 });
    }

    const askedAt = new Date().toISOString();
    const userMessage = messages[messages.length - 1]!.content;
    const userAgent = c.req.header('user-agent') ?? null;
    const chatSettings = sql
      ? await readWorkspaceAiChatSettings(sql, ai.workspaceId).catch(() => DEFAULT_AI_CHAT_SETTINGS)
      : DEFAULT_AI_CHAT_SETTINGS;
    const style = { tone: chatSettings.tone, customToneNote: chatSettings.customToneNote };
    const scriptActive = chatSettings.script.enabled && chatSettings.script.nodes.length > 0;
    const scriptState = scriptActive && Boolean(sql) && sessionId
      ? await readSessionScriptState(sql, ai.workspaceId, sessionId).catch(() => ({ currentNodeId: null, collectedData: {} }))
      : { currentNodeId: null, collectedData: {} };
    const scriptCtx = scriptActive
      ? { script: chatSettings.script, currentNodeId: scriptState.currentNodeId, collectedData: scriptState.collectedData }
      : undefined;
    const validNodeIds = new Set(chatSettings.script.nodes.map(n => n.id));
    const fallbackNodeId = scriptActive
      ? (scriptState.currentNodeId ?? chatSettings.script.nodes.find(n => n.kind === 'start')?.id ?? chatSettings.script.nodes[0]?.id ?? null)
      : null;

    const persist = (rawReply: string) => {
      const parsed = scriptActive
        ? parseStageDirective(rawReply, validNodeIds)
        : { cleanText: rawReply, nextNodeId: null, extracted: {} };
      return saveLandingChatTurn(sql, {
        workspaceId: ai.workspaceId,
        sessionId,
        visitorName,
        ip,
        userAgent,
        locale,
        pageUrl,
        userMessage,
        assistantReply: parsed.cleanText || rawReply,
        askedAt,
        currentNodeId: parsed.nextNodeId ?? fallbackNodeId,
        collectedData: parsed.extracted,
      }).catch(err => console.error('[landing-chat] failed to save history:', err));
    };

    if (stream) {
      const sse = await callLandingLlm(ai, locale, messages, true, fetch, persist, style, scriptCtx);
      return new Response(sse, {
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          'X-Accel-Buffering': 'no',
        },
      });
    }
    const result = await callLandingLlm(ai, locale, messages, false, fetch, persist, style, scriptCtx);
    return c.json(result);
  })
  // Мультитенантный встраиваемый ИИ-виджет для сайтов клиентов:
  // токен <workspace_id>.<secret>, проверка allowedOrigins, per-workspace rate-limit и handoff в модуль «Чаты»
  .use('/widget/*', cors({ origin: origin => origin || '*', allowMethods: ['GET', 'POST', 'OPTIONS'], allowHeaders: ['Content-Type'], maxAge: 86400 }))
  .get('/widget/:token/config', async c => {
    const parsed = parseFormToken(c.req.param('token'));
    if (!parsed) throw notFound();
    const sql = c.get('sql');
    const widget = await resolveWidgetWorkspace(sql, parsed.workspaceId, parsed.secret);
    if (!widget) throw notFound();
    const origin = c.req.header('origin');
    if (!isOriginAllowed(origin, widget.settings.allowedOrigins)) {
      throw new AppError(403, 'forbidden_origin', 'Origin is not allowed');
    }
    const rawLocale = c.req.query('locale');
    const locale: LandingLocale = rawLocale === 'en' || rawLocale === 'es' ? rawLocale : 'ru';
    c.header('Cache-Control', 'no-store');
    return c.json({
      botName: widget.settings.botName || widget.workspaceName,
      accentColor: widget.settings.accentColor,
      position: widget.settings.position,
      greeting: widget.settings.greeting[locale] || null,
      handoffEnabled: widget.settings.handoffEnabled,
      soundEnabled: widget.settings.soundEnabled,
    });
  })
  .post('/widget/:token/chat', async c => {
    const parsed = parseFormToken(c.req.param('token'));
    if (!parsed) throw notFound();
    const cfg = c.get('config');
    const ai = cfg.landingAi;
    const sql = c.get('sql');
    const widget = await resolveWidgetWorkspace(sql, parsed.workspaceId, parsed.secret);
    if (!widget) throw notFound();

    const origin = c.req.header('origin');
    if (!isOriginAllowed(origin, widget.settings.allowedOrigins)) {
      throw new AppError(403, 'forbidden_origin', 'Origin is not allowed');
    }
    if (Number(c.req.header('content-length') ?? 0) > CHAT_MAX_BODY) {
      throw new AppError(413, 'payload_too_large', 'Request body is too large');
    }
    let raw: unknown;
    try {
      const text = await c.req.text();
      if (Buffer.byteLength(text, 'utf8') > CHAT_MAX_BODY) {
        throw new AppError(413, 'payload_too_large', 'Request body is too large');
      }
      raw = JSON.parse(text);
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError(400, 'validation_error', 'Request body must be JSON');
    }
    const body = landingChatBody.safeParse(raw);
    if (!body.success) throw new AppError(400, 'validation_error', 'Invalid chat request');
    const { sessionId, visitorName, pageUrl, locale, messages, stream, website } = body.data;

    if (website && website.trim().length > 0) {
      const reply = honeypotReply(locale);
      if (stream) {
        return new Response(`data: ${JSON.stringify({ delta: reply })}\n\ndata: [DONE]\n\n`, {
          headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform' },
        });
      }
      return c.json({ reply });
    }

    if (!ai.baseUrl || !ai.model || !ai.apiKey) {
      throw new AppError(503, 'ai_not_configured', 'AI assistant is not configured');
    }

    const ip = c.get('ip');
    if (!(await allow(sql, `widget-chat:ip10m:${ip}`, ai.rateIp10m, 600))) {
      throw new AppError(429, 'rate_limited', 'Too many requests. Try again later.', { retryAfter: 600, retryAfterSeconds: 600 });
    }
    if (!(await allow(sql, `widget-chat:ipday:${ip}`, ai.rateIpDay, 86400))) {
      throw new AppError(429, 'rate_limited', 'Daily limit reached. Try again tomorrow.', { retryAfter: 86400, retryAfterSeconds: 86400 });
    }
    if (!(await allow(sql, `widget-chat:wsday:${widget.workspaceId}`, widget.settings.dailyLimit, 86400))) {
      throw new AppError(429, 'rate_limited', 'Workspace daily quota reached. Try again later.', { retryAfter: 86400, retryAfterSeconds: 86400 });
    }

    const askedAt = new Date().toISOString();
    const userMessage = messages[messages.length - 1]!.content;
    const userAgent = c.req.header('user-agent') ?? null;
    const chatSettings = widget.settings;
    const scriptActive = chatSettings.script.enabled && chatSettings.script.nodes.length > 0;
    const scriptState = scriptActive && sessionId
      ? await readSessionScriptState(sql, widget.workspaceId, sessionId).catch(() => ({ currentNodeId: null, collectedData: {} }))
      : { currentNodeId: null, collectedData: {} };
    const scriptCtx = scriptActive
      ? { script: chatSettings.script, currentNodeId: scriptState.currentNodeId, collectedData: scriptState.collectedData }
      : undefined;
    const validNodeIds = new Set(chatSettings.script.nodes.map(n => n.id));
    const fallbackNodeId = scriptActive
      ? (scriptState.currentNodeId ?? chatSettings.script.nodes.find(n => n.kind === 'start')?.id ?? chatSettings.script.nodes[0]?.id ?? null)
      : null;

    const systemPrompt = buildWidgetSystemPrompt(
      locale,
      {
        botName: chatSettings.botName,
        workspaceName: widget.workspaceName,
        knowledgeBase: chatSettings.knowledgeBase,
        tone: chatSettings.tone,
        customToneNote: chatSettings.customToneNote,
        handoffEnabled: chatSettings.handoffEnabled,
      },
      scriptCtx,
    );

    const persist = (rawReply: string) => {
      const parsedReply = scriptActive
        ? parseStageDirective(rawReply, validNodeIds)
        : { cleanText: rawReply, nextNodeId: null, extracted: {} };
      return saveLandingChatTurn(sql, {
        workspaceId: widget.workspaceId,
        sessionId,
        visitorName,
        ip,
        userAgent,
        locale,
        pageUrl,
        userMessage,
        assistantReply: parsedReply.cleanText || rawReply,
        askedAt,
        currentNodeId: parsedReply.nextNodeId ?? fallbackNodeId,
        collectedData: parsedReply.extracted,
      }).catch(err => console.error('[widget-chat] failed to save history:', err));
    };

    if (stream) {
      const sse = await callLandingLlm(ai, locale, messages, true, fetch, persist, undefined, scriptCtx, systemPrompt);
      return new Response(sse, {
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          'X-Accel-Buffering': 'no',
        },
      });
    }
    const result = await callLandingLlm(ai, locale, messages, false, fetch, persist, undefined, scriptCtx, systemPrompt);
    return c.json(result);
  })
  .post('/widget/:token/handoff', async c => {
    const parsed = parseFormToken(c.req.param('token'));
    if (!parsed) throw notFound();
    const sql = c.get('sql');
    const widget = await resolveWidgetWorkspace(sql, parsed.workspaceId, parsed.secret);
    if (!widget || !widget.settings.handoffEnabled) throw notFound();
    const origin = c.req.header('origin');
    if (!isOriginAllowed(origin, widget.settings.allowedOrigins)) {
      throw new AppError(403, 'forbidden_origin', 'Origin is not allowed');
    }
    const ip = c.get('ip');
    if (!(await allow(sql, `widget-handoff:ip:${ip}`, 10, 3600))) {
      throw new AppError(429, 'rate_limited', 'Too many requests. Try again later.', { retryAfter: 3600, retryAfterSeconds: 3600 });
    }
    let raw: unknown = {};
    try {
      const text = await c.req.text();
      if (text.length > CHAT_MAX_BODY) throw new AppError(413, 'payload_too_large', 'Request body is too large');
      if (text.trim()) raw = JSON.parse(text);
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError(400, 'validation_error', 'Request body must be JSON');
    }
    const body = widgetHandoffBody.safeParse(raw);
    if (!body.success) throw new AppError(400, 'validation_error', 'Invalid handoff request');
    const created = await createWidgetHandoffChat(sql, c.get('config').landingAi, {
      workspaceId: widget.workspaceId,
      ...body.data,
    });
    return c.json(created, 201);
  });
