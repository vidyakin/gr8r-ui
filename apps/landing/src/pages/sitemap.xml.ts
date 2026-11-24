/* Статическая карта сайта /sitemap.xml с альтернативными языковыми ссылками (ru / en / es) для Google и Яндекса */
import type { APIRoute } from 'astro';
import { DEFAULT_LOCALE, LOCALES, localePath } from '../i18n';
import { MODULE_IDS } from '../demo/registry';
import { getRuArticles } from '../blog';

const FALLBACK_SITE = 'https://future-erp.ai-solutions-studio.ru';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function urlEntry(loc: string, priority: string, alternates?: { hreflang: string; href: string }[]): string {
  const links = (alternates ?? [])
    .map(a => `    <xhtml:link rel="alternate" hreflang="${a.hreflang}" href="${esc(a.href)}" />`)
    .join('\n');
  return [
    '  <url>',
    `    <loc>${esc(loc)}</loc>`,
    links,
    `    <priority>${priority}</priority>`,
    '  </url>',
  ]
    .filter(Boolean)
    .join('\n');
}

export const GET: APIRoute = ({ site }) => {
  const base = site ?? new URL(FALLBACK_SITE);
  const abs = (p: string) => new URL(p, base).href;
  const entries: string[] = [];

  const addLocalized = (altPath: string, priority: string) => {
    const alts = [
      ...LOCALES.map(l => ({ hreflang: l, href: abs(localePath(l, altPath)) })),
      { hreflang: 'x-default', href: abs(localePath(DEFAULT_LOCALE, altPath)) },
    ];
    for (const l of LOCALES) {
      entries.push(urlEntry(abs(localePath(l, altPath)), priority, alts));
    }
  };

  addLocalized('/', '1.0');
  for (const id of MODULE_IDS) {
    addLocalized(`/modules/${id}/`, '0.8');
  }

  entries.push(urlEntry(abs('/blog/'), '0.8'));
  for (const article of getRuArticles()) {
    entries.push(urlEntry(abs(`/blog/${article.frontmatter.slug}/`), '0.7'));
  }

  entries.push(urlEntry(abs('/docs/'), '0.6'));
  entries.push(urlEntry(abs('/privacy/'), '0.3'));
  entries.push(urlEntry(abs('/consent/'), '0.3'));

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ...entries,
    '</urlset>',
    '',
  ].join('\n');

  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
};
