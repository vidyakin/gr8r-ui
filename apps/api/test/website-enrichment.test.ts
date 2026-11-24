/* Unit-тесты ИИ-обогащения по сайту и генерации писем: SSRF, парсинг HTML, скрапер, AI-парсер, Zod-схемы. */
import { describe, expect, test } from 'bun:test';
import { crmAnalyzeWebsiteBody, crmDraftOutreachBody } from '@erp/shared';
import {
  assertSafeUrl,
  extractInternalLinks,
  extractTextFromHtml,
  isPrivateIp,
  scrapeWebsite,
} from '../src/crm/website-scraper';
import { analyzeWebsiteWithAi, draftOutreachWithAi } from '../src/crm/website-ai';
import type { LandingAiConfig } from '../src/types';

const publicLookup = (async () => [{ address: '93.184.216.34', family: 4 }]) as unknown as typeof import('node:dns/promises').lookup;
const privateLookup = (async () => [{ address: '10.0.0.12', family: 4 }]) as unknown as typeof import('node:dns/promises').lookup;

const dummyCfg: LandingAiConfig = {
  baseUrl: 'https://openrouter.ai/api/v1',
  model: 'test-model',
  apiKey: 'sk-test',
  workspaceId: '',
  origins: [],
  rateIp10m: 10,
  rateIpDay: 50,
  rateGlobalDay: 500,
  maxTokens: 500,
  timeoutMs: 5000,
};

describe('SSRF protection (isPrivateIp & assertSafeUrl)', () => {
  test('detects private/local IPv4 and IPv6 addresses', () => {
    const blocked = [
      '127.0.0.1', '127.255.0.1', '10.0.0.1', '172.16.0.1', '172.31.255.254',
      '192.168.1.10', '169.254.169.254', '0.0.0.0', '::1', 'fc00::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1',
    ];
    for (const ip of blocked) expect(isPrivateIp(ip)).toBe(true);
    expect(isPrivateIp('93.184.216.34')).toBe(false);
    expect(isPrivateIp('172.32.0.1')).toBe(false);
    expect(isPrivateIp('2606:2800:220:1:248:1893:25c8:1946')).toBe(false);
  });

  test('blocks non-http protocols, localhost, private IPs, and DNS to private IP', async () => {
    await expect(assertSafeUrl('file:///etc/passwd', publicLookup)).rejects.toThrow();
    await expect(assertSafeUrl('ftp://example.com', publicLookup)).rejects.toThrow();
    await expect(assertSafeUrl('http://localhost:3000', publicLookup)).rejects.toThrow();
    await expect(assertSafeUrl('http://api.localhost', publicLookup)).rejects.toThrow();
    await expect(assertSafeUrl('http://127.0.0.1/admin', publicLookup)).rejects.toThrow();
    await expect(assertSafeUrl('http://169.254.169.254/latest/meta-data', publicLookup)).rejects.toThrow();
    await expect(assertSafeUrl('http://[::1]/', publicLookup)).rejects.toThrow();
    await expect(assertSafeUrl('https://internal.example.com', privateLookup)).rejects.toThrow();
    const ok = await assertSafeUrl('https://example.com/about', publicLookup);
    expect(ok.hostname).toBe('example.com');
  });
});

describe('HTML extraction', () => {
  test('extractTextFromHtml strips scripts/styles and decodes entities', () => {
    const html = `<!doctype html><html><head><title>Ignored</title><style>body{color:red}</style></head>
      <body><!-- comment --><script>alert(1)</script>
      <h1>Завод &laquo;Альфа&raquo; &amp; Партнёры</h1>
      <p>Производство&nbsp;металлоконструкций &mdash; Москва.</p></body></html>`;
    const text = extractTextFromHtml(html);
    expect(text).toContain('Завод');
    expect(text).toContain('& Партнёры');
    expect(text).toContain('Производство металлоконструкций — Москва.');
    expect(text).not.toContain('alert(1)');
    expect(text).not.toContain('color:red');
  });

  test('extractInternalLinks picks priority internal pages only', () => {
    const html = `
      <a href="/about">About</a>
      <a href="/o-kompanii#team">О компании</a>
      <a href="/uslugi">Услуги</a>
      <a href="/products/">Продукты</a>
      <a href="/contacts">Контакты</a>
      <a href="/blog/post-1">Блог</a>
      <a href="https://other.com/about">External</a>
      <a href="mailto:hi@example.com">Mail</a>
    `;
    const links = extractInternalLinks(html, 'https://example.com/');
    expect(links).toEqual([
      'https://example.com/about',
      'https://example.com/o-kompanii',
      'https://example.com/uslugi',
      'https://example.com/products/',
      'https://example.com/contacts',
    ]);
  });
});

