import { describe, expect, test } from 'bun:test';
import { buildWidgetSystemPrompt } from '../src/landing-ai/knowledge';
import {
  DEFAULT_AI_CHAT_SETTINGS,
  extractAiChatSettings,
  mergeAiChatSettings,
  normalizeOrigin,
  sanitizeAllowedOrigins,
  toAdminAiChatSettings,
} from '../src/landing-ai/settings';
import { generateWidgetSecret, isOriginAllowed, timingSafeTokenMatch } from '../src/landing-ai/widget-handoff';

describe('embeddable AI chat widget settings & security', () => {
  test('normalizeOrigin normalizes valid domains and rejects invalid values', () => {
    expect(normalizeOrigin('Example.COM/path?a=1')).toBe('https://example.com');
    expect(normalizeOrigin('http://localhost:3000/page')).toBe('http://localhost:3000');
    expect(normalizeOrigin('https://Shop.Site.RU:8443/')).toBe('https://shop.site.ru:8443');
    expect(normalizeOrigin('javascript:alert(1)')).toBeNull();
    expect(normalizeOrigin('')).toBeNull();
  });

  test('sanitizeAllowedOrigins deduplicates and caps at 20', () => {
    const out = sanitizeAllowedOrigins(['https://a.ru', 'a.ru/test', 'https://b.ru']);
    expect(out).toEqual(['https://a.ru', 'https://b.ru']);
  });

  test('extractAiChatSettings and mergeAiChatSettings preserve widget fields safely', () => {
    const extracted = extractAiChatSettings({
      aiChat: {
        widgetEnabled: true,
        widgetSecret: 'sec_1234567890123456',
        allowedOrigins: ['mysite.ru/about', 'https://www.mysite.ru'],
        botName: 'Acme Helper',
        accentColor: '#10b981',
        position: 'left',
        handoffEnabled: true,
        soundEnabled: false,
        knowledgeBase: '## ABOUT\nWe sell widgets.',
        dailyLimit: 99999,
      },
    });
    expect(extracted.widgetEnabled).toBe(true);
    expect(extracted.allowedOrigins).toEqual(['https://mysite.ru', 'https://www.mysite.ru']);
    expect(extracted.accentColor).toBe('#10b981');
    expect(extracted.position).toBe('left');
    expect(extracted.soundEnabled).toBe(false);
    expect(extracted.dailyLimit).toBe(5000);

    const merged = mergeAiChatSettings(extracted, { botName: 'New Bot', position: 'right' });
    expect(merged.botName).toBe('New Bot');
    expect(merged.position).toBe('right');
    expect(merged.widgetSecret).toBe('sec_1234567890123456');

    const admin = toAdminAiChatSettings('ws-1', merged);
    expect(admin.widgetToken).toBe('ws-1.sec_1234567890123456');
    expect('widgetSecret' in admin).toBe(false);
  });

  test('isOriginAllowed enforces allowedOrigins list', () => {
    expect(isOriginAllowed('https://client.ru', ['https://client.ru'])).toBe(true);
    expect(isOriginAllowed('https://evil.ru', ['https://client.ru'])).toBe(false);
    expect(isOriginAllowed('https://client.ru', [])).toBe(false);
    expect(isOriginAllowed(undefined, ['https://client.ru'])).toBe(true);
  });

  test('generateWidgetSecret and timingSafeTokenMatch work reliably', () => {
    const s1 = generateWidgetSecret();
    const s2 = generateWidgetSecret();
    expect(s1.length).toBeGreaterThanOrEqual(24);
    expect(s1).not.toBe(s2);
    expect(timingSafeTokenMatch(s1, s1)).toBe(true);
    expect(timingSafeTokenMatch(s1, s2)).toBe(false);
  });

  test('buildWidgetSystemPrompt isolates company knowledge base from FutureERP', () => {
    const prompt = buildWidgetSystemPrompt('ru', {
      botName: 'Помощник МебельПро',
      workspaceName: 'МебельПро',
      knowledgeBase: '## О КОМПАНИИ\nДелаем кухни на заказ.\n## ПРОДУКТЫ И ЦЕНЫ\nКухня от 150 000 ₽.',
      tone: DEFAULT_AI_CHAT_SETTINGS.tone,
      handoffEnabled: true,
    });
    expect(prompt).toContain('МебельПро');
    expect(prompt).toContain('Кухня от 150 000 ₽.');
    expect(prompt).toContain('Call manager');
    expect(prompt).not.toContain('FutureERP');
  });
});
