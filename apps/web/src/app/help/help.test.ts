/* Справка (задача 1237): каждая статья рендерится, ссылки между статьями разрешаются, у каждого раздела меню (кроме system) находится статья.
   Каталог собирается из тех же файлов, что и бандл (bundle.ts), только читаем их с диска — import.meta.glob в bun-тестах недоступен. */
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { articleLinks, articlesOfSection, buildCatalog, renderMarkdown, searchDocs, sectionOfPath, tocOf } from '@gr8r/docs';
import { SECTIONS } from '../routes';
import { DOCS_DIR } from '../../../../../scripts/docs-lib';

const raw: Record<string, string> = {};
for (const rel of readdirSync(DOCS_DIR, { recursive: true }) as string[]) if (rel.endsWith('.md')) raw[join('docs/user', rel)] = readFileSync(join(DOCS_DIR, rel), 'utf8');
const catalog = buildCatalog(raw);

describe('справка: статьи', () => {
  test('каталог не пуст и без README/шаблонов', () => {
    expect(catalog.articles.length).toBeGreaterThan(50);
    expect(catalog.articles.some(a => a.id === 'README' || a.id.includes('_templates'))).toBe(false);
  });

  test('каждая статья рендерится без сырого HTML и опасных ссылок', () => {
    for (const a of catalog.articles) {
      const html = renderMarkdown(a.body, { from: a.id, hasArticle: id => catalog.byId.has(id), linkHref: id => `#doc:${id}`, imageUrl: () => undefined });
      expect(html.length, a.id).toBeGreaterThan(50);
      expect(html, a.id).not.toMatch(/<script|javascript:|\son\w+=/i);
    }
  });

  test('ссылки между статьями разрешаются', () => {
    const broken: string[] = [];
    for (const a of catalog.articles) for (const l of articleLinks(a.body, a.id)) if (!l.id || !catalog.byId.has(l.id)) broken.push(`${a.id} → ${l.href}`);
    expect(broken).toEqual([]);
  });

  test('раздел → статья находится для всех id из SECTIONS, кроме system', () => {
    const missing = Object.keys(SECTIONS).filter(id => id !== 'system' && !articlesOfSection(catalog, id).length);
    expect(missing).toEqual([]);
  });

  test('адрес → раздел: самый длинный путь, «/» только главная', () => {
    expect(sectionOfPath('/', SECTIONS)).toBe('home');
    expect(sectionOfPath('/crm/companies/c1', SECTIONS)).toBe('crmCompanies');
    expect(sectionOfPath('/projects/p1/files', SECTIONS)).toBe('projects');
    expect(sectionOfPath('/nowhere', SECTIONS)).toBeNull();
  });

  test('оглавление и поиск', () => {
    expect(tocOf(catalog).flatMap(g => g.articles).length).toBe(catalog.articles.length);
    const hits = searchDocs(catalog, 'уведомления');
    expect(hits[0]?.article.id).toBe('general/notifications');
    expect(searchDocs(catalog, 'zzzzqqq')).toEqual([]);
    expect(tocOf(catalog, a => a.fm.module !== 'money').flatMap(g => g.articles).some(a => a.fm.module === 'money')).toBe(false);
  });

  test('сырой HTML и javascript: ссылки обезвреживаются, внешние ссылки открываются в новой вкладке', () => {
    const o = { from: 'general/x', hasArticle: () => false, linkHref: (id: string) => id, imageUrl: () => undefined };
    const html = renderMarkdown('<script>alert(1)</script>\n\n[a](javascript:alert(1)) [b](https://example.com) ![c](../img/none.png)', o);
    expect(html).not.toContain('<script');
    expect(html).not.toContain('href="javascript');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('doc-noimg');
  });
});