describe('scrapeWebsite', () => {
  test('returns fallback on HTTP 403 or short SPA text', async () => {
    const res403 = await scrapeWebsite('https://example.com', async () => new Response('Forbidden', { status: 403 }), publicLookup);
    expect(res403.ok).toBe(false);
    const resShort = await scrapeWebsite('https://example.com', async () => new Response('<div id="root"></div>'), publicLookup);
    expect(resShort.ok).toBe(false);
    if (!resShort.ok) expect(resShort.rawTextLength).toBeLessThan(150);
  });

  test('scrapes homepage and up to 2 internal pages', async () => {
    const bodyText = 'Производственная компания полного цикла, поставляем промышленное оборудование и комплектующие по всей России. ';
    const mockFetch = async (input: string | URL | Request) => {
      const u = String(input);
      if (u.endsWith('/about')) return new Response(`<main>${bodyText}О компании: 15 лет на рынке.</main>`);
      if (u.endsWith('/uslugi')) return new Response(`<main>${bodyText}Услуги: монтаж и сервис.</main>`);
      return new Response(`<main>${bodyText.repeat(2)}<a href="/about">О нас</a><a href="/uslugi">Услуги</a><a href="/contacts">Контакты</a></main>`);
    };
    const res = await scrapeWebsite('example.com', mockFetch, publicLookup);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.pagesScraped).toBe(3);
      expect(res.text).toContain('15 лет на рынке');
      expect(res.text).toContain('монтаж и сервис');
    }
  });
});

describe('AI helpers & Zod schemas', () => {
  test('validates crmAnalyzeWebsiteBody and crmDraftOutreachBody', () => {
    expect(crmAnalyzeWebsiteBody.safeParse({}).success).toBe(false);
    expect(crmAnalyzeWebsiteBody.safeParse({ url: 'https://example.com' }).success).toBe(true);
    expect(crmAnalyzeWebsiteBody.safeParse({ manualText: 'Some text' }).success).toBe(true);

    const draftOk = crmDraftOutreachBody.safeParse({ channel: 'email' });
    expect(draftOk.success).toBe(true);
    if (draftOk.success) expect(draftOk.data.tone).toBe('friendly');
    expect(crmDraftOutreachBody.safeParse({ channel: 'telegram' }).success).toBe(false);
  });

  test('analyzeWebsiteWithAi and draftOutreachWithAi parse JSON responses', async () => {
    const analyzeFetch = async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '```json\n{"summary":"Завод","industry":"Производство","offerings":["Станки"],"location":"Москва","potentialPains":["Учёт остатков"]}\n```' } }],
        }),
      );
    const analysis = await analyzeWebsiteWithAi(dummyCfg, 'Текст сайта компании', analyzeFetch);
    expect(analysis.fallbackNeeded).toBe(false);
    expect(analysis.industry).toBe('Производство');
    expect(analysis.offerings).toEqual(['Станки']);

    const draftFetch = async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: '{"subject":"Идея по учёту","body":"Здравствуйте!"}' } }] }));
    const draft = await draftOutreachWithAi(dummyCfg, { channel: 'email', tone: 'concise' }, draftFetch);
    expect(draft).toEqual({ subject: 'Идея по учёту', body: 'Здравствуйте!' });
  });
});
