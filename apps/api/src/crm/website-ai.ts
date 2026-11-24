/* ИИ-анализ текста сайта клиента и генерация персонализированного первичного письма через OpenRouter / OpenAI-совместимый API. */
import type { CrmOutreachChannel, CrmOutreachTone, OutreachDraftResponse, WebsiteAnalysisSuccess } from '@erp/shared';
import { AppError } from '../errors';
import type { LandingAiConfig } from '../types';
import { sanitizeAssistantOutput, sanitizeUserText, type LandingFetch } from '../landing-ai/chat';

interface OpenAiJsonPayload {
  choices?: Array<{ message?: { content?: unknown } }>;
}

const aiUnavailable = (msg = 'AI assistant is temporarily unavailable') =>
  new AppError(503, 'ai_unavailable', msg);

function parseLlmJson(raw: string): Record<string, unknown> {
  const cleaned = sanitizeAssistantOutput(raw).trim();
  const fenced = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : cleaned)?.trim() ?? '';
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  const jsonStr = start >= 0 && end > start ? candidate.slice(start, end + 1) : candidate;
  const parsed: unknown = JSON.parse(jsonStr);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Expected JSON object');
  }
  return parsed as Record<string, unknown>;
}

async function callJsonLlm(
  cfg: LandingAiConfig,
  system: string,
  user: string,
  maxTokens: number,
  fetchFn: LandingFetch = fetch,
): Promise<Record<string, unknown>> {
  if (!cfg.baseUrl || !cfg.model || !cfg.apiKey) {
    throw aiUnavailable('AI is not configured');
  }
  const url = `${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`;
  let res: Response;
  try {
    res = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: sanitizeUserText(user) },
        ],
        temperature: 0.3,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(cfg.timeoutMs),
    });
  } catch {
    throw aiUnavailable();
  }
  if (!res.ok) throw aiUnavailable();

  let data: OpenAiJsonPayload;
  try {
    data = (await res.json()) as OpenAiJsonPayload;
  } catch {
    throw aiUnavailable();
  }
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw aiUnavailable();
  try {
    return parseLlmJson(content);
  } catch {
    throw aiUnavailable('AI returned invalid JSON');
  }
}

const asStr = (v: unknown, max = 1000): string =>
  typeof v === 'string' ? sanitizeAssistantOutput(v).trim().slice(0, max) : '';

const asStrList = (v: unknown, limit = 8): string[] =>
  Array.isArray(v)
    ? v
        .filter((x): x is string => typeof x === 'string')
        .map(s => sanitizeAssistantOutput(s).trim().slice(0, 200))
        .filter(Boolean)
        .slice(0, limit)
    : [];

export async function analyzeWebsiteWithAi(
  cfg: LandingAiConfig,
  text: string,
  fetchFn: LandingFetch = fetch,
): Promise<WebsiteAnalysisSuccess> {
  const system = [
    'Ты — B2B-аналитик CRM. Проанализируй текст с сайта потенциального клиента и верни строго JSON-объект без лишнего текста.',
    'Поля JSON:',
    '- "summary": краткое резюме о компании (2–3 предложения, на русском языке).',
    '- "industry": отрасль (1–4 слова).',
    '- "offerings": массив основных продуктов/услуг (до 6 коротких пунктов).',
    '- "location": город/регион/страна, если указаны (иначе пустая строка).',
    '- "potentialPains": массив из 2–4 вероятных бизнес-болей в учёте, продажах, производстве или управлении, которые может решить ERP/CRM.',
  ].join('\n');

  const parsed = await callJsonLlm(cfg, system, `Текст сайта:\n${text.slice(0, 12_000)}`, 700, fetchFn);
  return {
    fallbackNeeded: false,
    summary: asStr(parsed.summary, 1200),
    industry: asStr(parsed.industry, 200),
    offerings: asStrList(parsed.offerings, 6),
    location: asStr(parsed.location, 200),
    potentialPains: asStrList(parsed.potentialPains, 5),
  };
}

export interface OutreachDraftParams {
  channel: CrmOutreachChannel;
  tone: CrmOutreachTone;
  company?: { name?: string; industry?: string; website?: string; city?: string } | null;
  lead?: { name?: string; companyName?: string; email?: string; phone?: string; comment?: string; source?: string } | null;
  chatMessages?: Array<{ role: string; content: string }>;
  websiteSummary?: string;
  customContext?: string;
}

const CHANNEL_HINT: Record<CrmOutreachChannel, string> = {
  email: 'Канал: Email. Нужны поля "subject" (цепляющая короткая тема до 80 символов) и "body" (структурированное письмо 1–3 коротких абзаца с мягким CTA).',
  whatsapp: 'Канал: WhatsApp. Поле "subject" не нужно. Поле "body": живое короткое сообщение (3–5 предложений), удобное для чтения в мессенджере, с простым вопросом в конце.',
  linkedin: 'Канал: LinkedIn. Поле "subject" не нужно. Поле "body": лаконичное профессиональное сообщение (3–5 предложений), без спам-штампов, с мягким поводом для диалога.',
};

const TONE_HINT: Record<CrmOutreachTone, string> = {
  friendly: 'Тон: дружелюбный, человечный, уважительный на «вы».',
  formal: 'Тон: деловой, официальный, сдержанный.',
  concise: 'Тон: максимально краткий и по делу, без воды.',
};

export async function draftOutreachWithAi(
  cfg: LandingAiConfig,
  params: OutreachDraftParams,
  fetchFn: LandingFetch = fetch,
): Promise<OutreachDraftResponse> {
  const system = [
    'Ты — опытный B2B-менеджер по продажам. Напиши персонализированное первичное сообщение клиенту на русском языке.',
    'Не выдумывай факты, которых нет в контексте. Опирайся на данные компании, лида, переписку из чата и анализ сайта.',
    CHANNEL_HINT[params.channel],
    TONE_HINT[params.tone],
    'Верни строго JSON-объект вида {"subject": "...", "body": "..."} (для whatsapp/linkedin можно без subject).',
  ].join('\n');

  const lines: string[] = [];
  if (params.company) {
    lines.push(`Компания: ${[params.company.name, params.company.industry, params.company.city, params.company.website].filter(Boolean).join(' | ')}`);
  }
  if (params.lead) {
    lines.push(`Лид: ${[params.lead.name, params.lead.companyName, params.lead.email, params.lead.source].filter(Boolean).join(' | ')}`);
    if (params.lead.comment) lines.push(`Комментарий лида: ${params.lead.comment}`);
  }
  if (params.websiteSummary) lines.push(`Анализ сайта:\n${params.websiteSummary}`);
  if (params.chatMessages?.length) {
    const transcript = params.chatMessages.slice(-12).map(m => `${m.role}: ${m.content}`).join('\n');
    lines.push(`Переписка с ИИ-консультантом на сайте:\n${transcript}`);
  }
  if (params.customContext) lines.push(`Дополнительный контекст от менеджера: ${params.customContext}`);
  if (!lines.length) lines.push('Контекст минимальный: составь универсальное вежливое первичное знакомство.');

  const parsed = await callJsonLlm(cfg, system, lines.join('\n\n'), 700, fetchFn);
  const body = asStr(parsed.body, 4000);
  if (!body) throw aiUnavailable('AI returned empty draft');
  const subject = params.channel === 'email' ? asStr(parsed.subject, 200) || undefined : undefined;
  return subject ? { subject, body } : { body };
}
