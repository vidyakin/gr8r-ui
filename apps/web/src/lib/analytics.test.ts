import { afterEach, describe, expect, test } from 'bun:test';
import { identifyUser, isAnalyticsEnabled, normalizePath, resetAnalyticsForTests, trackOpen, trackPageview } from './analytics';

const g = globalThis as unknown as Record<string, unknown>;

afterEach(() => {
  delete g.window;
  delete g.document;
  resetAnalyticsForTests();
});

describe('normalizePath', () => {
  test('UUID и числовые id становятся :id', () => {
    expect(normalizePath('/documents/3f2b8c1e-9d4a-4b6e-8f1a-0c2d3e4f5a6b')).toBe('/documents/:id');
    expect(normalizePath('/crm/companies/123')).toBe('/crm/companies/:id');
    expect(normalizePath('/projects/p12ab/board')).toBe('/projects/:id/board');
    expect(normalizePath('/documents/3f2b8c1e-9d4a-4b6e-8f1a-0c2d3e4f5a6b/print/invoice')).toBe('/documents/:id/print/invoice');
  });

  test('query и hash отбрасываются', () => {
    expect(normalizePath('/search?q=Ромашка&x=1')).toBe('/search');
    expect(normalizePath('/tasks#row-5')).toBe('/tasks');
    expect(normalizePath('/contracts/7/print?template=9#a')).toBe('/contracts/:id/print');
  });

  test('обычные разделы и корень не меняются', () => {
    expect(normalizePath('/')).toBe('/');
    expect(normalizePath('')).toBe('/');
    expect(normalizePath('/settings/profile')).toBe('/settings/profile');
    expect(normalizePath('/crm/appointments/day/9')).toBe('/crm/appointments/day/:id');
    expect(normalizePath('/projects/')).toBe('/projects');
  });

  test('длинные хэши и закодированные имена с цифрами скрываются', () => {
    expect(normalizePath('/x/abcdefghijklmnopqrstuvwxyz')).toBe('/x/:id');
    expect(normalizePath('/x/%D0%9E%D0%9E%D0%9E%201')).toBe('/x/:id');
  });
});

describe('без ID сайта — no-op', () => {
  test('нет window: ничего не падает', () => {
    expect(isAnalyticsEnabled()).toBe(false);
    expect(() => {
      trackPageview('/crm/deals/5');
      trackOpen('window', 'task');
      identifyUser({ userId: 'u1', workspaceId: 'w1', role: 'owner' });
    }).not.toThrow();
  });

  test('window есть, ID пустой: скрипт не добавляется', () => {
    const added: unknown[] = [];
    g.window = { __GR8R_CONFIG__: {}, location: { origin: 'http://x' } };
    g.document = { head: { appendChild: (e: unknown) => added.push(e) }, createElement: () => ({ dataset: {} }) };
    expect(isAnalyticsEnabled()).toBe(false);
    trackPageview('/tasks');
    trackOpen('drawer', 'crm-deal');
    expect(added).toHaveLength(0);
  });
});

describe('с ID сайта', () => {
  test('скрипт с того же origin, auto-track выключен, события чистятся от заголовка и query', () => {
    const added: Array<{ src?: string; dataset: Record<string, string> }> = [];
    const calls: unknown[][] = [];
    const win: Record<string, unknown> = { __GR8R_CONFIG__: { umamiWebsiteId: 'a1b2c3d4-0000-4000-8000-000000000000' }, location: { origin: 'https://erp.example.com' } };
    g.window = win;
    g.document = {
      head: { appendChild: (e: { src?: string; dataset: Record<string, string> }) => added.push(e) },
      createElement: () => ({ dataset: {} }),
    };
    trackPageview('/documents/3f2b8c1e-9d4a-4b6e-8f1a-0c2d3e4f5a6b?tab=x');
    trackOpen('window', 'task');
    expect(added).toHaveLength(1);
    expect(added[0]!.src).toBe('/stats/m.js');
    expect(added[0]!.dataset.autoTrack).toBe('false');
    expect(added[0]!.dataset.hostUrl).toBe('https://erp.example.com/stats');
    // скрипт «загрузился»: очередь выполняется
    win.umami = { track: (...a: unknown[]) => calls.push(['track', ...a]), identify: (...a: unknown[]) => calls.push(['identify', ...a]) };
    (added[0] as unknown as { onload: () => void }).onload();
    expect(calls).toEqual([['track'], ['track', 'open', { kind: 'window', name: 'task' }]]);
    const beforeSend = win.__gr8rUmamiBeforeSend as (t: string, p: Record<string, unknown>) => Record<string, unknown>;
    expect(beforeSend('event', { url: 'https://erp/x?q=Иванов', title: 'Сделка Иванов', referrer: 'https://erp/y' })).toMatchObject({ url: '/documents/:id', title: '', referrer: '' });
  });
});
