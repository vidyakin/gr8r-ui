/* Провайдеры машинного перевода: OpenRouter (контекстный LLM), DeepL и Azure Translator. */
import { sanitizeAssistantOutput, sanitizeUserText, type LandingFetch } from '../landing-ai/chat';
import type { LandingAiConfig } from '../types';

export interface ProviderAttempt {
  text: string;
  provider: 'openrouter' | 'deepl' | 'azure';
}

interface OpenAiChatResponse {
  choices?: Array<{ message?: { content?: unknown } }>;
}

interface DeepLResponse {
  translations?: Array<{ text?: unknown }>;
}

interface AzureItem {
  translations?: Array<{ text?: unknown }>;
}

const TRANSLATOR_TIMEOUT_MS = 12_000;

export const normalizeCompare = (s: string): string =>
  s.trim().replace(/\s+/g, ' ').toLowerCase();

export async function callOpenRouterTranslate(
  cfg: LandingAiConfig,
  system: string,
  user: string,
  fetchFn: LandingFetch,
): Promise<ProviderAttempt | null> {
  if (!cfg.baseUrl || !cfg.model || !cfg.apiKey) return null;
  const url = `${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`;
  try {
    const res = await fetchFn(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: sanitizeUserText(user) },
        ],
        temperature: 0.2,
        max_tokens: Math.max(cfg.maxTokens || 450, 1500),
      }),
      signal: AbortSignal.timeout(cfg.timeoutMs || TRANSLATOR_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as OpenAiChatResponse;
    const raw = data.choices?.[0]?.message?.content;
    if (typeof raw !== 'string') return null;
    const cleaned = sanitizeAssistantOutput(raw).trim();
    return cleaned ? { text: cleaned, provider: 'openrouter' } : null;
  } catch {
    return null;
  }
}

export async function callDeepLTranslate(
  apiKey: string,
  text: string,
  fromLang: string,
  toLang: string,
  contextText: string,
  fetchFn: LandingFetch,
  baseUrl?: string,
): Promise<ProviderAttempt | null> {
  const endpoint = baseUrl
    ? `${baseUrl.replace(/\/$/, '')}/v2/translate`
    : apiKey.endsWith(':fx')
      ? 'https://api-free.deepl.com/v2/translate'
      : 'https://api.deepl.com/v2/translate';
  try {
    const payload: Record<string, unknown> = {
      text: [text],
      target_lang: toLang.toUpperCase(),
    };
    if (fromLang) payload.source_lang = fromLang.toUpperCase();
    if (contextText) payload.context = contextText;
    const res = await fetchFn(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `DeepL-Auth-Key ${apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TRANSLATOR_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as DeepLResponse;
    const out = data.translations?.[0]?.text;
    const cleaned = typeof out === 'string' ? out.trim() : '';
    return cleaned ? { text: cleaned, provider: 'deepl' } : null;
  } catch {
    return null;
  }
}

export async function callAzureTranslate(
  apiKey: string,
  text: string,
  fromLang: string,
  toLang: string,
  fetchFn: LandingFetch,
  region?: string,
  endpoint = 'https://api.cognitive.microsofttranslator.com',
): Promise<ProviderAttempt | null> {
  const qs = new URLSearchParams({ 'api-version': '3.0', to: toLang });
  if (fromLang) qs.set('from', fromLang);
  const url = `${endpoint.replace(/\/$/, '')}/translate?${qs.toString()}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Ocp-Apim-Subscription-Key': apiKey,
  };
  if (region) headers['Ocp-Apim-Subscription-Region'] = region;
  try {
    const res = await fetchFn(url, {
      method: 'POST',
      headers,
      body: JSON.stringify([{ Text: text }]),
      signal: AbortSignal.timeout(TRANSLATOR_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as AzureItem[];
    const out = data?.[0]?.translations?.[0]?.text;
    const cleaned = typeof out === 'string' ? out.trim() : '';
    return cleaned ? { text: cleaned, provider: 'azure' } : null;
  } catch {
    return null;
  }
}
