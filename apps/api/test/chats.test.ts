/* Юнит-тесты схем чатов и контекстного автопереводчика (без Postgres). */
import { describe, expect, test } from 'bun:test';
import {
  CHAT_LANGUAGES,
  CHAT_LANGUAGE_CODES,
  chatCreateBody,
  chatGuestLinkBody,
  chatMessageCreateBody,
  chatMessageFeedbackBody,
  chatPatchBody,
  publicChatMessageBody,
  publicChatPatchBody,
} from '@erp/shared';
import { translateMessage } from '../src/chats/translator';
import type { LandingFetch } from '../src/landing-ai/chat';
import type { LandingAiConfig } from '../src/types';

const VALID_UUID = '01950000-0000-7000-8000-000000000001';

const aiConfig: LandingAiConfig = {
  baseUrl: 'https://openrouter.example.test/api/v1',
  model: 'openai/gpt-4o-mini',
  apiKey: 'or-key',
  workspaceId: '',
  origins: [],
  rateIp10m: 15,
  rateIpDay: 40,
  rateGlobalDay: 500,
  maxTokens: 450,
  timeoutMs: 5000,
};

describe('chats zod schemas', () => {
  test('CHAT_LANGUAGES codes align with CHAT_LANGUAGE_CODES', () => {
    expect(CHAT_LANGUAGES.map(l => l.code)).toEqual([...CHAT_LANGUAGE_CODES]);
  });

  test('validates chatCreateBody variants', () => {
    expect(chatCreateBody.parse({ kind: 'direct', memberIds: [VALID_UUID] }).kind).toBe('direct');
    const client = chatCreateBody.parse({
      kind: 'client',
      title: '  Acme Deal  ',
      entityType: 'deal',
      entityId: VALID_UUID,
      guestName: 'Maria',
      guestLanguage: 'es',
      enableGuestLink: true,
    });
    expect(client.title).toBe('Acme Deal');
    expect(client.enableGuestLink).toBe(true);
    expect(() => chatCreateBody.parse({ kind: 'unknown' })).toThrow();
    expect(() => chatCreateBody.parse({ kind: 'client', guestLanguage: 'xx' })).toThrow();
    expect(() => chatCreateBody.parse({ kind: 'group', title: 'a'.repeat(201) })).toThrow();
  });

  test('validates chatPatchBody and chatGuestLinkBody', () => {
    expect(chatPatchBody.parse({ title: 'Renamed', preferredLanguage: 'de', archived: false }).preferredLanguage).toBe('de');
    expect(() => chatPatchBody.parse({ title: '   ' })).toThrow();
    for (const action of ['enable', 'rotate', 'revoke'] as const) {
      expect(chatGuestLinkBody.parse({ action }).action).toBe(action);
    }
    expect(() => chatGuestLinkBody.parse({ action: 'delete' })).toThrow();
  });

  test('validates message, feedback, and public chat schemas', () => {
    expect(chatMessageCreateBody.parse({ text: '  Привет!  ', language: 'ru' })).toEqual({ text: 'Привет!', language: 'ru' });
    expect(() => chatMessageCreateBody.parse({ text: '   ' })).toThrow();
    expect(() => chatMessageCreateBody.parse({ text: 'x'.repeat(10001) })).toThrow();

    expect(chatMessageFeedbackBody.parse({ feedback: 'like' }).feedback).toBe('like');
    expect(chatMessageFeedbackBody.parse({ feedback: 'none' }).feedback).toBe('none');
    expect(() => chatMessageFeedbackBody.parse({ feedback: 'love' })).toThrow();

    expect(publicChatPatchBody.parse({ guestName: '  Alex  ', guestLanguage: 'fr' })).toEqual({ guestName: 'Alex', guestLanguage: 'fr' });
    expect(publicChatMessageBody.parse({ text: 'Hello', guestName: 'Alex', language: 'en' }).text).toBe('Hello');
    expect(() => publicChatMessageBody.parse({ text: '' })).toThrow();
  });
});

