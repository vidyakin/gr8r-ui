/* Контекстный автопереводчик сообщений: OpenRouter (до 10 реплик контекста) + fallback на DeepL и Azure Translator. */
import { CHAT_LANGUAGES } from '@erp/shared';
import { loadConfig } from '../env';
import type { LandingFetch } from '../landing-ai/chat';
import type { LandingAiConfig } from '../types';
import { callAzureTranslate, callDeepLTranslate, callOpenRouterTranslate, normalizeCompare } from './providers';

export interface TranslateContextItem {
  lang?: string | null;
  text: string;
}

export interface TranslateMessageInput {
  text: string;
  fromLang: string;
  toLang: string;
  context?: TranslateContextItem[];
  config?: LandingAiConfig;
  fetchFn?: LandingFetch;
  env?: Record<string, string | undefined>;
}

export interface TranslateMessageResult {
  text: string;
  provider: 'openrouter' | 'deepl' | 'azure' | 'none';
  status: 'done' | 'failed' | 'none';
}

const LANG_LABEL = new Map<string, string>(CHAT_LANGUAGES.map(l => [l.code, l.label]));

const normLang = (lang: string | null | undefined): string =>
  (lang ?? '').trim().toLowerCase().split(/[-_]/)[0] ?? '';

const langLabel = (code: string): string => {
  const label = LANG_LABEL.get(code);
  return label ? `${label} (${code})` : code;
};

function buildPrompt(text: string, fromLang: string, toLang: string, context: TranslateContextItem[]) {
  const system = [
    `You are a professional business translator translating chat messages into ${langLabel(toLang)}.`,
    'Preserve the original tone, formatting (line breaks, lists, markdown, URLs, emojis), numbers, and ERP/CRM/industry terminology.',
    'Use the conversation context only to disambiguate pronouns, domain terms, and tone. Do NOT translate or repeat the context.',
    'Return ONLY the translated message text with no commentary, quotes, or language prefixes.',
  ].join('\n');

  const recent = context
    .filter(c => c.text.trim().length > 0)
    .slice(-10)
    .map(c => `[${normLang(c.lang) || 'unknown'}]: ${c.text.trim()}`);

  const parts: string[] = [];
  if (recent.length > 0) {
    parts.push(`Conversation context:\n${recent.join('\n')}`);
  }
  const srcDesc = fromLang ? ` from ${langLabel(fromLang)}` : '';
  parts.push(`Translate${srcDesc} to ${langLabel(toLang)}:\n${text}`);
  return { system, user: parts.join('\n\n') };
}

function isUsableTranslation(translated: string | null | undefined, original: string): translated is string {
  if (!translated || !translated.trim()) return false;
  return normalizeCompare(translated) !== normalizeCompare(original);
}

export async function translateMessage(input: TranslateMessageInput): Promise<TranslateMessageResult> {
  const from = normLang(input.fromLang);
  const to = normLang(input.toLang);

  if (!input.text.trim() || !to || from === to) {
    return { text: input.text, provider: 'none', status: 'none' };
  }

  const env = input.env ?? process.env;
  const cfg = input.config ?? loadConfig(env).landingAi;
  const fetchFn: LandingFetch = input.fetchFn ?? globalThis.fetch;
  const context = input.context ?? [];

  const { system, user } = buildPrompt(input.text, from, to, context);
  const primary = await callOpenRouterTranslate(cfg, system, user, fetchFn);
  if (primary && isUsableTranslation(primary.text, input.text)) {
    return { text: primary.text, provider: primary.provider, status: 'done' };
  }

  const contextText = context.slice(-10).map(c => c.text.trim()).filter(Boolean).join('\n');
  const deeplKey = env.DEEPL_API_KEY?.trim();
  if (deeplKey) {
    const deepl = await callDeepLTranslate(deeplKey, input.text, from, to, contextText, fetchFn, env.DEEPL_API_URL?.trim());
    if (deepl && isUsableTranslation(deepl.text, input.text)) {
      return { text: deepl.text, provider: deepl.provider, status: 'done' };
    }
  }

  const azureKey = env.AZURE_TRANSLATOR_KEY?.trim();
  if (azureKey) {
    const azure = await callAzureTranslate(
      azureKey,
      input.text,
      from,
      to,
      fetchFn,
      env.AZURE_TRANSLATOR_REGION?.trim(),
      env.AZURE_TRANSLATOR_ENDPOINT?.trim() || undefined,
    );
    if (azure && isUsableTranslation(azure.text, input.text)) {
      return { text: azure.text, provider: azure.provider, status: 'done' };
    }
  }

  return { text: input.text, provider: 'none', status: 'failed' };
}