describe('translateMessage', () => {
  test('returns status "none" without calling fetch when languages match', async () => {
    let called = false;
    const fetchFn: LandingFetch = async () => {
      called = true;
      return new Response('{}', { status: 200 });
    };

    const res1 = await translateMessage({ text: 'Привет', fromLang: 'ru', toLang: 'ru', config: aiConfig, fetchFn });
    const res2 = await translateMessage({ text: 'Hello', fromLang: 'EN', toLang: 'en-US', config: aiConfig, fetchFn });
    expect(res1).toEqual({ text: 'Привет', provider: 'none', status: 'none' });
    expect(res2).toEqual({ text: 'Hello', provider: 'none', status: 'none' });
    expect(called).toBe(false);
  });

  test('translates via OpenRouter and sends up to last 10 context messages', async () => {
    let sentBody: { messages: Array<{ role: string; content: string }> } | undefined;
    const fetchFn: LandingFetch = async (_url, init) => {
      sentBody = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({ choices: [{ message: { content: 'Good morning! The invoice is ready.' } }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const context = Array.from({ length: 12 }, (_, i) => ({ lang: 'ru', text: `msg-${i + 1}` }));
    const res = await translateMessage({
      text: 'Доброе утро! Счёт готов.',
      fromLang: 'ru',
      toLang: 'en',
      context,
      config: aiConfig,
      fetchFn,
    });

    expect(res).toEqual({ text: 'Good morning! The invoice is ready.', provider: 'openrouter', status: 'done' });
    const userPrompt = sentBody?.messages[1]?.content ?? '';
    expect(userPrompt).not.toContain('[ru]: msg-1\n');
    expect(userPrompt).not.toContain('[ru]: msg-2\n');
    expect(userPrompt).toContain('[ru]: msg-3');
    expect(userPrompt).toContain('[ru]: msg-12');
  });

  test('falls back to DeepL when OpenRouter returns text identical to original', async () => {
    const urls: string[] = [];
    const fetchFn: LandingFetch = async url => {
      urls.push(String(url));
      if (String(url).includes('openrouter.example.test')) {
        return new Response(
          JSON.stringify({ choices: [{ message: { content: '  счёт   готов  ' } }] }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ translations: [{ text: 'The invoice is ready' }] }), { status: 200 });
    };

    const res = await translateMessage({
      text: 'Счёт готов',
      fromLang: 'ru',
      toLang: 'en',
      config: aiConfig,
      fetchFn,
      env: { DEEPL_API_KEY: 'deepl-test:fx' },
    });

    expect(res).toEqual({ text: 'The invoice is ready', provider: 'deepl', status: 'done' });
    expect(urls.length).toBe(2);
    expect(urls[1]).toContain('api-free.deepl.com/v2/translate');
  });

  test('falls back to Azure Translator when OpenRouter and DeepL fail', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request) => {
      const s = String(url);
      if (s.includes('openrouter.example.test')) throw new Error('timeout');
      if (s.includes('deepl.com')) return new Response('error', { status: 503 });
      return new Response(JSON.stringify([{ translations: [{ text: 'Hola mundo' }] }]), { status: 200 });
    }) as typeof fetch;

    try {
      const res = await translateMessage({
        text: 'Hello world',
        fromLang: 'en',
        toLang: 'es',
        config: aiConfig,
        env: { DEEPL_API_KEY: 'deepl-pro', AZURE_TRANSLATOR_KEY: 'az-key', AZURE_TRANSLATOR_REGION: 'westeurope' },
      });
      expect(res).toEqual({ text: 'Hola mundo', provider: 'azure', status: 'done' });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('returns status "failed" without throwing when all providers are unavailable', async () => {
    const fetchFn: LandingFetch = async () => {
      throw new Error('network down');
    };
    const res = await translateMessage({
      text: 'Test message',
      fromLang: 'en',
      toLang: 'de',
      config: { ...aiConfig, apiKey: '' },
      fetchFn,
      env: {},
    });
    expect(res).toEqual({ text: 'Test message', provider: 'none', status: 'failed' });
  });
});
